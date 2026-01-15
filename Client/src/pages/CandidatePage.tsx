// Client/src/pages/CandidatePage.tsx
import React, { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";

import { Configuration, NewSessionData, StreamingAvatarApi } from "@heygen/streaming-avatar";
import "../App.css";

// ✅ FIX: si falta env en Render, usa PROD por defecto (NO localhost)
const API_BASE = (process.env.REACT_APP_API_BASE_URL || "https://api.flavaai.com").trim();

// ✅ En producción NO mostramos debug al candidato
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
Eres un/a entrevistador/a de investigación cualitativa (senior) especializado/a en experiencia de cliente (CX) en restauración.

Contexto
- Estás entrevistando a personas sobre su experiencia real en un restaurante.
- NO estás evaluando productos aislados (comida/bebida) como “test de producto”, sino la experiencia completa: llegada, espera, atención, ambiente, tiempos, interacción con el personal, incidencias, cierre y percepción global.

Objetivo
- Obtener respuestas concretas, honestas y útiles para mejorar el servicio y la experiencia.
- Hacer que el entrevistado se sienta cómodo/a: tono humano, cercano y profesional.

Reglas de interacción (muy importante)
- Haz UNA sola intervención cada vez.
- Sigue ESTRICTAMENTE el orden de la lista de preguntas (guion). No inventes nuevas preguntas fuera del guion.
- Antes de avanzar, valida o resume en 1 frase lo que dijo el entrevistado (sin juzgar), pero que no suene repetititvo ni sienta que solo repites lo que acaba de contestar, quiero que aportes valor y lo digas en otras palabras.
- Mantén tus respuestas cortas: máximo 2–3 frases.
- Si la respuesta es vaga, haz SOLO un sondeo breve (una pregunta de aclaración) y luego vuelve al guion.
- Pide ejemplos cuando aporte valor: “¿Puedes darme un ejemplo?” / “¿Qué pasó exactamente?” (máx. 1 pregunta extra).
- No sugieras soluciones, no discutas, no contradigas, no moralices.
- No menciones “prompt”, “modelo”, “OpenAI” ni detalles técnicos.

Guía de sondeo (elige solo UNA cuando haga falta)
- Claridad: “¿A qué te refieres con…?”
- Ejemplo: “¿Puedes contarme un momento concreto?”
- Impacto: “¿Cómo te hizo sentir / qué efecto tuvo?”
- Detalle operativo: “¿Cuánto tiempo esperaste aproximadamente?” / “¿En qué parte ocurrió?”

Cierre
- Cuando se acaben las preguntas del guion: agradece, confirma que has terminado y despídete de forma amable.
- No abras temas nuevos en el cierre.
`.trim();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchWithTimeout(url: string, init: RequestInit, ms: number, label: string) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);

  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    return res;
  } catch (e: any) {
    if (e?.name === "AbortError") throw new Error(`${label} timeout (${ms}ms)`);
    throw e;
  } finally {
    clearTimeout(t);
  }
}

// ✅ POST seguro al backend para guardar summary (con timeout + trazas)
async function saveSummaryToBackend(interviewId: string, summary: string, rawConversation?: string) {
  const url = `${API_BASE}/api/save-summary`;

  console.log("➡️ saveSummaryToBackend POST", {
    url,
    interviewId,
    summaryLen: summary?.length || 0,
    rawLen: rawConversation?.length || 0,
  });

  const res = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ interviewId, summary, rawConversation }),
    },
    25000,
    "save-summary"
  );

  const txt = await res.text().catch(() => "");
  console.log("⬅️ saveSummaryToBackend RESP", { ok: res.ok, status: res.status, body: txt?.slice?.(0, 240) });

  if (!res.ok) {
    throw new Error(txt || `Error guardando summary (HTTP ${res.status})`);
  }

  console.log("✅ saveSummaryToBackend OK");
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

  // ✅ que el avatar inicie hablando al cargar el stream (solo 1 vez)
const openingRef = useRef<string>("");
const hasSpokenOpeningRef = useRef(false);

  const [script, setScript] = useState<InterviewScript | null>(null);
  const [conversation, setConversation] = useState("");
  const [questionIndex, setQuestionIndex] = useState(0);
  const [isFinished, setIsFinished] = useState(false);

  const [isSummarizing, setIsSummarizing] = useState(false);
  const hasSavedRef = useRef(false);

  // ✅ estado visible SIEMPRE (también en PROD)
  const [summaryStatus, setSummaryStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [summaryErrorMsg, setSummaryErrorMsg] = useState<string>("");

  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // ✅ overlay “tu entrevistador se está uniendo…”
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectingMsg, setConnectingMsg] = useState(
    "Tu entrevistador se está uniendo a la llamada. Por favor espere unos breves instantes y asegúrese de tener una conexión estable a internet. Si no funciona, refresque la página del navegador y vuelva a internarlo."
  );

  // =====================================================
  // ✅ PROXY HeyGen (arregla CORS del SDK sin reescribirlo).
  // =====================================================
  useEffect(() => {
    const originalFetch = window.fetch.bind(window);

    window.fetch = async (input: any, init?: any) => {
      try {
        if (typeof input === "string" && input.startsWith("https://api.heygen.com/")) {
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

  // =====================================================
  // ✅ Inicialización avatar (HeyGen) - SIN API KEY EN CLIENT
  // =====================================================
  useEffect(() => {
    const startTalkCallback = (e: any) => console.log("Avatar started talking", e);
    const stopTalkCallback = (e: any) => console.log("Avatar stopped talking", e);

    if (!avatar.current) {
      avatar.current = new StreamingAvatarApi(
        new Configuration({
          accessToken: "proxy",
        } as any)
      );

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

  async function grab() {
    try {
      if (!script) return setDebug("No se ha cargado el guion de la entrevista.");
      if (isRecording) return setDebug("Primero detén la grabación antes de iniciar de nuevo.");

      if (!avatar.current) {
        avatar.current = new StreamingAvatarApi(
          new Configuration({
            accessToken: "proxy",
          } as any)
        );
      }

      if (!avatarId || !voiceId) return setDebug("Hay un problema con la configuración del avatar.");

      hasSavedRef.current = false;
      setIsSummarizing(false);

      setSummaryStatus("idle");
      setSummaryErrorMsg("");

      setConnectingMsg(
        "Tu entrevistador se está uniendo a la llamada. Por favor espere unos breves instantes y asegúrese de tener una conexión estable a internet. Si no funciona, refresque la página del navegador y vuelva a internarlo"
      );
      setIsConnecting(true);

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

// ✅ (mejora) añade un espacio antes de la primera pregunta
const opening =
  "Hola, gracias por estar aquí. Soy tu entrevistador virtual. Esta entrevista es para entender tu experiencia real en un restaurante. " +
  (firstQuestion || "");

// ✅ guardamos el opening para decirlo cuando el stream esté listo
openingRef.current = opening;
hasSpokenOpeningRef.current = false;

setConversation(`Entrevistador: ${opening}`);

// ⛔ NO hacemos speak aquí. Se hará en onloadeddata cuando el avatar ya esté visible.

    } catch (err: any) {
      console.error("Error al iniciar avatar:", err);
      setDebug("Ha ocurrido un problema al iniciar el avatar.");
      setIsConnecting(false);
    }
  }

  useEffect(() => {
    if (stream && mediaStream.current) {
      const videoEl = mediaStream.current;

      videoEl.srcObject = stream;

      const handleLoadedData = async () => {
  setIsConnecting(false);
  videoEl.muted = false;
  videoEl.volume = 1;

  // ✅ cuando el avatar ya está cargado/visible, inicia hablando
  try {
    if (!hasSpokenOpeningRef.current && openingRef.current && data?.sessionId) {
      hasSpokenOpeningRef.current = true;

      // pequeño buffer para estabilidad del stream
      await sleep(400);

      await avatar.current?.speak({
        taskRequest: { text: openingRef.current, sessionId: data.sessionId },
      });
    }
  } catch (e) {
    console.warn("⚠️ Opening speak falló:", e);
    // si quieres reintentar en caso de fallo, comenta la siguiente línea:
    // hasSpokenOpeningRef.current = false;
  }
};


      const handleError = () => {
        setIsConnecting(false);
        setDebug("No se pudo cargar el vídeo del entrevistador. Revisa tu conexión e inténtalo de nuevo.");
      };

      videoEl.onloadeddata = handleLoadedData;
      videoEl.onerror = handleError as any;

      videoEl.onloadedmetadata = () => {
        videoEl.muted = false;
        videoEl.volume = 1;
        videoEl.play().catch(() => {});
      };

      return () => {
        videoEl.onloadeddata = null;
        videoEl.onerror = null;
        videoEl.onloadedmetadata = null;
      };
    }
  }, [stream, data]);

  // ✅ OpenAI via BACKEND (con timeout)
  async function openaiChat(messages: any[], opts?: { model?: string; temperature?: number }) {
    const url = `${API_BASE}/api/openai/chat`;
    const res = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages,
          model: opts?.model || "gpt-4.1-mini",
          temperature: typeof opts?.temperature === "number" ? opts.temperature : 0.4,
        }),
      },
      25000,
      "openai-chat"
    );

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(json?.detail || json?.error || `OpenAI chat error (HTTP ${res.status})`);
    }
    return String(json?.text || "").trim();
  }

  async function buildInterviewSummary(fullConversation: string) {
    const prompt = `
Actúa como un/a investigador/a senior en sociología y estudios cualitativos, con amplia experiencia en Voice of the Customer (VoC), Customer Experience (CX) y análisis de experiencia en restauración.

Contexto
- Estás analizando UNA entrevista individual a un cliente sobre su experiencia real en un restaurante.
- El objetivo NO es evaluar productos concretos (platos, bebidas, recetas), sino la experiencia completa del cliente:
  llegada, espera, atención, interacción con el personal, ambiente, tiempos, incidencias y percepción global.

Instrucciones clave
- Basa el análisis EXCLUSIVAMENTE en lo que el entrevistado ha dicho explícitamente.
- No inventes información ni completes con suposiciones.
- Si la entrevista es breve, superficial o con poco contenido, indícalo claramente.
- Distingue entre:
  • Hechos observados por el cliente  
  • Percepciones/emociones  
  • Interpretaciones del analista (siempre justificadas)

Tarea
Genera un RESUMEN INDIVIDUAL claro, sintético y accionable, pensado para decisores (dirección, CX, operaciones).

Formato de salida (en español):

1) Resumen ejecutivo  
- 4–6 líneas máximo  
- Visión global de la experiencia del cliente  
- Nivel de satisfacción percibido  
- Qué ha pesado más en su percepción (personas, tiempos, ambiente, etc.)

2) Insights clave  
- Bullet points  
- Solo aprendizajes relevantes y accionables  
- Prioriza patrones o señales claras (aunque sean pocas)

3) Fricciones / pain points  
- Bullet points  
- Incluye solo fricciones mencionadas explícitamente  
- Si no hay fricciones claras, indícalo (“No se identifican fricciones relevantes en esta entrevista”)

4) Oportunidades / recomendaciones  
- Bullet points  
- Derivadas directamente de los insights y fricciones  
- Enfocadas a mejora de experiencia (no a marketing genérico)

5) Cita textual representativa  
- 1–2 frases literales del entrevistado, si existe material  
- Si no hay ninguna cita relevante, indícalo explícitamente

Tono
- Profesional, analítico y claro
- Sin lenguaje promocional ni conclusiones exageradas
- Orientado a facilitar la toma de decisiones


Transcripción (formato diálogo):
${fullConversation}
`.trim();

    const summary = await openaiChat(
      [
        { role: "system", content: "Eres un/a investigador/a cualitativo/a senior." },
        { role: "user", content: prompt },
      ],
      { model: "gpt-4.1-mini", temperature: 0.3 }
    );

    return summary;
  }

  async function runInterviewTurn(answerText: string) {
    const cleanedAnswer = answerText.trim();
    if (!cleanedAnswer) return setDebug("Respuesta vacía.");
    if (!script) return setDebug("No se ha cargado el guion de la entrevista.");
    if (!data?.sessionId) return setDebug("Primero pulsa Start para iniciar la sesión.");
    if (isFinished) return setDebug("La entrevista ya ha terminado.");

    const currentQuestion = questionIndex < script.questions.length ? script.questions[questionIndex] : null;
    const nextQuestion = questionIndex + 1 < script.questions.length ? script.questions[questionIndex + 1] : null;

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
- Resume o valida brevemente lo que acaba de decir el entrevistado, pero que no parezca que repites todo el rato lo que dice, simplemente que le demuestre que le has entendido
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

    // ✅ Al terminar: generar + guardar resumen UNA vez (ROBUSTO)
  const isSavingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      // 🔎 log de control (lo verás siempre)
      console.log("🔎 saveSummary check", {
        apiBase: API_BASE,
        isFinished,
        interviewToken,
        hasSaved: hasSavedRef.current,
        isSaving: isSavingRef.current,
        convLen: conversation?.length || 0,
      });

      try {
        if (!isFinished) return;
        if (!interviewToken) return;

        // ✅ si ya se guardó, no repetimos
        if (hasSavedRef.current) return;

        // ✅ si ya hay un guardado en curso, no duplicamos
        if (isSavingRef.current) return;

        if (!conversation || conversation.trim().length < 30) {
          console.warn("⚠️ No guardo: conversación demasiado corta.");
          return;
        }

        // ⛔️ IMPORTANTE: NO marcar hasSaved aquí
        isSavingRef.current = true;
        setIsSummarizing(true);
        setSummaryStatus("saving");
        setSummaryErrorMsg("");

        console.log("🧾 FIN entrevista -> generar resumen", {
          interviewToken,
          convLen: conversation.length,
        });

        const summary = await buildInterviewSummary(conversation);
        if (cancelled) return;

        console.log("✅ Resumen generado. Ahora guardo en backend...", {
          summaryLen: summary?.length || 0,
        });

        // 1) Intento normal
        try {
          await saveSummaryToBackend(interviewToken, summary, conversation);
        } catch (e1: any) {
          // 2) Reintento (cold start / glitch)
          console.warn("⚠️ save-summary falló, reintentando…", e1?.message || e1);
          await sleep(1200);
          await saveSummaryToBackend(interviewToken, summary, conversation);
        }

        if (cancelled) return;

        // ✅ SOLO aquí marcamos como guardado
        hasSavedRef.current = true;

        setSummaryStatus("saved");
        console.log("✅✅ Guardado confirmado en backend (/api/save-summary).");
      } catch (e: any) {
        console.error("❌ Error generando/guardando el resumen:", e);

        // ✅ si falla, NO bloqueamos futuros reintentos
        hasSavedRef.current = false;

        setSummaryStatus("error");
        setSummaryErrorMsg(e?.message || "Error guardando el resumen.");
      } finally {
        if (!cancelled) {
          isSavingRef.current = false;
          setIsSummarizing(false);
        }
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [isFinished, interviewToken, conversation]);

  // ✅ Whisper via BACKEND (con timeout)
  async function transcribeOnBackend(audioBlob: Blob) {
    const formData = new FormData();
    formData.append("file", audioBlob, "audio.webm");
    formData.append("model", "whisper-1");
    formData.append("language", "es");

    const url = `${API_BASE}/api/openai/transcribe`;
    const res = await fetchWithTimeout(url, { method: "POST", body: formData }, 25000, "transcribe");

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

  const voiceDisabled = isFinished || !data?.sessionId || isConnecting || isSummarizing;

  return (
    <div className="HeyGenStreamingAvatar">
      {isConnecting && (
        <div className="ConnectingOverlay" role="status" aria-live="polite">
          <div className="ConnectingBox">
            <div className="ConnectingSpinner" />
            <div className="ConnectingTitle">Tu entrevistador se está uniendo a la llamada</div>
            <div className="ConnectingText">{connectingMsg}</div>
          </div>
        </div>
      )}

      <header className="App-header">
        <div className="CandidateHero">
          <h1 style={{ marginTop: 14 }}>Entrevista experiencia</h1>

          <p className="CandidateIntro">
            Pulsa <strong>Start</strong> para iniciar. Para responder, pulsa{" "}
            <strong>Responder al avatar</strong>, habla y después pulsa{" "}
            <strong>Terminar respuesta</strong>.
          </p>

          <div className="CandidateButtonsRow">
            <button
              className="PrimaryFlavButton"
              onClick={grab}
              disabled={isFinished || isConnecting || isSummarizing}
            >
              {isConnecting ? "Conectando…" : isSummarizing ? "Guardando…" : "Start"}
            </button>

            <button
              className="PrimaryFlavButton"
              onClick={isRecording ? stopRecording : startRecording}
              disabled={voiceDisabled}
              title={
                voiceDisabled
                  ? isSummarizing
                    ? "Guardando resumen…"
                    : isConnecting
                      ? "Conectando…"
                      : "Primero pulsa Start"
                  : undefined
              }
            >
              {isRecording ? "🔴 Terminar respuesta" : "🎤 Responder al avatar"}
            </button>
          </div>

          {(summaryStatus === "saving" || summaryStatus === "saved" || summaryStatus === "error") && (
            <div style={{ marginTop: 10, fontSize: 13, opacity: 0.92 }}>
              {summaryStatus === "saving" && "⏳ Guardando resumen de la entrevista…"}
              {summaryStatus === "saved" && "✅ Resumen guardado correctamente."}
              {summaryStatus === "error" && <span>❌ No se pudo guardar el resumen. {summaryErrorMsg}</span>}
            </div>
          )}

          {!!debug && !IS_PROD && (
            <p style={{ marginTop: 10, fontSize: 13, opacity: 0.9, maxWidth: 720 }}>{debug}</p>
          )}

          <div className="MediaPlayer" style={{ marginTop: 22 }}>
            <div className="AvatarFrame">
              <video ref={mediaStream} className="AvatarVideo" playsInline autoPlay />

              {isFinished && (
                <div className="AvatarOverlay" role="status" aria-live="polite">
                  <div className="AvatarOverlayBox">
                    <div className="AvatarOverlayTitle">✅ Entrevista finalizada ✅</div>
                    <div className="AvatarOverlayText">
                      Muchas gracias por tu tiempo
                      <br />
                      Ya puedes cerrar esta pestaña del navegador
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>
    </div>
  );
};

export default CandidatePage;
