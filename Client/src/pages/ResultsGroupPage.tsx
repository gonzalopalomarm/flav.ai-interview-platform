// src/pages/ResultsGroupPage.tsx
import React, { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";

// ✅ ResultsGroupPage (admin-only)
const API_BASE = (process.env.REACT_APP_API_BASE_URL || "http://localhost:3001").trim();
const ADMIN_TOKEN_KEY = "flavaai-admin-token";

function getAdminToken(): string {
  return String(localStorage.getItem(ADMIN_TOKEN_KEY) || "").trim();
}

function mergeHeaders(init?: RequestInit): Record<string, string> {
  const base: Record<string, string> = {};
  if (init?.headers) {
    const h = new Headers(init.headers as any);
    h.forEach((v, k) => (base[k] = v));
  }
  return base;
}

async function adminFetch(url: string, init: RequestInit = {}) {
  const token = getAdminToken();

  const headers: Record<string, string> = {
    ...mergeHeaders(init),
    Accept: "application/json",
    ...(token ? { "x-admin-token": token } : {}),
  };

  console.log("adminFetch =>", {
    url,
    method: init.method || "GET",
    hasToken: !!token,
    tokenLen: token.length,
    apiBase: API_BASE,
  });

  return fetch(url, {
    ...init,
    headers,
    cache: "no-store",
  });
}

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

const ResultsGroupPage: React.FC = () => {
  const params = useParams<{ groupId: string }>();
  const groupId = params.groupId ? decodeURIComponent(params.groupId) : "";

  const [loading, setLoading] = useState(true);
  const [group, setGroup] = useState<StoredGroup | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [summariesLoading, setSummariesLoading] = useState(false);
  const [summaries, setSummaries] = useState<Record<string, SummaryResponse | null>>({});
  const [missing, setMissing] = useState<string[]>([]);
  const [openAll, setOpenAll] = useState(false);

  const [globalLoading, setGlobalLoading] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [globalText, setGlobalText] = useState<string>("");

  const [deletingId, setDeletingId] = useState<string | null>(null);

  const adminTokenLen = getAdminToken().length;

  const groupStorageKey = useMemo(() => (groupId ? `interview-group-${groupId}` : ""), [groupId]);
  const globalCacheKey = useMemo(() => (groupId ? `group-global-sum-${groupId}` : ""), [groupId]);
  const hiddenSummariesKey = useMemo(() => (groupId ? `hidden-summaries-${groupId}` : ""), [groupId]);

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
    // IMPORTANTE: tu server NO tiene /api/group/:id, así que esto casi seguro 404 y cae a localStorage.
    // Lo dejo pero no dependemos de ello.
    try {
      const res = await adminFetch(`${API_BASE}/api/group/${encodeURIComponent(groupId)}`);
      if (res.ok) {
        const g = (await res.json()) as StoredGroup;
        if (!g?.groupId || !Array.isArray(g.interviewIds)) throw new Error("Grupo inválido devuelto por el servidor.");
        return {
          groupId: String(g.groupId),
          restaurantName: g.restaurantName ? String(g.restaurantName) : undefined,
          interviewIds: g.interviewIds.map(String).filter(Boolean),
          createdAt: g.createdAt ? String(g.createdAt) : undefined,
          updatedAt: g.updatedAt ? String(g.updatedAt) : undefined,
        };
      }
    } catch {
      // fallback
    }

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

      if (!getAdminToken()) {
        setMissing(ids);
        setSummaries(Object.fromEntries(ids.map((id) => [id, null])));
        setError("Falta el admin token en localStorage. Ve a /admin y vuelve a intentarlo.");
        return;
      }

      const hidden = getHiddenSet();

      const results = await Promise.allSettled(
        ids.map(async (id) => {
          const sid = String(id);
          if (hidden.has(sid)) return { id: sid, data: null as SummaryResponse | null };

          const url = `${API_BASE}/api/summary/${encodeURIComponent(sid)}`;
          const res = await adminFetch(url, { method: "GET" });

          if (!res.ok) {
            const txt = await res.text().catch(() => "");
            console.warn("summary GET failed", sid, res.status, txt);
            return { id: sid, data: null as SummaryResponse | null };
          }

          const json = (await res.json().catch(() => null)) as any;
          const entry = Array.isArray(json) ? json[0] : json;

          if (!entry?.summary?.trim()) return { id: sid, data: null as SummaryResponse | null };

          return {
            id: sid,
            data: {
              interviewId: String(entry.interviewId || sid),
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

  async function generateGlobalFromServer(refresh = false) {
    if (!group) return;

    setGlobalError(null);
    setGlobalLoading(true);

    try {
      if (!getAdminToken()) {
        setGlobalText("");
        setGlobalError("Falta el admin token en localStorage. Ve a /admin y vuelve a intentarlo.");
        return;
      }

      if (!refresh && globalCacheKey) {
        const cached = localStorage.getItem(globalCacheKey) || "";
        if (cached.trim()) {
          setGlobalText(cached);
          return;
        }
      }

      setGlobalText("⏳ Generando informe global…");

      const url =
        `${API_BASE}/api/group-summary/${encodeURIComponent(group.groupId)}` + (refresh ? "?refresh=1" : "");

      const res = await adminFetch(url, { method: "GET" });
      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        const msg = (json as any)?.error || `HTTP ${res.status}`;
        setGlobalText("");
        setGlobalError(`No se pudo generar el informe global: ${msg}`);
        return;
      }

      const text = String((json as any)?.summary || "").trim();
      if (!text) {
        setGlobalText("");
        setGlobalError("El backend devolvió un informe vacío.");
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

  async function deleteSummary(interviewId: string) {
    if (!group) return;
    const id = String(interviewId);

    const ok = window.confirm(`¿Eliminar el resumen de la entrevista "${id}"?`);
    if (!ok) return;

    setDeletingId(id);
    setError(null);

    try {
      const res = await adminFetch(`${API_BASE}/api/summary/${encodeURIComponent(id)}`, { method: "DELETE" });

      if (res.ok) removeHidden(id);
      else addHidden(id);

      setSummaries((prev) => ({ ...prev, [id]: null }));
      setMissing((prev) => Array.from(new Set([...prev, id])));

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

        <p style={{ fontSize: 12, opacity: 0.7, marginTop: 0, marginBottom: 8 }}>
          (debug) API_BASE="{API_BASE}" · adminTokenLen={adminTokenLen}
        </p>

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
          <div style={{ display: "flex", alignItems: "center", gap: 12, justifyContent: "space-between", flexWrap: "wrap" }}>
            <h2 style={{ marginTop: 0, marginBottom: 10 }}>🧾 Resúmenes del grupo (desplegables)</h2>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button className="PrimaryFlavButton" onClick={() => setOpenAll((v) => !v)}>
                {openAll ? "▾ Cerrar todos" : "▸ Abrir todos"}
              </button>

              <button className="PrimaryFlavButton" onClick={async () => loadAllSummaries(group)} disabled={summariesLoading}>
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
                (Si esas entrevistas aún no han terminado, o si lo has eliminado.)
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
                    background: "linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))",
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
                        <span style={{ marginLeft: 10, opacity: 0.75, fontWeight: 600 }}>(sin resumen)</span>
                      ) : null}
                    </div>

                    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                      <a href={`/results/${encodeURIComponent(id)}`} target="_blank" rel="noreferrer" style={{ opacity: 0.9, textDecoration: "none" }}>
                        Abrir individual ↗
                      </a>

                      {hasSummary && (
                        <button className="PrimaryFlavButton" onClick={() => deleteSummary(id)} disabled={deletingId === id} title="Eliminar el resumen">
                          {deletingId === id ? "⏳ Eliminando…" : "🗑 Eliminar resumen"}
                        </button>
                      )}
                    </div>
                  </div>

                  <details open={openAll} style={{ padding: 14 }}>
                    <summary style={{ cursor: "pointer", listStyle: "none", fontWeight: 800, opacity: 0.95, userSelect: "none" }}>
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
                      {hasSummary ? s!.summary : "Todavía no existe summary para este token (o lo has eliminado)."}
                    </div>
                  </details>
                </div>
              );
            })}
        </section>

        {/* === INFORME GLOBAL (SERVER-SIDE) === */}
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
<div style={{ display: "flex", alignItems: "center", gap: 12, justifyContent: "space-between", flexWrap: "wrap" }}>
            <h2 style={{ marginTop: 0, marginBottom: 10 }}>🧠 Informe global del grupo</h2>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button className="PrimaryFlavButton" onClick={() => generateGlobalFromServer(false)} disabled={globalLoading}>
                ⚡ Generar
              </button>
              <button className="PrimaryFlavButton" onClick={() => generateGlobalFromServer(true)} disabled={globalLoading}>
                🔁 Regenerar
              </button>
            </div>
          </div>

          <details open={false} style={{ padding: 2 }}>
            <summary style={{ cursor: "pointer", listStyle: "none", fontWeight: 900, opacity: 0.95, userSelect: "none", padding: "8px 0" }}>
              📌 Ver informe global
            </summary>

            {globalLoading && <p style={{ opacity: 0.85, marginTop: 10 }}>⏳ Generando…</p>}

            {globalError && (
              <div style={{ marginTop: 10, padding: 12, borderRadius: 12, border: "1px solid #f97373", backgroundColor: "#451a1a" }}>
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
              {globalText?.trim() ? globalText : "Aún no hay informe global generado. Pulsa “Generar” si quieres que se genere."}
            </div>
          </details>
        </section>
      </header>
    </div>
  );
};

export default ResultsGroupPage;