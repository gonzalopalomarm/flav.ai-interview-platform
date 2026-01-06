// src/pages/CandidatePage.tsx
import React, { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";

import {
  Configuration,
  NewSessionData,
  StreamingAvatarApi,
} from "@heygen/streaming-avatar";
import "../App.css";

const API_BASE =
  process.env.REACT_APP_API_BASE_URL || "http://localhost:3001";

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

// POST seguro al backend para guardar summary
async function saveSummaryToBackend(
  interviewId: string,
  summary: string,
  rawConversation?: string
) {
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
    cfg.questions.every(
      (q: any) => typeof q === "string" && q.trim().length > 0
    ) &&
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
          setConfigError(
            "Falta el identificador de entrevista en la URL. Pide un nuevo enlace al equipo."
          );
          setIsLoadingConfig(false);
          return;
        }

        const url = `${API_BASE}/api/interview-config/${encodeURIComponent(
          interviewToken
        )}`;
        const res = await fetch(url);
        const json = await res.json().catch(() => ({}));

        if (!res.ok) {
          if (cancelled) return;
          setConfigError(
            json?.error || `No se pudo cargar config (HTTP ${res.status})`
          );
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

      avatar.current = new StreamingAvatarApi(
        new Configuration({ accessToken: heygenKey })
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
      if (isRecording)
        return setDebug("Primero detén la grabación antes de iniciar de nuevo.");

      if (!avatar.current) {
        const heygenKey = process.env.REACT_APP_HEYGEN_API_KEY;
        if (!heygenKey)
          return setDebug("Falta REACT_APP_HEYGEN_API_KEY en el .env de Client.");
        avatar.current = new StreamingAvatarApi(
          new Configuration({ accessToken: heygenKey })
        );
      }

      if (!avatarId || !voiceId)
        return setDebug("Hay un problema con la configuración del avatar.");

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
      const opening =
        "Hola, gracias por tu tiempo. Vamos a comenzar la entrevista. " +
        (firstQuestion || "");

      const initialConversation = `Entrevistador: ${opening}`;
      setConversation(initialConversation);

      await avatar.current!.speak({
        taskRequest: { text: opening, sessionId: res.sessionId },
      });
    } catch (err: any) {
      console.error("Error al iniciar avatar:", err);
      setDebug("Ha ocurrido un problema al iniciar el avatar.");
    }
  }

  // (Opcional) si luego quieres un botón “Finalizar”, lo reutilizas
  async function stop() {
    try {
      if (!data?.sessionId) return;

      await avatar.current?.stopAvatar(
        { stopSessionRequest: { sessionId: data.sessionId } },
        (msg: string) => console.log("Stop debug:", msg)
      );

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

  async function runInterviewTurn(answerText: string) {
    const cleanedAnswer = answerText.trim();
    if (!cleanedAnswer) return setDebug("Respuesta vacía.");
    if (!script) return setDebug("No se ha cargado el guion de la entrevista.");
    if (!data?.sessionId)
      return setDebug("Primero pulsa Start para iniciar la sesión.");
    if (isFinished) return setDebug("La entrevista ya ha terminado.");

    const apiKey = process.env.REACT_APP_OPENAI_API_KEY;
    if (!apiKey)
      return setDebug("Falta REACT_APP_OPENAI_API_KEY en .env (Client).");

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
    if (!assistantText) return setDebug("No he recibido respuesta de OpenAI.");

    const finalConversation =
      updatedConversation + `\nEntrevistador: ${assistantText}`;
    setConversation(finalConversation);

    if (nextQuestion) setQuestionIndex((prev) => prev + 1);
    else {
      setIsFinished(true);
      if (interviewToken) {
        handleGenerateSummary(interviewToken, finalConversation).catch((e) =>
          console.error("Error generando resumen automático:", e)
        );
      }
    }

    await avatar.current?.speak({
      taskRequest: { text: assistantText, sessionId: data.sessionId },
    });
  }

  // MODO VOZ (Whisper)
  async function startRecording() {
    try {
      if (isFinished) return;
      if (!data?.sessionId)
        return setDebug("Primero pulsa Start para iniciar la sesión.");

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      mediaRecorder.onstop = async () => {
        try {
          const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });

          const apiKey = process.env.REACT_APP_OPENAI_API_KEY;
          if (!apiKey)
            return setDebug("Falta REACT_APP_OPENAI_API_KEY para transcribir audio.");

          const formData = new FormData();
          formData.append("file", audioBlob, "audio.webm");
          formData.append("model", "whisper-1");
          formData.append("language", "es");

          const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}` },
            body: formData,
          });

          const json = await res.json();
          const transcript: string = json.text?.trim() || "";
          if (!transcript)
            return setDebug("No se ha podido transcribir el audio (texto vacío).");

          setDebug("");
          await runInterviewTurn(transcript);
        } catch (e: any) {
          setDebug(e?.message || "Error procesando/transcribiendo el audio");
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

  async function handleGenerateSummary(interviewId: string, fullConversation: string) {
    try {
      if (!fullConversation.trim()) return;

      const apiKey = process.env.REACT_APP_OPENAI_API_KEY;
      if (!apiKey) return;

      setIsSummarizing(true);

      const prompt = `
Actúa como un/a profesional senior en sociología y estudios cualitativos, con amplia experiencia en investigación social, estudios de mercado, Voice of the Customer y análisis de experiencia de cliente en restauración, así como en la elaboración de informes estratégicos para empresas e instituciones.

Tu rol es analizar entrevistas cualitativas a clientes centradas exclusivamente en su experiencia en un restaurante (servicio, atención, ambiente, tiempos, interacción con el personal, momentos vividos y percepción global), no en la evaluación o testeo de productos concretos.

No estamos testando producto (comida, bebida o recetas de forma aislada), sino la experiencia completa del cliente en el restaurante antes, durante y después de la visita.

Cuando te proporcione la transcripción (o el audio convertido a texto) de una entrevista, deberás:

1. RESUMEN EJECUTIVO  
Elaborar un resumen ejecutivo claro, sintético y accionable, enfocado a decisores:
- Identifica los insights clave sobre la experiencia en el restaurante  
- Destaca patrones de comportamiento y percepción del servicio  
- Expón fricciones, tensiones, contradicciones y momentos críticos del servicio  
- Señala diferencias entre expectativas previas y experiencia real  
- Evita descripciones superficiales  

2. INSIGHTS CLAVE  
Extrae los principales insights cualitativos:
- Redáctalos en lenguaje profesional  
- Formula cada insight como aprendizaje interpretativo sobre la experiencia en restaurante  
- Conecta motivaciones, expectativas, emociones, barreras y comportamientos  
- Prioriza insights con impacto en satisfacción, repetición y recomendación  

3. VERBATIMS  
Selecciona verbatims relevantes:
- Textuales, claros y bien contextualizados  
- Asociados a cada insight  
- Representativos de la experiencia vivida en el restaurante  
- Evita citas largas sin valor analítico  

4. ANÁLISIS INTERPRETATIVO  
Realiza un análisis profundo:
- Qué relata el cliente sobre su experiencia en el restaurante  
- Qué significa realmente a nivel emocional y relacional  
- Qué necesidades, frustraciones o expectativas no cubiertas aparecen  
- Qué no se dice explícitamente, pero se infiere del discurso  

5. MAPA DE TEMAS  
Identifica y estructura los grandes ejes de la experiencia en restaurante:
- Motivaciones de elección del restaurante  
- Momentos clave del journey (llegada, espera, pedido, servicio, pago, salida)  
- Dolores, fricciones y puntos de mejora del servicio  
- Expectativas y criterios de valoración  
- Lenguaje utilizado para describir la experiencia  
- Valores y creencias subyacentes sobre “una buena experiencia en restaurante”  

6. IMPLICACIONES ESTRATÉGICAS  
Traduce los hallazgos en implicaciones prácticas:
- Para la mejora de la experiencia en restaurante  
- Para servicio, procesos, atención al cliente o comunicación  
- Diferencia entre implicaciones tácticas y estratégicas  
- Prioriza según impacto potencial en satisfacción, fidelización y recomendación  

7. OBSERVACIONES METODOLÓGICAS (si procede)  
Incluye notas propias de un/a investigador/a profesional:
- Sesgos o racionalizaciones en el discurso del cliente  
- Límites de la entrevista o del contexto de la visita  
- Hipótesis a validar en futuras entrevistas  
- Preguntas abiertas que emergen del análisis  

Estilo y tono:
- Profesional, claro y estructurado  
- Lenguaje propio de informes de investigación cualitativa y experiencia en restauración  
- Interpretativo, no descriptivo  
- Sin jerga innecesaria ni frases genéricas  

Asume siempre que este análisis formará parte de un informe final de investigación cualitativa sobre experiencia de cliente en restaurante.

Nivel de exigencia: consultora estratégica / instituto de investigación cualitativa.
No actúes como un resumidor automático, sino como un/a analista experto/a que aporta valor interpretativo y estratégico.

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
      const summaryText: string =
        json.choices?.[0]?.message?.content?.trim() || "";
      if (!summaryText) {
        setIsSummarizing(false);
        return;
      }

      await saveSummaryToBackend(interviewId, summaryText, fullConversation);

      setDebug("✅ Entrevista finalizada. Gracias. Puedes cerrar esta ventana cuando quieras.");
      setIsSummarizing(false);
    } catch (e: any) {
      setDebug(e?.message || "Error generando o guardando el resumen");
      setIsSummarizing(false);
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
          {!!debug && (
            <p style={{ marginTop: 12, fontSize: 11, opacity: 0.5 }}>
              (Detalle técnico: {debug})
            </p>
          )}
        </header>
      </div>
    );
  }

  return (
    <div className="HeyGenStreamingAvatar">
      <header className="App-header">
        <div className="CandidateHero">
          <h1 style={{ marginTop: 14 }}>Entrevista experiencia</h1>

          {isSummarizing && (
            <p style={{ fontSize: 14, marginTop: 4 }}>⏳ Generando informe…</p>
          )}

          <p className="CandidateIntro">
            Pulsa <strong>Start</strong> para iniciar. Para responder, pulsa{" "}
            <strong>Responder por voz</strong>, habla y después pulsa{" "}
            <strong>Detener grabación</strong>.
          </p>

          {/* ✅ Botones: debajo del texto y A LA IZQUIERDA */}
          <div className="CandidateButtonsRow">
            <button className="PrimaryFlavButton" onClick={grab} disabled={isFinished}>
              Start
            </button>

            <button
              className="PrimaryFlavButton"
              onClick={isRecording ? stopRecording : startRecording}
              disabled={isFinished || !data?.sessionId}
              title={!data?.sessionId ? "Primero pulsa Start" : undefined}
            >
              {isRecording ? "🔴 Detener grabación" : "🎤 Responder por voz"}
            </button>

            {/* Si luego quieres un botón “Finalizar”, descomenta:
            <button className="PrimaryFlavButton" onClick={stop} disabled={!data?.sessionId || isFinished}>
              Finalizar
            </button>
            */}
          </div>
        </div>

        {isFinished && (
          <p style={{ marginTop: 12 }}>✅ Entrevista finalizada. ¡Muchas gracias!</p>
        )}

        <div className="MediaPlayer" style={{ marginTop: 22 }}>
          <video playsInline autoPlay width={450} ref={mediaStream}></video>
        </div>


      </header>
    </div>
  );
};

export default CandidatePage;
