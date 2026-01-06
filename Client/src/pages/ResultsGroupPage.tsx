import React, { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";

const API_BASE = process.env.REACT_APP_API_BASE_URL || "http://localhost:3001";

type StoredGroup = {
  groupId: string;
  restaurantName?: string;
  interviewIds: string[];
  createdAt?: string;
  updatedAt?: string;
};

type SummaryResponse = {
  interviewId: string;
  summary: string;
  rawConversation?: string;
  createdAt?: string;
};

function safeParseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

const GROUP_SYSTEM_PROMPT = `
Actúa como un/a profesional senior en sociología y estudios cualitativos, con amplia experiencia en investigación cualitativa, Voice of the Customer y análisis de experiencia de cliente en restauración, así como en la elaboración de informes estratégicos para empresas e instituciones.

Tu rol es elaborar un INFORME GLOBAL de investigación cualitativa a partir de múltiples entrevistas individuales a clientes, centradas exclusivamente en su experiencia en un restaurante (servicio, atención, ambiente, tiempos, interacción con el personal y percepción global).

No estamos testando producto (comida o bebida de forma aislada), sino la experiencia completa del cliente en el restaurante.

Asume que:
- Cada entrevista ya ha sido analizada individualmente
- Tu tarea es realizar una síntesis transversal del conjunto
- Debes identificar patrones comunes, diferencias relevantes y tensiones entre discursos

Cuando te proporcione el conjunto de entrevistas (o sus análisis individuales), deberás:

1. RESUMEN EJECUTIVO GLOBAL  
Elaborar un resumen ejecutivo claro y accionable, orientado a decisores:
- Principales aprendizajes globales sobre la experiencia en restaurante  
- Qué funciona de forma consistente y qué genera fricción  
- Tensiones y contradicciones entre perfiles de clientes  
- Insight clave que mejor explica la experiencia global  

2. GRANDES INSIGHTS TRANSVERSALES  
Identifica los insights cualitativos más relevantes:
- Deben surgir de la repetición, recurrencia o fuerza del discurso  
- Indica si cada insight es mayoritario, recurrente o puntual pero significativo  
- Redáctalos como aprendizajes interpretativos, no como opiniones literales  
- Conecta emociones, expectativas, comportamientos y decisiones  

3. VERBATIMS REPRESENTATIVOS  
Incluye verbatims seleccionados:
- Representativos del conjunto de entrevistas  
- Asociados claramente a cada insight  
- Indicando, cuando aporte valor, si reflejan una opinión compartida o una tensión  
- Evita verbatims aislados sin respaldo analítico  

4. MAPA GLOBAL DE LA EXPERIENCIA EN RESTAURANTE  
Construye una visión integrada del customer journey:
- Antes de la visita  
- Llegada y primera impresión  
- Servicio y atención  
- Gestión del tiempo y esperas  
- Pago y cierre  
- Recuerdo y predisposición a volver o recomendar  

Para cada etapa:
- Qué funciona  
- Qué falla  
- Qué genera emoción positiva o negativa  

5. DIFERENCIAS Y TENSIONES ENTRE CLIENTES  
Identifica diferencias relevantes en la experiencia:
- Expectativas vs. realidad  
- Clientes habituales vs. nuevos  
- Sensibilidad al servicio, al tiempo o al trato  
- Momentos donde no hay consenso  

6. IMPLICACIONES ESTRATÉGICAS PRIORITARIAS  
Traduce los hallazgos en implicaciones claras:
- Para la mejora de la experiencia en restaurante  
- Para operaciones, personal de sala, procesos o comunicación  
- Distingue entre quick wins y cambios estructurales  
- Prioriza según impacto potencial en satisfacción, fidelización y recomendación  

7. APRENDIZAJES CLAVE PARA DECISIÓN  
Resume:
- 3–5 aprendizajes que un decisor debe recordar  
- Qué no se debería ignorar  
- Qué oportunidad clara emerge del conjunto  

8. OBSERVACIONES METODOLÓGICAS  
Incluye notas propias de investigación cualitativa:
- Saturación de discursos detectada o no  
- Límites del estudio  
- Hipótesis emergentes a validar cuantitativamente  
- Nuevas preguntas que surgen del análisis global  

Estilo y tono:
- Profesional, claro y estructurado  
- Propio de informes de investigación cualitativa de alto nivel  
- Interpretativo y sintético  
- Sin jerga innecesaria ni frases genéricas  

Asume que este informe será utilizado para tomar decisiones estratégicas sobre la experiencia en restaurante.
Nivel de exigencia: consultora estratégica / instituto de investigación cualitativa.
No actúes como un resumidor automático, sino como un/a analista experto/a que sintetiza y aporta visión estratégica.

`.trim();

const ResultsGroupPage: React.FC = () => {
  const params = useParams<{ groupId: string }>();
  const groupId = params.groupId ? decodeURIComponent(params.groupId) : "";

  const [loading, setLoading] = useState(true);
  const [group, setGroup] = useState<StoredGroup | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [summariesLoading, setSummariesLoading] = useState(false);
  const [summaries, setSummaries] = useState<Record<string, SummaryResponse | null>>({});
  const [missing, setMissing] = useState<string[]>([]);

  // UI
  const [openAll, setOpenAll] = useState(false);

  // Global (frontend)
  const [globalLoading, setGlobalLoading] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [globalText, setGlobalText] = useState<string>("");

  // ✅ NUEVO: estado para controlar qué resumen se está eliminando
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const groupStorageKey = useMemo(() => {
    return groupId ? `interview-group-${groupId}` : "";
  }, [groupId]);

  const globalCacheKey = useMemo(() => {
    return groupId ? `group-global-sum-${groupId}` : "";
  }, [groupId]);

  // ✅ NUEVO: persistimos “resúmenes eliminados” por grupo (fallback si no existe DELETE backend)
  const hiddenSummariesKey = useMemo(() => {
    return groupId ? `hidden-summaries-${groupId}` : "";
  }, [groupId]);

  function getHiddenSet(): Set<string> {
    if (!hiddenSummariesKey) return new Set();
    const raw = localStorage.getItem(hiddenSummariesKey);
    const arr = safeParseJson<string[]>(raw) || [];
    return new Set(arr.map(String));
  }

  function addHidden(id: string) {
    if (!hiddenSummariesKey) return;
    const s = getHiddenSet();
    s.add(String(id));
    localStorage.setItem(hiddenSummariesKey, JSON.stringify(Array.from(s)));
  }

  function removeHidden(id: string) {
    if (!hiddenSummariesKey) return;
    const s = getHiddenSet();
    s.delete(String(id));
    localStorage.setItem(hiddenSummariesKey, JSON.stringify(Array.from(s)));
  }

  async function loadGroup(): Promise<StoredGroup> {
    // 1) Backend (si existe)
    try {
      const res = await fetch(`${API_BASE}/api/group/${encodeURIComponent(groupId)}`);
      if (res.ok) {
        const g = (await res.json()) as StoredGroup;
        if (!g?.groupId || !Array.isArray(g.interviewIds)) {
          throw new Error("Grupo inválido devuelto por el servidor.");
        }
        return {
          groupId: String(g.groupId),
          restaurantName: g.restaurantName ? String(g.restaurantName) : undefined,
          interviewIds: g.interviewIds.map(String).filter(Boolean),
          createdAt: g.createdAt ? String(g.createdAt) : undefined,
          updatedAt: g.updatedAt ? String(g.updatedAt) : undefined,
        };
      }
    } catch {
      // seguimos a fallback
    }

    // 2) Fallback: localStorage
    const raw = localStorage.getItem(groupStorageKey);
    const parsed = safeParseJson<StoredGroup>(raw);
    if (parsed?.groupId && Array.isArray(parsed.interviewIds) && parsed.interviewIds.length > 0) {
      return {
        groupId: String(parsed.groupId),
        restaurantName: parsed.restaurantName ? String(parsed.restaurantName) : undefined,
        interviewIds: parsed.interviewIds.map(String).filter(Boolean),
        createdAt: parsed.createdAt ? String(parsed.createdAt) : undefined,
        updatedAt: parsed.updatedAt ? String(parsed.updatedAt) : undefined,
      };
    }

    throw new Error(`No existe el grupo "${groupId}" ni en servidor ni en localStorage.`);
  }

  async function loadAllSummaries(g: StoredGroup) {
    setSummariesLoading(true);
    setMissing([]);
    setSummaries({});

    try {
      const ids = g.interviewIds || [];
      if (ids.length === 0) return;

      const hidden = getHiddenSet(); // ✅ NUEVO

      const results = await Promise.allSettled(
        ids.map(async (id) => {
          // ✅ NUEVO: si se marcó como eliminado en esta UI, lo tratamos como inexistente
          if (hidden.has(String(id))) return { id, data: null as SummaryResponse | null };

          const res = await fetch(`${API_BASE}/api/summary/${encodeURIComponent(id)}`);
          if (!res.ok) return { id, data: null as SummaryResponse | null };

          const json = (await res.json()) as SummaryResponse | SummaryResponse[];
          const entry = Array.isArray(json) ? json[0] : json;
          if (!entry?.summary?.trim()) return { id, data: null as SummaryResponse | null };

          return {
            id,
            data: {
              interviewId: String(entry.interviewId || id),
              summary: String(entry.summary),
              rawConversation: entry.rawConversation ? String(entry.rawConversation) : undefined,
              createdAt: entry.createdAt ? String(entry.createdAt) : undefined,
            } as SummaryResponse,
          };
        })
      );

      const map: Record<string, SummaryResponse | null> = {};
      const missingIds: string[] = [];

      for (const r of results) {
        if (r.status === "fulfilled") {
          map[r.value.id] = r.value.data;
          if (!r.value.data) missingIds.push(r.value.id);
        } else {
          missingIds.push("desconocido");
        }
      }

      setSummaries(map);
      setMissing(missingIds.filter((x) => x !== "desconocido"));
    } finally {
      setSummariesLoading(false);
    }
  }

  function buildGlobalPrompt(g: StoredGroup, blocks: { id: string; summary: string }[]) {
    const restaurantLabel = g.restaurantName ? `Restaurante: ${g.restaurantName}` : `Grupo: ${g.groupId}`;

    return `
${restaurantLabel}
Nº entrevistas en el grupo: ${g.interviewIds.length}
Nº entrevistas con resumen disponible: ${blocks.length}

A continuación van los RESÚMENES INDIVIDUALES (uno por entrevista). Úsalos como única fuente de verdad:

${blocks
  .map(
    (b, idx) => `
--- ENTREVISTA ${idx + 1} (${b.id}) ---
${b.summary}
`
  )
  .join("\n")}

FORMATO DE SALIDA OBLIGATORIO:

📌 0) Resumen ejecutivo (1 frase)
- Una única frase muy clara sobre el estado general (experiencia, problemas, oportunidades).

📌 1) Insights clave (6-10 bullets)
- EMOJI + **titular** + 1-2 frases con contexto.
- Indica si es patrón repetido o discrepancia.

💬 2) Evidencias / citas representativas (5-8)
- ➤ “cita” — (entrevista <id>)
- Si no hay citas literales, convierte fragmentos en estilo cita sin inventar.

🎯 3) Oportunidades / recomendaciones accionables (6-10)
- ⬜️ Acción concreta + breve explicación (por qué/impacto).

🎨 4) Mini “Persona Snapshot” global
- Nombre ficticio
- 3 adjetivos
- Objetivos
- Frustraciones

⚠️ 5) Alertas / riesgos (opcional)
- 3-5 bullets

Importante:
- Agrupa y prioriza, sin quedarte superficial.
`.trim();
  }

  async function generateGlobalFromVisibleSummaries(refresh = false) {
    if (!group) return;

    setGlobalError(null);
    setGlobalLoading(true);

    try {
      if (!refresh && globalCacheKey) {
        const cached = localStorage.getItem(globalCacheKey) || "";
        if (cached.trim()) {
          setGlobalText(cached);
          return;
        }
      }

      const apiKey = process.env.REACT_APP_OPENAI_API_KEY;
      if (!apiKey) {
        setGlobalError("Falta REACT_APP_OPENAI_API_KEY en el .env del Client.");
        return;
      }

      const blocks = group.interviewIds
        .map((id) => {
          const s = summaries[id];
          const text = s?.summary?.trim() ? String(s.summary).trim() : "";
          return text ? { id, summary: text } : null;
        })
        .filter(Boolean) as { id: string; summary: string }[];

      if (blocks.length === 0) {
        setGlobalError("No hay resúmenes individuales disponibles arriba para construir el informe global.");
        return;
      }

      setGlobalText("⏳ Generando informe global…");

      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          temperature: 0.4,
          messages: [
            { role: "system", content: GROUP_SYSTEM_PROMPT },
            { role: "user", content: buildGlobalPrompt(group, blocks) },
          ],
        }),
      });

      const json = await res.json();

      if (!res.ok) {
        const msg = json?.error?.message || `OpenAI error HTTP ${res.status}`;
        setGlobalText("");
        setGlobalError(`No se pudo generar el informe global: ${msg}`);
        return;
      }

      const text: string = json?.choices?.[0]?.message?.content?.trim() || "";
      if (!text) {
        setGlobalText("");
        setGlobalError("OpenAI devolvió una respuesta vacía.");
        return;
      }

      setGlobalText(text);
      if (globalCacheKey) localStorage.setItem(globalCacheKey, text);
    } catch (e: any) {
      setGlobalText("");
      setGlobalError(e?.message || "Error generando el informe global.");
    } finally {
      setGlobalLoading(false);
    }
  }

  // ✅ NUEVO: eliminar resumen individual (token)
  async function deleteSummary(interviewId: string) {
    if (!group) return;
    const id = String(interviewId);

    const ok = window.confirm(`¿Eliminar el resumen de la entrevista "${id}"?`);
    if (!ok) return;

    setDeletingId(id);
    setError(null);

    try {
      // Intento backend: DELETE /api/summary/:id
      const res = await fetch(`${API_BASE}/api/summary/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });

      if (res.ok) {
        // borrado real en servidor
        removeHidden(id);
      } else {
        // fallback: lo ocultamos en UI (persistente) aunque el backend no permita borrar
        addHidden(id);
      }

      // UI inmediata: lo quitamos del estado
      setSummaries((prev) => ({ ...prev, [id]: null }));

      // asegurar que aparezca en “faltan resúmenes”
      setMissing((prev) => {
        const s = new Set(prev);
        s.add(id);
        return Array.from(s);
      });

      // invalidar cache del informe global (para que no use resúmenes antiguos)
      if (globalCacheKey) {
        localStorage.removeItem(globalCacheKey);
        setGlobalText("");
      }
    } catch (e: any) {
      setError(e?.message || "Error eliminando el resumen.");
    } finally {
      setDeletingId(null);
    }
  }

  useEffect(() => {
    const run = async () => {
      try {
        setLoading(true);
        setError(null);

        if (!groupId) {
          setGroup(null);
          setError("Falta groupId en la URL.");
          return;
        }

        const g = await loadGroup();
        setGroup(g);

        const cachedGlobal = globalCacheKey ? localStorage.getItem(globalCacheKey) || "" : "";
        setGlobalText(cachedGlobal);

        await loadAllSummaries(g);
      } catch (e: any) {
        console.error(e);
        setGroup(null);
        setError(e?.message || "Error cargando el grupo.");
      } finally {
        setLoading(false);
      }
    };

    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  const availableCount = Object.values(summaries).filter((s) => s?.summary?.trim()).length;

  if (loading) {
    return (
      <div className="HeyGenStreamingAvatar">
        <header className="App-header" style={{ alignItems: "flex-start" }}>
          <h1 style={{ marginBottom: 8 }}>📦 Grupo</h1>
          <p>⏳ Cargando…</p>
          <p style={{ marginTop: 12 }}>
            <Link to="/results">← Volver a Results</Link>
          </p>
        </header>
      </div>
    );
  }

  if (!group) {
    return (
      <div className="HeyGenStreamingAvatar">
        <header className="App-header" style={{ alignItems: "flex-start" }}>
          <h1 style={{ marginBottom: 8 }}>❌ Problema con el grupo</h1>
          <p style={{ opacity: 0.85, maxWidth: 860 }}>{error || "Error"}</p>
          <p style={{ marginTop: 12 }}>
            <Link to="/results">← Volver a Results</Link>
          </p>
        </header>
      </div>
    );
  }

  return (
    <div className="HeyGenStreamingAvatar">
      <header className="App-header" style={{ alignItems: "flex-start" }}>
        <h1 style={{ marginBottom: 6 }}>
          📦 Grupo: <span style={{ fontWeight: 800 }}>{group.groupId}</span>
        </h1>

        <p style={{ opacity: 0.8, marginTop: 0 }}>
          {group.restaurantName ? (
            <>
              Restaurante: <strong>{group.restaurantName}</strong> ·{" "}
            </>
          ) : null}
          Entrevistas: <strong>{group.interviewIds.length}</strong> · Resúmenes disponibles:{" "}
          <strong>{availableCount}</strong>
        </p>

        <p style={{ marginTop: 12 }}>
          <Link to="/results">← Volver a Results</Link>
        </p>

        {error && (
          <div
            style={{
              marginTop: 12,
              padding: 12,
              borderRadius: 12,
              border: "1px solid #f97373",
              backgroundColor: "#451a1a",
              maxWidth: 980,
              width: "100%",
              textAlign: "left",
            }}
          >
            <strong>⚠️ {error}</strong>
          </div>
        )}

        {/* === RESÚMENES INDIVIDUALES === */}
        <section
          style={{
            marginTop: 18,
            padding: 18,
            borderRadius: 16,
            border: "1px solid rgba(255,255,255,0.15)",
            background: "rgba(2,6,23,0.65)",
            width: "100%",
            maxWidth: 980,
            textAlign: "left",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              justifyContent: "space-between",
              flexWrap: "wrap",
            }}
          >
            <h2 style={{ marginTop: 0, marginBottom: 10 }}>🧾 Resúmenes del grupo (desplegables)</h2>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button className="PrimaryFlavButton" onClick={() => setOpenAll((v) => !v)}>
                {openAll ? "▾ Cerrar todos" : "▸ Abrir todos"}
              </button>

              <button
                className="PrimaryFlavButton"
                onClick={async () => {
                  await loadAllSummaries(group);
                }}
                disabled={summariesLoading}
              >
                🔄 Recargar
              </button>
            </div>
          </div>

          {summariesLoading && <p style={{ opacity: 0.85 }}>⏳ Cargando resúmenes…</p>}

          {!summariesLoading && missing.length > 0 && (
            <div
              style={{
                marginTop: 10,
                padding: 12,
                borderRadius: 12,
                border: "1px solid rgba(251,191,36,0.6)",
                backgroundColor: "rgba(120,53,15,0.25)",
              }}
            >
              <strong>⚠️ Faltan resúmenes para:</strong> {missing.join(", ")}
              <div style={{ marginTop: 6, fontSize: 13, opacity: 0.85 }}>
                (Si esas entrevistas aún no han terminado o no han guardado el summary en el backend, o si lo has eliminado.)
              </div>
            </div>
          )}

          {!summariesLoading &&
            group.interviewIds.map((id, idx) => {
              const s = summaries[id];
              const hasSummary = Boolean(s?.summary?.trim());

              return (
                <div
                  key={id}
                  style={{
                    marginTop: 14,
                    borderRadius: 14,
                    overflow: "hidden",
                    border: "1px solid rgba(255,255,255,0.12)",
                    background:
                      "linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))",
                  }}
                >
                  <div
                    style={{
                      padding: "10px 14px",
                      borderBottom: "1px dashed rgba(255,255,255,0.16)",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 12,
                      flexWrap: "wrap",
                      backgroundColor: "rgba(2,6,23,0.55)",
                    }}
                  >
                    <div style={{ fontWeight: 900 }}>
                      #{idx + 1} · {id}
                      {!hasSummary ? (
                        <span style={{ marginLeft: 10, opacity: 0.75, fontWeight: 600 }}>
                          (sin resumen)
                        </span>
                      ) : null}
                    </div>

                    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                      <a
                        href={`/results/${encodeURIComponent(id)}`}
                        target="_blank"
                        rel="noreferrer"
                        style={{ opacity: 0.9, textDecoration: "none" }}
                      >
                        Abrir individual ↗
                      </a>

                      {/* ✅ BOTÓN NUEVO */}
                      {hasSummary && (
                        <button
                          className="PrimaryFlavButton"
                          onClick={() => deleteSummary(id)}
                          disabled={deletingId === id}
                          title="Eliminar el resumen"
                        >
                          {deletingId === id ? "⏳ Eliminando…" : "🗑 Eliminar resumen"}
                        </button>
                      )}
                    </div>
                  </div>

                  <details open={openAll} style={{ padding: 14 }}>
                    <summary
                      style={{
                        cursor: "pointer",
                        listStyle: "none",
                        fontWeight: 800,
                        opacity: 0.95,
                        userSelect: "none",
                      }}
                    >
                      {hasSummary ? "📄 Ver resumen" : "⚠️ No hay resumen guardado"}
                    </summary>

                    <div
                      style={{
                        marginTop: 12,
                        padding: 14,
                        borderRadius: 12,
                        backgroundColor: "#0b1120",
                        border: "1px solid rgba(255,255,255,0.08)",
                        whiteSpace: "pre-wrap",
                        lineHeight: 1.6,
                      }}
                    >
                      {hasSummary
                        ? s!.summary
                        : "Todavía no existe summary para este token (o no se ha guardado en el backend, o lo has eliminado)."}
                    </div>
                  </details>
                </div>
              );
            })}
        </section>

        {/* === INFORME GLOBAL (ABAJO) — 100% FRONTEND === */}
        <section
          style={{
            marginTop: 18,
            padding: 18,
            borderRadius: 16,
            border: "1px solid rgba(255,255,255,0.15)",
            background: "rgba(2,6,23,0.65)",
            width: "100%",
            maxWidth: 980,
            textAlign: "left",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              justifyContent: "space-between",
              flexWrap: "wrap",
            }}
          >
            <h2 style={{ marginTop: 0, marginBottom: 10 }}>🧠 Informe global del grupo</h2>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button
                className="PrimaryFlavButton"
                onClick={() => generateGlobalFromVisibleSummaries(false)}
                disabled={globalLoading}
              >
                ⚡ Generar
              </button>

              <button
                className="PrimaryFlavButton"
                onClick={() => generateGlobalFromVisibleSummaries(true)}
                disabled={globalLoading}
              >
                🔁 Regenerar
              </button>
            </div>
          </div>

          <details open={false} style={{ padding: 2 }}>
            <summary
              style={{
                cursor: "pointer",
                listStyle: "none",
                fontWeight: 900,
                opacity: 0.95,
                userSelect: "none",
                padding: "8px 0",
              }}
            >
              📌 Ver informe global (hecho con los resúmenes de arriba)
            </summary>

            {globalLoading && <p style={{ opacity: 0.85, marginTop: 10 }}>⏳ Generando…</p>}

            {globalError && (
              <div
                style={{
                  marginTop: 10,
                  padding: 12,
                  borderRadius: 12,
                  border: "1px solid #f97373",
                  backgroundColor: "#451a1a",
                }}
              >
                <strong>⚠️ {globalError}</strong>
              </div>
            )}

            <div
              style={{
                marginTop: 12,
                padding: 14,
                borderRadius: 12,
                backgroundColor: "#0b1120",
                border: "1px solid rgba(255,255,255,0.08)",
                whiteSpace: "pre-wrap",
                lineHeight: 1.6,
              }}
            >
              {globalText?.trim() ? globalText : "Aún no hay informe global generado. Pulsa “Generar”."}
            </div>
          </details>
        </section>
      </header>
    </div>
  );
};

export default ResultsGroupPage;
