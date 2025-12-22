// src/pages/AdminPage.tsx
import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";

type InterviewConfig = {
  objective: string;
  tone: string;
  questions: string[];
  avatarId: string;
  voiceId: string;
};

type StoredGroup = {
  groupId: string;
  restaurantName?: string;
  interviewIds: string[];
  createdAt: string;
  updatedAt?: string;
};

type InterviewMeta = {
  interviewId: string;
  groupId: string;
  restaurantName?: string;
  createdAt: string;
};

const API_BASE = "http://localhost:3001";

const AdminPage: React.FC = () => {
  // ✅ AHORA VACÍOS por defecto
  const [objective, setObjective] = useState("");
  const [questionsText, setQuestionsText] = useState("");

  // (Si también quieres tono vacío, cambia a useState("") )
  const [tone, setTone] = useState("Cercano y exploratorio.");

  const [avatarId, setAvatarId] = useState("");
  const [voiceId, setVoiceId] = useState("");
  const [numLinks, setNumLinks] = useState(1);

  const defaultGroupId = useMemo(() => `rest-${Date.now().toString(36)}`, []);
  const [groupId, setGroupId] = useState<string>(defaultGroupId);
  const [restaurantName, setRestaurantName] = useState<string>("");

  const [generatedTokens, setGeneratedTokens] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  const normalizeGroupId = (raw: string) =>
    raw
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-_]/g, "");

  const normalizedGroupId = normalizeGroupId(groupId);
  const makeNewGroupId = () => `rest-${Date.now().toString(36)}`;

  const handleGenerateLinks = async () => {
    setMessage(null);

    const questions = questionsText
      .split("\n")
      .map((q) => q.trim())
      .filter(Boolean);

    if (!normalizedGroupId) {
      setMessage("⚠️ Rellena el ID de grupo (restaurante).");
      return;
    }
    if (!avatarId.trim() || !voiceId.trim()) {
      setMessage("⚠️ Rellena Avatar ID y Voice ID.");
      return;
    }
    if (!objective.trim()) {
      setMessage("⚠️ Rellena el objetivo.");
      return;
    }
    if (questions.length === 0) {
      setMessage("⚠️ El guion debe tener al menos una pregunta.");
      return;
    }
    if (numLinks <= 0) {
      setMessage("⚠️ El número de enlaces debe ser al menos 1.");
      return;
    }

    const baseConfig: InterviewConfig = {
      objective: objective.trim(),
      tone: tone.trim(),
      questions,
      avatarId: avatarId.trim(),
      voiceId: voiceId.trim(),
    };

    const nowIso = new Date().toISOString();
    const base = Date.now().toString(36);
    const newTokens: string[] = [];

    // 1) Crear entrevistas (configs + meta)
    for (let i = 0; i < numLinks; i++) {
      const token = `${base}-${i + 1}`;

      localStorage.setItem(`interview-config-${token}`, JSON.stringify(baseConfig));

      const meta: InterviewMeta = {
        interviewId: token,
        groupId: normalizedGroupId,
        restaurantName: restaurantName.trim() || undefined,
        createdAt: nowIso,
      };
      localStorage.setItem(`interview-meta-${token}`, JSON.stringify(meta));

      newTokens.push(token);
    }

    // 2) Crear / actualizar grupo en localStorage
    const groupKey = `interview-group-${normalizedGroupId}`;
    const existingRaw = localStorage.getItem(groupKey);

    let existing: StoredGroup | null = null;
    try {
      existing = existingRaw ? (JSON.parse(existingRaw) as StoredGroup) : null;
    } catch {
      existing = null;
    }

    const mergedInterviewIds = Array.from(
      new Set([...(existing?.interviewIds || []), ...newTokens])
    );

    const groupToSave: StoredGroup = {
      groupId: normalizedGroupId,
      restaurantName: restaurantName.trim() || existing?.restaurantName,
      interviewIds: mergedInterviewIds,
      createdAt: existing?.createdAt || nowIso,
      updatedAt: nowIso,
    };

    localStorage.setItem(groupKey, JSON.stringify(groupToSave));

    // 3) Guardar el grupo también en backend
    try {
      const res = await fetch(`${API_BASE}/api/save-group`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          groupId: groupToSave.groupId,
          restaurantName: groupToSave.restaurantName,
          interviewIds: groupToSave.interviewIds,
        }),
      });

      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `Error guardando grupo en backend (HTTP ${res.status})`);
      }
    } catch (e: any) {
      setMessage(
        `⚠️ Grupo guardado localmente, pero NO en backend. Motivo: ${e?.message || "Error"}`
      );
      setGeneratedTokens(newTokens);
      return;
    }

    setGeneratedTokens(newTokens);
    setMessage(
      `✅ Generados ${newTokens.length} enlace(s). Grupo "${normalizedGroupId}" guardado en local y backend (${mergedInterviewIds.length} total).`
    );
  };

  return (
    <div className="HeyGenStreamingAvatar">
      <header className="App-header" style={{ alignItems: "flex-start" }}>
        <div className="BrandBar">
          <div className="BrandLeft">
            <div className="BrandText">
              <span className="BrandName">AMINT</span>
              <span className="BrandSubtitle"> - Panel de entrevistas</span>
            </div>
          </div>
        </div>

        <h1>🛠 Panel de administración</h1>
        <p style={{ maxWidth: 820, textAlign: "left" }}>
          Cada generación crea/actualiza un grupo y lo guarda también en backend para que el informe global funcione.
        </p>

        <p style={{ marginTop: 8 }}>
          <Link to="/">← Volver a Home</Link>
        </p>

        {message && (
          <p style={{ marginTop: 8, color: message.startsWith("✅") ? "#4ade80" : "#f87171" }}>
            {message}
          </p>
        )}

        <section
          style={{
            marginTop: 24,
            padding: 24,
            borderRadius: 16,
            border: "1px solid #4b5563",
            backgroundColor: "#111827",
            width: "100%",
            maxWidth: 1000,
            textAlign: "left",
          }}
        >
          <h2 style={{ marginTop: 0, marginBottom: 16 }}>📦 Grupo / restaurante</h2>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
            <div>
              <label style={{ fontSize: 14, opacity: 0.85 }}>ID de grupo</label>
              <input
                className="InputField2"
                style={{ width: "100%", marginTop: 4 }}
                value={groupId}
                onChange={(e) => setGroupId(e.target.value)}
              />
              <div style={{ fontSize: 12, opacity: 0.7, marginTop: 6 }}>
                Normalizado: <strong>{normalizedGroupId || "—"}</strong>
              </div>
            </div>

            <div>
              <label style={{ fontSize: 14, opacity: 0.85 }}>Nombre visible (opcional)</label>
              <input
                className="InputField2"
                style={{ width: "100%", marginTop: 4 }}
                value={restaurantName}
                onChange={(e) => setRestaurantName(e.target.value)}
              />
            </div>
          </div>

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 10 }}>
            <button
              className="PrimaryFlavButton"
              type="button"
              onClick={() => setGroupId(makeNewGroupId())}
            >
              🔄 Nuevo grupo (ID automático)
            </button>

            {/* ✅ ELIMINADO: botón "Ver informe global del grupo" */}
          </div>

          <hr style={{ margin: "18px 0", borderColor: "#374151" }} />

          <h2 style={{ marginTop: 0, marginBottom: 16 }}>🎯 Configuración entrevista</h2>

          <div style={{ display: "grid", gridTemplateColumns: "1.1fr 1.2fr", gap: 16 }}>
            <div>
              <label style={{ fontSize: 14, opacity: 0.8 }}>Objetivo</label>
              <input
                className="InputField2"
                style={{ width: "100%", marginTop: 4, marginBottom: 12 }}
                value={objective}
                onChange={(e) => setObjective(e.target.value)}
                placeholder="Escribe el objetivo de la entrevista..."
              />

              <label style={{ fontSize: 14, opacity: 0.8 }}>Tono</label>
              <input
                className="InputField2"
                style={{ width: "100%", marginTop: 4 }}
                value={tone}
                onChange={(e) => setTone(e.target.value)}
              />
            </div>

            <div>
              <label style={{ fontSize: 14, opacity: 0.8 }}>Preguntas (una por línea)</label>
              <textarea
                className="TextareaField"
                style={{ width: "100%", minHeight: 160, marginTop: 4 }}
                value={questionsText}
                onChange={(e) => setQuestionsText(e.target.value)}
                placeholder={`Escribe una pregunta por línea...\nEj:\n¿Cuál es tu experiencia previa?\n¿Qué te motiva a este puesto?`}
              />
            </div>
          </div>

          <hr style={{ margin: "18px 0", borderColor: "#374151" }} />

          <h3 style={{ marginTop: 0 }}>🧍 Avatar y voz</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 8 }}>
            <div>
              <label style={{ fontSize: 14, opacity: 0.8 }}>Avatar ID</label>
              <input
                className="InputField2"
                style={{ width: "100%", marginTop: 4 }}
                value={avatarId}
                onChange={(e) => setAvatarId(e.target.value)}
              />
            </div>
            <div>
              <label style={{ fontSize: 14, opacity: 0.8 }}>Voice ID</label>
              <input
                className="InputField2"
                style={{ width: "100%", marginTop: 4 }}
                value={voiceId}
                onChange={(e) => setVoiceId(e.target.value)}
              />
            </div>
          </div>

          <div style={{ marginTop: 16 }}>
            <label style={{ fontSize: 14, opacity: 0.8 }}>Número de enlaces</label>
            <input
              type="number"
              min={1}
              className="InputField2"
              style={{ width: 120, marginTop: 4 }}
              value={numLinks}
              onChange={(e) => setNumLinks(Number(e.target.value) || 1)}
            />
          </div>

          <div style={{ marginTop: 20, textAlign: "right" }}>
            <button className="PrimaryFlavButton" onClick={handleGenerateLinks}>
              🚀 Generar enlaces (y crear grupo)
            </button>
          </div>
        </section>

        {generatedTokens.length > 0 && (
          <section
            style={{
              marginTop: 24,
              padding: 20,
              borderRadius: 16,
              border: "1px solid #4b5563",
              backgroundColor: "#020617",
              width: "100%",
              maxWidth: 1000,
              textAlign: "left",
            }}
          >
            <h2 style={{ marginTop: 0 }}>🔗 Enlaces generados</h2>

            <p style={{ fontSize: 14, opacity: 0.85 }}>
              Grupo: <strong>{normalizedGroupId}</strong>
              {restaurantName.trim() ? (
                <>
                  {" "}
                  · Restaurante: <strong>{restaurantName.trim()}</strong>
                </>
              ) : null}
            </p>

            <ul style={{ marginTop: 12, paddingLeft: 18 }}>
              {generatedTokens.map((token) => (
                <li key={token} style={{ marginBottom: 12 }}>
                  <div>
                    <strong>Candidato:</strong>{" "}
                    <a href={`http://localhost:3000/candidate/${token}`} target="_blank" rel="noreferrer">
                      {`http://localhost:3000/candidate/${token}`}
                    </a>
                  </div>
                  <div>
                    <strong>Resultados:</strong>{" "}
                    <a href={`http://localhost:3000/results/${token}`} target="_blank" rel="noreferrer">
                      {`http://localhost:3000/results/${token}`}
                    </a>
                  </div>
                </li>
              ))}
            </ul>

            {/* (Puedes dejar este link, o si quieres también lo quitamos) */}
            <div style={{ marginTop: 14 }}>
              <strong>Informe global del grupo:</strong>{" "}
              <a href={`http://localhost:3000/results/group/${normalizedGroupId}`} target="_blank" rel="noreferrer">
                {`http://localhost:3000/results/group/${normalizedGroupId}`}
              </a>
            </div>
          </section>
        )}
      </header>
    </div>
  );
};

export default AdminPage;
