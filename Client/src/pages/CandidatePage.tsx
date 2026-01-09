// Client/src/pages/CandidatePage.tsx
import React, { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";

import {
  Configuration,
  NewSessionData,
  StreamingAvatarApi,
} from "@heygen/streaming-avatar";
import "../App.css";

const API_BASE = process.env.REACT_APP_API_BASE_URL || "http://localhost:3001";

// ✅ Solución A: en producción NO mostramos debug al candidato
const IS_PROD = process.env.NODE_ENV === "production";

type StoredConfig = {
  objective: string;
  tone: string;
  questions: string[];
  avatarId: string;
  voiceId: string;
};

type InterviewScript = {
  objective: string;
  tone: string;
  questions: string[];
};

const SYSTEM_PROMPT = `
Eres un entrevistador de IA profesional.

Tu misión es conducir entrevistas siguiendo una lista de preguntas en un orden concreto.

Reglas:
- Haz UNA intervención cada vez.
- Sigue el orden del guion.
- Siempre valida o resume brevemente lo que ha dicho el entrevistado antes de avanzar.
- Usa un tono cercano, curioso y profesional.
- No hagas respuestas largas (máx. 3 frases).
- Si no quedan más preguntas en el guion, agradece, cierra la entrevista y no abras nuevos temas.
`.trim();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// POST seguro al backend para guardar summary
async function saveSummaryToBackend(interviewId: string, summary: string, rawConversation?: string) {
  const res = await fetch(`${API_BASE}/api/save-summary`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ interviewId, summary, rawConversation }),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(txt || `Error guardando summary (HTTP ${res.status})`);
  }
}

function isValidConfig(cfg: any): cfg is StoredConfig {
  return !!(
    cfg &&
    typeof cfg.objective === "string" &&
    typeof cfg.tone === "string" &&
    Array.isArray(cfg.questions) &&
    cfg.questions.length > 0 &&
    cfg.questions.every((q: any) => typeof q === "string" && q.trim().length > 0) &&
    typeof cfg.avatarId === "string" &&
    cfg.avatarId.trim().length > 0 &&
    typeof cfg.voiceId === "string" &&
    cfg.voiceId.trim().length > 0
  );
}

const CandidatePage: React.FC = () => {
  const { token: interviewToken } = useParams<{ token: string }>();

  const [isLoadingConfig, setIsLoadingConfig] = useState(true);
  const [configError, setConfigError] = useState<string | null>(null);

  const [stream, setStream] = useState<MediaStream>();
  const [debug, setDebug] = useState<string>("");

  const avatar = useRef<StreamingAvatarApi | null>(null);

  const [avatarId, setAvatarId] = useState("");
  const [voiceId, setVoiceId] = useState("");

  const [data, setData] = useState<NewSessionData>();
  const mediaStream = useRef<HTMLVideoElement>(null);

  const [script, setScript] = useState<InterviewScript | null>(null);
  const [conversation, setConversation] = useState("");
  const [questionIndex, setQuestionIndex] = useState(0);
  const [isFinished, setIsFinished] = useState(false);

  const [isSummarizing, setIsSummarizing] = useState(false);

  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // =====================================================
  // ✅ 0) PROXY HeyGen (arregla CORS del SDK sin reescribirlo)
  // =====================================================
  useEffect(() => {
    const originalFetch = window.fetch.bind(window);

    window.fetch = async (input: any, init?: any) => {
      try {
        if (typeof input === "string" && input.startsWith("https://api.heygen.com/")) {
          // https://api.heygen.com/v1/xxx  ->  {API_BASE}/api/heygen/v1/xxx
          const proxied = `${API_BASE}/api/heygen${input.replace("https://api.heygen.com", "")}`;
          return originalFetch(proxied, init);
        }
        return originalFetch(input, init);
      } catch (e) {
        return originalFetch(input, init);
      }
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, []);

  // ✅ SOLO BACKEND (sin localStorage)
  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        setIsLoadingConfig(true);
        setConfigError(null);
        setDebug("");

        if (!interviewToken) {
          if (cancelled) return;
          setConfigError("Falta el identificador de entrevista en la URL. Pide un nuevo enlace al equipo.");
          setIsLoadingConfig(false);
          return;
        }

        const url = `${API_BASE}/api/interview-config/${encodeURIComponent(interviewToken)}`;
        const res = await fetch(url);
        const json = await res.json().catch(() => ({}));

        if (!res.ok) {
          if (cancelled) return;
          setConfigError(json?.error || `No se pudo cargar config (HTTP ${res.status})`);
          setDebug(`(Debug) GET ${url} → ${JSON.stringify(json)}`);
          setIsLoadingConfig(false);
          return;
        }

        if (!isValidConfig(json?.config)) {
          if (cancelled) return;
          setConfigError("Config inválida devuelta por el backend.");
          setDebug(`(Debug) GET ${url} → ${JSON.stringify(json)}`);
          setIsLoadingConfig(false);
          return;
        }

        const cfg = json.config as StoredConfig;

        if (cancelled) return;
        setScript({
          objective: cfg.objective,
          tone: cfg.tone,
          questions: cfg.questions,
        });
        setAvatarId(cfg.avatarId);
        setVoiceId(cfg.voiceId);

        setIsLoadingConfig(false);
      } catch (e: any) {
        if (cancelled) return;
        setConfigError(e?.message || "Error cargando config desde backend.");
        setIsLoadingConfig(false);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [interviewToken]);

  // Inicialización avatar (HeyGen)
  useEffect(() => {
    const startTalkCallback = (e: any) => console.log("Avatar started talking", e);
    const stopTalkCallback = (e: any) => console.log("Avatar stopped talking", e);

    if (!avatar.current) {
      const heygenKey = process.env.REACT_APP_HEYGEN_API_KEY;
      if (!heygenKey) {
        console.error("Falta REACT_APP_HEYGEN_API_KEY en el .env de Client.");
        return;
      }

      avatar.current = new StreamingAvatarApi(new Configuration({ accessToken: heygenKey }));
      avatar.current.addEventHandler("avatar_start_talking", startTalkCallback);
      avatar.current.addEventHandler("avatar_stop_talking", stopTalkCallback);
    }

    return () => {
      if (avatar.current) {
        avatar.current.removeEventHandler("avatar_start_talking", startTalkCallback);
        avatar.current.removeEventHandler("avatar_stop_talking", stopTalkCallback);
      }
    };
  }, []);

  // ✅ Start robusto
  async function grab() {
    try {
      if (!script) return setDebug("No se ha cargado el guion de la entrevista.");
      if (isRecording) return setDebug("Primero detén la grabación antes de iniciar de nuevo.");

      if (!avatar.current) {
        const heygenKey = process.env.REACT_APP_HEYGEN_API_KEY;
        if (!heygenKey) return setDebug("Falta REACT_APP_HEYGEN_API_KEY en el .env de Client.");
        avatar.current = new StreamingAvatarApi(new Configuration({ accessToken: heygenKey }));
      }

      if (!avatarId || !voiceId) return setDebug("Hay un problema con la configuración del avatar.");

      setIsFinished(false);
      setConversation("");
      setQuestionIndex(0);
      setDebug("");

      const res = await avatar.current!.createStartAvatar(
        {
          newSessionRequest: {
            quality: "high",
            avatarName: avatarId,
            voice: { voiceId },
          },
        },
        (msg: string) => console.log("HeyGen debug:", msg)
      );

      setData(res);
      setStream(avatar.current!.mediaStream);

      const firstQuestion = script.questions[0];
      const opening = "Hola, gracias por tu tiempo. Vamos a comenzar la entrevista. " + (firstQuestion || "");
      setConversation(`Entrevistador: ${opening}`);

      // Hablar (con delay). Si falla, no rompemos.
      try {
        await sleep(600);
        await avatar.current!.speak({
          taskRequest: { text: opening, sessionId: res.sessionId },
        });
      } catch (e: any) {
        console.warn("⚠️ HeyGen speak inicial falló (no bloqueamos la sesión):", e);
        setDebug("⚠️ El avatar se ha iniciado, pero el primer mensaje falló. Pulsa Start otra vez si no habla.");
      }
    } catch (err: any) {
      console.error("Error al iniciar avatar:", err);
      setDebug("Ha ocurrido un problema al iniciar el avatar.");
    }
  }

  // Cargar el video stream en el <video>
  useEffect(() => {
    if (stream && mediaStream.current) {
      mediaStream.current.srcObject = stream;
      mediaStream.current.onloadedmetadata = () => {
        mediaStream.current!.play();
      };
    }
  }, [stream]);

  // ✅ OpenAI via BACKEND
  async function openaiChat(messages: any[], opts?: { model?: string; temperature?: number }) {
    const res = await fetch(`${API_BASE}/api/openai/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages,
        model: opts?.model || "gpt-4.1-mini",
        temperature: typeof opts?.temperature === "number" ? opts.temperature : 0.4,
      }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(json?.detail || json?.error || `OpenAI chat error (HTTP ${res.status})`);
    }
    return String(json?.text || "").trim();
  }

  async function runInterviewTurn(answerText: string) {
    const cleanedAnswer = answerText.trim();
    if (!cleanedAnswer) return setDebug("Respuesta vacía.");
    if (!script) return setDebug("No se ha cargado el guion de la entrevista.");
    if (!data?.sessionId) return setDebug("Primero pulsa Start para iniciar la sesión.");
    if (isFinished) return setDebug("La entrevista ya ha terminado.");

    const currentQuestion =
      questionIndex < script.questions.length ? script.questions[questionIndex] : null;
    const nextQuestion =
      questionIndex + 1 < script.questions.length ? script.questions[questionIndex + 1] : null;

    const updatedConversation = conversation + `\nEntrevistado: ${cleanedAnswer}`;

    const userPrompt = `
Objetivo de la entrevista: ${script.objective}
Tono deseado: ${script.tone}

Pregunta actual del guion:
${currentQuestion ? `"${currentQuestion}"` : "(no queda pregunta en el guion)"}

${nextQuestion ? `Siguiente pregunta del guion: "${nextQuestion}"` : "No quedan más preguntas en el guion."}

Conversación hasta ahora (Entrevistador = IA, Entrevistado = humano):
${updatedConversation}

Instrucciones para tu siguiente respuesta:
- Resume o valida brevemente lo que acaba de decir el entrevistado.
- Si aún no has hecho la pregunta actual del guion, hazla ahora.
- Si ya se ha respondido bien, enlaza de forma natural con la SIGUIENTE pregunta del guion (si existe).
- Si NO quedan más preguntas en el guion, agradece y cierra la entrevista en 2–3 frases sin abrir nuevos temas.
- No más de 3 frases en total.
- Mantén un tono cercano, humano y profesional.
`.trim();

    const assistantText = await openaiChat(
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      { model: "gpt-4.1-mini", temperature: 0.4 }
    );

    if (!assistantText) return setDebug("No he recibido respuesta del backend OpenAI.");

    const finalConversation = updatedConversation + `\nEntrevistador: ${assistantText}`;
    setConversation(finalConversation);

    if (nextQuestion) setQuestionIndex((prev) => prev + 1);
    else setIsFinished(true);

    await avatar.current?.speak({
      taskRequest: { text: assistantText, sessionId: data.sessionId },
    });
  }

  // ✅ Whisper via BACKEND
  async function transcribeOnBackend(audioBlob: Blob) {
    const formData = new FormData();
    formData.append("file", audioBlob, "audio.webm");
    formData.append("model", "whisper-1");
    formData.append("language", "es");

    const res = await fetch(`${API_BASE}/api/openai/transcribe`, {
      method: "POST",
      body: formData,
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(json?.detail || json?.error || `Transcribe error (HTTP ${res.status})`);
    }

    return String(json?.text || "").trim();
  }

  async function startRecording() {
    try {
      if (isFinished) return;
      if (!data?.sessionId) return setDebug("Primero pulsa Start para iniciar la sesión.");

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      mediaRecorder.onstop = async () => {
        try {
          const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
          const transcript = await transcribeOnBackend(audioBlob);
          if (!transcript) return setDebug("No se ha podido transcribir el audio (texto vacío).");

          setDebug("");
          await runInterviewTurn(transcript);
        } catch (e: any) {
          setDebug(e?.message || "Error transcribiendo audio");
        }
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start();
      setIsRecording(true);
      setDebug("Grabando… Cuando termines, pulsa ‘Detener grabación’.");
    } catch (e: any) {
      setDebug(e?.message || "Error iniciando grabación de audio");
    }
  }

  function stopRecording() {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach((track) => track.stop());
      setIsRecording(false);
      setDebug("Procesando audio…");
    }
  }

  if (isLoadingConfig) {
    return (
      <div className="HeyGenStreamingAvatar">
        <header className="App-header">
          <p>Cargando entrevista…</p>
        </header>
      </div>
    );
  }

  if (configError) {
    return (
      <div className="HeyGenStreamingAvatar">
        <header className="App-header">
          <div className="BrandBar" style={{ justifyContent: "center" }}>
            <img src="/logo.png" alt="FLAV.AI" style={{ height: 34 }} />
          </div>

          <h1>❌ Problema con el enlace</h1>
          <p style={{ maxWidth: 600 }}>{configError}</p>
          {!!debug && !IS_PROD && (
            <p style={{ marginTop: 12, fontSize: 11, opacity: 0.5 }}>
              (Detalle técnico: {debug})
            </p>
          )}
        </header>
      </div>
    );
  }

  const voiceDisabled = isFinished || !data?.sessionId;

  return (
    <div className="HeyGenStreamingAvatar">
      <header className="App-header">
        <div className="CandidateHero">
          <h1 style={{ marginTop: 14 }}>Entrevista experiencia</h1>

          <p className="CandidateIntro">
            Pulsa <strong>Start</strong> para iniciar. Para responder, pulsa{" "}
            <strong>Responder por voz</strong>, habla y después pulsa{" "}
            <strong>Detener grabación</strong>.
          </p>

          <div className="CandidateButtonsRow">
            <button className="PrimaryFlavButton" onClick={grab} disabled={isFinished}>
              Start
            </button>

            <button
              className="PrimaryFlavButton"
              onClick={isRecording ? stopRecording : startRecording}
              disabled={voiceDisabled}
              title={voiceDisabled ? "Primero pulsa Start" : undefined}
            >
              {isRecording ? "🔴 Detener grabación" : "🎤 Responder por voz"}
            </button>
          </div>

          {/* ✅ Solución A: debug NO visible en producción */}
          {!!debug && !IS_PROD && (
            <p style={{ marginTop: 10, fontSize: 13, opacity: 0.9, maxWidth: 720 }}>
              {debug}
            </p>
          )}
        </div>

        <div className="MediaPlayer" style={{ marginTop: 22 }}>
          <video playsInline autoPlay width={450} ref={mediaStream}></video>
        </div>
      </header>
    </div>
  );
};

export default CandidatePage;
