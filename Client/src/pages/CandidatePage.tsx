// src/pages/CandidatePage.tsx
// Página que usa el candidato: carga la config desde localStorage
// y NO deja tocar ni el guion ni los IDs del avatar.
// El resumen se genera en segundo plano y se guarda en tu backend.

import React, { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";

import {
  Configuration,
  NewSessionData,
  StreamingAvatarApi,
} from "@heygen/streaming-avatar";
import "../App.css";

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
`;

// ✅ helper: POST seguro al backend para guardar summary
async function saveSummaryToBackend(
  interviewId: string,
  summary: string,
  rawConversation?: string
) {
  const res = await fetch("http://localhost:3001/api/save-summary", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ interviewId, summary, rawConversation }),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(txt || `Error guardando summary (HTTP ${res.status})`);
  }
}

const CandidatePage: React.FC = () => {
  // ✅ IMPORTANTÍSIMO: renombramos para no pisarlo con otras variables internas
  const { token: interviewToken } = useParams<{ token: string }>();

  // Estado de carga de la config
  const [isLoadingConfig, setIsLoadingConfig] = useState(true);
  const [configError, setConfigError] = useState<string | null>(null);

  // 🔧 Estado general
  const [stream, setStream] = useState<MediaStream>();
  const [debug, setDebug] = useState<string>("");
  const avatar = useRef<StreamingAvatarApi | null>(null);

  const [avatarId, setAvatarId] = useState("");
  const [voiceId, setVoiceId] = useState("");

  const [data, setData] = useState<NewSessionData>();
  const mediaStream = useRef<HTMLVideoElement>(null);

  // 🔹 Estado de entrevista
  const [script, setScript] = useState<InterviewScript | null>(null);
  const [conversation, setConversation] = useState("");
  const [questionIndex, setQuestionIndex] = useState(0);
  const [userAnswer, setUserAnswer] = useState("");
  const [isFinished, setIsFinished] = useState(false);

  // 🔹 Estado resumen (solo para saber si se está generando)
  const [isSummarizing, setIsSummarizing] = useState(false);

  // 🔹 Texto manual (debug opcional)
  const [manualText, setManualText] = useState("");

  // 🎙️ Estado para modo voz
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // -------------------------------------------------------------
  // 1) CARGAR CONFIG DESDE LOCALSTORAGE
  // -------------------------------------------------------------
  useEffect(() => {
    if (!interviewToken) {
      setConfigError(
        "Falta el identificador de entrevista en la URL. Pide un nuevo enlace al equipo."
      );
      setIsLoadingConfig(false);
      return;
    }

    const raw = localStorage.getItem(`interview-config-${interviewToken}`);
    if (!raw) {
      setConfigError(
        "No he encontrado la configuración de esta entrevista. Pide un nuevo enlace al equipo."
      );
      setIsLoadingConfig(false);
      return;
    }

    try {
      const parsed: StoredConfig = JSON.parse(raw);

      setScript({
        objective: parsed.objective,
        tone: parsed.tone,
        questions: parsed.questions,
      });
      setAvatarId(parsed.avatarId);
      setVoiceId(parsed.voiceId);

      setIsLoadingConfig(false);
    } catch (e) {
      console.error(e);
      setConfigError(
        "La configuración guardada está dañada. Pide un nuevo enlace al equipo."
      );
      setIsLoadingConfig(false);
    }
  }, [interviewToken]);

  // -------------------------------------------------------------
  // 2) Inicialización del avatar (HeyGen)
  // -------------------------------------------------------------
  useEffect(() => {
    const startTalkCallback = (e: any) =>
      console.log("Avatar started talking", e);
    const stopTalkCallback = (e: any) =>
      console.log("Avatar stopped talking", e);

    if (!avatar.current) {
      const heygenKey = process.env.REACT_APP_HEYGEN_API_KEY;
      if (!heygenKey) {
        console.error(
          "Falta REACT_APP_HEYGEN_API_KEY en el .env de Client. (Reinicia npm start tras añadirla)"
        );
        return;
      }

      avatar.current = new StreamingAvatarApi(
        new Configuration({
          accessToken: heygenKey,
        })
      );

      avatar.current.addEventHandler("avatar_start_talking", startTalkCallback);
      avatar.current.addEventHandler("avatar_stop_talking", stopTalkCallback);
    }

    return () => {
      if (avatar.current) {
        avatar.current.removeEventHandler(
          "avatar_start_talking",
          startTalkCallback
        );
        avatar.current.removeEventHandler(
          "avatar_stop_talking",
          stopTalkCallback
        );
      }
    };
  }, []);

  // -------------------------------------------------------------
  // INICIAR AVATAR
  // -------------------------------------------------------------
  async function grab() {
    try {
      if (!script) {
        setDebug("No se ha cargado el guion de la entrevista.");
        return;
      }

      if (!avatar.current) {
        const heygenKey = process.env.REACT_APP_HEYGEN_API_KEY;
        if (!heygenKey) {
          console.error(
            "Falta REACT_APP_HEYGEN_API_KEY en el .env de Client. (Reinicia npm start tras añadirla)"
          );
          return;
        }

        avatar.current = new StreamingAvatarApi(
          new Configuration({
            accessToken: heygenKey,
          })
        );
      }

      if (!avatarId || !voiceId) {
        setDebug("Hay un problema con la configuración del avatar.");
        return;
      }

      // Reset de estado
      setIsFinished(false);
      setConversation("");
      setQuestionIndex(0);

      const res = await avatar.current!.createStartAvatar(
        {
          newSessionRequest: {
            quality: "high",
            avatarName: avatarId,
            voice: { voiceId },
          },
        },
        (msg: string) => {
          console.log("HeyGen debug:", msg);
        }
      );

      setData(res);
      setStream(avatar.current!.mediaStream);

      const firstQuestion = script.questions[0];
      const opening =
        "Hola, gracias por tu tiempo. Vamos a comenzar la entrevista. " +
        (firstQuestion || "");

      const initialConversation = `Entrevistador: ${opening}`;
      setConversation(initialConversation);

      await avatar.current!.speak({
        taskRequest: {
          text: opening,
          sessionId: res.sessionId,
        },
      });
    } catch (err: any) {
      console.error("Error al iniciar avatar:", err);
      setDebug("Ha ocurrido un problema al iniciar el avatar.");
    }
  }

  // -------------------------------------------------------------
  // DETENER AVATAR
  // -------------------------------------------------------------
  async function stop() {
    try {
      if (!data?.sessionId) return;

      await avatar.current?.stopAvatar(
        { stopSessionRequest: { sessionId: data.sessionId } },
        (msg: string) => console.log("Stop debug:", msg)
      );

      // ✅ Si paran antes de acabar, intentamos generar summary igualmente
      setIsFinished(true);
      if (interviewToken && conversation.trim()) {
        handleGenerateSummary(interviewToken, conversation).catch((e) =>
          console.error("Error generando resumen al parar:", e)
        );
      }
    } catch (err: any) {
      console.error("Error al detener avatar:", err);
      setDebug("Ha ocurrido un problema al detener el avatar.");
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

  // -------------------------------------------------------------
  // NÚCLEO: turno de entrevista (texto o voz)
  // -------------------------------------------------------------
  async function runInterviewTurn(answerText: string) {
    const cleanedAnswer = answerText.trim();
    if (!cleanedAnswer) {
      setDebug("Respuesta vacía.");
      return;
    }
    if (!script) {
      setDebug("No se ha cargado el guion de la entrevista.");
      return;
    }
    if (!data?.sessionId) {
      setDebug("No hay sesión activa. Pulsa Start primero.");
      return;
    }
    if (isFinished) {
      setDebug("La entrevista ya ha terminado.");
      return;
    }

    const apiKey = process.env.REACT_APP_OPENAI_API_KEY;
    if (!apiKey) {
      setDebug("Falta REACT_APP_OPENAI_API_KEY en .env (Client).");
      return;
    }

    const currentQuestion =
      questionIndex < script.questions.length
        ? script.questions[questionIndex]
        : null;

    const nextQuestion =
      questionIndex + 1 < script.questions.length
        ? script.questions[questionIndex + 1]
        : null;

    const updatedConversation =
      conversation + `\nEntrevistado: ${cleanedAnswer}`;

    const userPrompt = `
Objetivo de la entrevista: ${script.objective}
Tono deseado: ${script.tone}

Pregunta actual del guion:
${currentQuestion ? `"${currentQuestion}"` : "(no queda pregunta en el guion)"}

${
  nextQuestion
    ? `Siguiente pregunta del guion: "${nextQuestion}"`
    : "No quedan más preguntas en el guion."
}

Conversación hasta ahora (Entrevistador = IA, Entrevistado = humano):
${updatedConversation}

Instrucciones para tu siguiente respuesta:
- Resume o valida brevemente lo que acaba de decir el entrevistado.
- Si aún no has hecho la pregunta actual del guion, hazla ahora.
- Si ya se ha respondido bien, enlaza de forma natural con la SIGUIENTE pregunta del guion (si existe).
- Si NO quedan más preguntas en el guion, agradece y cierra la entrevista en 2–3 frases sin abrir nuevos temas.
- No más de 3 frases en total.
- Mantén un tono cercano, humano y profesional.
`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    const json = await response.json();
    const assistantText: string =
      json.choices?.[0]?.message?.content?.trim() || "";

    if (!assistantText) {
      setDebug("No he recibido respuesta de OpenAI.");
      return;
    }

    const finalConversation =
      updatedConversation + `\nEntrevistador: ${assistantText}`;
    setConversation(finalConversation);

    if (nextQuestion) {
      setQuestionIndex((prev) => prev + 1);
    } else {
      setIsFinished(true);

      if (interviewToken) {
        handleGenerateSummary(interviewToken, finalConversation).catch((e) =>
          console.error("Error generando resumen automático:", e)
        );
      }
    }

    await avatar.current
      ?.speak({
        taskRequest: {
          text: assistantText,
          sessionId: data.sessionId,
        },
      })
      .catch((e) => console.error("Error speak avatar:", e));
  }

  async function handleInterviewTurn() {
    if (!userAnswer.trim()) {
      setDebug("Escribe tu respuesta antes de continuar.");
      return;
    }
    const answer = userAnswer;
    setUserAnswer("");
    await runInterviewTurn(answer);
  }

  // -------------------------------------------------------------
  // MODO VOZ (Whisper)
  // -------------------------------------------------------------
  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, {
          type: "audio/webm",
        });

        const apiKey = process.env.REACT_APP_OPENAI_API_KEY;
        if (!apiKey) {
          console.error(
            "Falta REACT_APP_OPENAI_API_KEY para transcribir audio (Whisper)."
          );
          return;
        }

        try {
          const formData = new FormData();
          formData.append("file", audioBlob, "audio.webm");
          formData.append("model", "whisper-1");
          formData.append("language", "es");

          const res = await fetch(
            "https://api.openai.com/v1/audio/transcriptions",
            {
              method: "POST",
              headers: { Authorization: `Bearer ${apiKey}` },
              body: formData,
            }
          );

          const json = await res.json();
          const transcript: string = json.text?.trim() || "";

          if (!transcript) {
            setDebug("No se ha podido transcribir el audio (texto vacío).");
            return;
          }

          setDebug(`Transcripción detectada: "${transcript}"`);
          await runInterviewTurn(transcript);
        } catch (e: any) {
          console.error("Error transcribiendo audio:", e);
          setDebug(e?.message || "Error transcribiendo audio");
        }
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start();
      setIsRecording(true);
      setDebug("Grabando respuesta por voz…");
    } catch (e: any) {
      console.error("Error iniciando grabación:", e);
      setDebug(e?.message || "Error iniciando grabación de audio");
    }
  }

  function stopRecording() {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach((track) => track.stop());
      setIsRecording(false);
      setDebug("Procesando audio y enviando a Whisper…");
    }
  }

  // -------------------------------------------------------------
  // FUNCIÓN: generar y guardar resumen (NO se muestra al candidato)
  // -------------------------------------------------------------
  async function handleGenerateSummary(interviewId: string, fullConversation: string) {
    try {
      if (!fullConversation.trim()) return;

      const apiKey = process.env.REACT_APP_OPENAI_API_KEY;
      if (!apiKey) {
        console.error("Falta REACT_APP_OPENAI_API_KEY en .env (Client).");
        return;
      }

      setIsSummarizing(true);

      const prompt = `
Eres un/a Research Lead (Market/UX Insights) en una consultora top.
A continuación tienes la transcripción completa de una entrevista entre un entrevistador (IA) y un entrevistado humano.

Tu tarea: generar un informe MUY visual, profesional y escaneable (estilo deliverable).
Debe ser claro para negocio/producto y fácil de copiar a una slide.

REGLAS DE FORMATO (OBLIGATORIAS):
- Escribe en ESPAÑOL.
- Usa Markdown limpio y consistente (títulos, listas, separadores).
- Nada de párrafos largos: máx 2 líneas por párrafo.
- Evita “texto de IA”, evita redundancias y evita repetir literal la conversación.
- Mantén bullets NO ejecutivos con algo de detalle.
- No inventes datos. Si falta información, indícalo como “(no se mencionó)”.

ESTRUCTURA EXACTA (respétala):

# Informe de entrevista

## 1) Resumen ejecutivo (1 frase)
- Una única frase, contundente, que resuma el perfil + 1-2 hallazgos clave.

## 2) Insights clave (5)
- **[EMOJI] Título del insight (máx 6 palabras)**
  **Qué significa:** …
  **Evidencia:** …
  **Implicación:** …

## 3) Citas textuales (3)
> “Cita corta y representativa”
- Contexto: …

## 4) Oportunidades / recomendaciones accionables (4-6)
- ⬜ **Acción concreta** — Impacto esperado | Esfuerzo: Bajo/Medio/Alto

## 5) Persona Snapshot
- Nombre ficticio
- Rol / contexto
- 3 adjetivos
- Objetivos
- Frustraciones
- Necesidades

## 6) Señales y riesgos
- Señales fuertes
- Lo que falta validar

ENTREVISTA COMPLETA:
${fullConversation}
`.trim();

      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          messages: [{ role: "user", content: prompt }],
          temperature: 0.4,
        }),
      });

      const json = await response.json();
      const summaryText: string = json.choices?.[0]?.message?.content?.trim() || "";

      if (!summaryText) {
        setIsSummarizing(false);
        return;
      }

      // ✅ guardado robusto: si falla lo vemos
      await saveSummaryToBackend(interviewId, summaryText, fullConversation);

      setDebug("Resumen generado y enviado al equipo. Puedes cerrar esta ventana cuando quieras.");
      setIsSummarizing(false);
    } catch (e: any) {
      console.error("Error generando / guardando resumen:", e);
      setDebug(e?.message || "Error generando o guardando el resumen");
      setIsSummarizing(false);
    }
  }

  // -------------------------------------------------------------
  // RENDER
  // -------------------------------------------------------------
  if (isLoadingConfig) {
    return (
      <div className="HeyGenStreamingAvatar">
        <header className="App-header">
          <p>Cargando configuración de la entrevista…</p>
        </header>
      </div>
    );
  }

  if (configError) {
    return (
      <div className="HeyGenStreamingAvatar">
        <header className="App-header">
          <h1>❌ Problema con el enlace</h1>
          <p style={{ maxWidth: 600 }}>{configError}</p>
        </header>
      </div>
    );
  }

  return (
    <div className="HeyGenStreamingAvatar">
      <header className="App-header">
        {/* 🟥 BARRA CORPORATIVA AMINT */}
        <div className="BrandBar">
          <div className="BrandLeft">
            <div className="BrandText">
              <span className="BrandName">AMINT</span>
              <span className="BrandSubtitle">Entrevista con avatar inteligente</span>
            </div>
          </div>
        </div>

        <h1>🧠 ENTREVISTADOR IA — ENTREVISTA</h1>
        <p style={{ opacity: 0.7 }}>
          ID de entrevista: <strong>{interviewToken}</strong>
        </p>

        {isSummarizing && (
          <p style={{ fontSize: 14, marginTop: 4 }}>
            ⏳ Generando informe para el equipo…
          </p>
        )}

        <p style={{ maxWidth: 600, marginTop: 16 }}>
          Cuando estés listo, pulsa <strong>Start</strong> y responde a las preguntas del avatar hablando o escribiendo.
        </p>

        {/* ACCIONES PRINCIPALES */}
        <div className="CandidateActions">
          <input
            className="InputField CandidateManualInput"
            placeholder="(Opcional) Texto manual para hablar"
            value={manualText}
            onChange={(e) => setManualText(e.target.value)}
          />

          <div className="CandidateButtonsRow">
            <button
              className="PrimaryFlavButton"
              onClick={async () => {
                if (!manualText.trim()) return;
                if (!data?.sessionId) {
                  setDebug("Primero pulsa Start para iniciar la sesión.");
                  return;
                }
                try {
                  await avatar.current?.speak({
                    taskRequest: { text: manualText, sessionId: data.sessionId },
                  });
                } catch (e: any) {
                  setDebug(e?.message || "Error en speak manual");
                }
              }}
              disabled={!manualText.trim() || isFinished}
            >
              Speak (manual)
            </button>

            <button className="PrimaryFlavButton" onClick={grab} disabled={isFinished}>
              Start
            </button>

            <button className="PrimaryFlavButton" onClick={stop} disabled={!data?.sessionId}>
              Stop
            </button>
          </div>
        </div>

        {/* TURNO DEL ENTREVISTADO */}
        <h3 style={{ marginTop: 28 }}>Turno del entrevistado</h3>

        <input
          className="InputField"
          placeholder={
            isFinished ? "La entrevista ha terminado." : "Escribe tu respuesta como entrevistado"
          }
          value={userAnswer}
          disabled={isFinished}
          onChange={(e) => setUserAnswer(e.target.value)}
        />

        <div className="CandidateTurnActions">
          <button
            className="PrimaryFlavButton"
            onClick={handleInterviewTurn}
            disabled={isFinished || !userAnswer.trim()}
          >
            🔵 Turno de entrevista (ChatGPT)
          </button>

          <button
            className="PrimaryFlavButton"
            onClick={isRecording ? stopRecording : startRecording}
            disabled={isFinished}
          >
            {isRecording ? "🔴 Detener grabación" : "🎤 Responder por voz"}
          </button>
        </div>

        {isFinished && (
          <p style={{ marginTop: 12 }}>
            ✅ Entrevista finalizada. Tu sesión ya se está enviando al equipo. ¡Muchas gracias!
          </p>
        )}

        {/* VIDEO DEL AVATAR */}
        <div className="MediaPlayer" style={{ marginTop: 22 }}>
          <video playsInline autoPlay width={450} ref={mediaStream}></video>
        </div>

        {/* Debug solo para ti (muy discreto) */}
        {debug && (
          <p style={{ marginTop: 16, fontSize: 11, opacity: 0.4 }}>
            (Mensaje técnico: {debug})
          </p>
        )}
      </header>
    </div>
  );
};

export default CandidatePage;
