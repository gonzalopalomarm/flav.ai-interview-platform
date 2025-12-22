// src/pages/ResultsListPage.tsx
import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

type GroupRow = {
  groupId: string;
  restaurantName?: string;
  interviewIds: string[];
  createdAt?: string;
  updatedAt?: string;
};

type StoredGroup = {
  groupId: string;
  restaurantName?: string;
  interviewIds: string[];
  createdAt?: string;
  updatedAt?: string;
};

type CacheStatus = "unknown" | "missing" | "ready" | "error";

const API_BASE = "http://localhost:3001";

const ResultsListPage: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<GroupRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  // por grupo: si existe cache global en backend
  const [cacheMap, setCacheMap] = useState<Record<string, CacheStatus>>({});
  const [busyMap, setBusyMap] = useState<Record<string, boolean>>({});
  const [rowMsg, setRowMsg] = useState<Record<string, string>>({});

  // Lee todos los grupos guardados en localStorage: interview-group-<groupId>
  const localStorageGroups = useMemo(() => {
    const groups: GroupRow[] = [];

    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k) continue;
        if (!k.startsWith("interview-group-")) continue;

        const raw = localStorage.getItem(k);
        if (!raw) continue;

        const parsed = JSON.parse(raw) as StoredGroup;

        const groupId =
          parsed?.groupId ||
          k.replace("interview-group-", "").trim() ||
          "grupo-sin-id";

        const interviewIds = Array.isArray(parsed?.interviewIds)
          ? parsed.interviewIds.map(String).filter(Boolean)
          : [];

        groups.push({
          groupId,
          restaurantName: parsed?.restaurantName ? String(parsed.restaurantName) : undefined,
          interviewIds,
          createdAt: parsed?.createdAt ? String(parsed.createdAt) : undefined,
          updatedAt: parsed?.updatedAt ? String(parsed.updatedAt) : undefined,
        });
      }
    } catch (e: any) {
      console.error("Error leyendo interview-group-*:", e);
    }

    // orden: updatedAt desc (si existe), si no createdAt desc, si no groupId
    groups.sort((a, b) => {
      const ad = a.updatedAt
        ? Date.parse(a.updatedAt.replace(" ", "T"))
        : a.createdAt
        ? Date.parse(a.createdAt.replace(" ", "T"))
        : 0;
      const bd = b.updatedAt
        ? Date.parse(b.updatedAt.replace(" ", "T"))
        : b.createdAt
        ? Date.parse(b.createdAt.replace(" ", "T"))
        : 0;

      if (ad !== bd) return bd - ad;
      return b.groupId.localeCompare(a.groupId);
    });

    // sin duplicados por groupId
    const map = new Map<string, GroupRow>();
    for (const g of groups) map.set(g.groupId, g);
    return Array.from(map.values());
  }, []);

  // 1) cargar grupos
  useEffect(() => {
    const run = async () => {
      try {
        setLoading(true);
        setError(null);
        setRows(localStorageGroups);
      } catch (e: any) {
        setRows([]);
        setError(e?.message || "No se ha podido cargar el listado de grupos.");
      } finally {
        setLoading(false);
      }
    };
    run();
  }, [localStorageGroups]);

  // 2) mirar cache global en backend para cada grupo
  useEffect(() => {
    const checkAll = async () => {
      const next: Record<string, CacheStatus> = {};
      for (const g of rows) next[g.groupId] = "unknown";
      setCacheMap((prev) => ({ ...next, ...prev }));

      await Promise.all(
        rows.map(async (g) => {
          try {
            const res = await fetch(
              `${API_BASE}/api/group-summary-cache/${encodeURIComponent(g.groupId)}`
            );
            if (res.ok) {
              setCacheMap((m) => ({ ...m, [g.groupId]: "ready" }));
            } else if (res.status === 404) {
              setCacheMap((m) => ({ ...m, [g.groupId]: "missing" }));
            } else {
              setCacheMap((m) => ({ ...m, [g.groupId]: "error" }));
            }
          } catch {
            setCacheMap((m) => ({ ...m, [g.groupId]: "error" }));
          }
        })
      );
    };

    if (rows.length) checkAll();
  }, [rows]);

  async function generateGlobal(groupId: string) {
    setRowMsg((m) => ({ ...m, [groupId]: "" }));
    setBusyMap((m) => ({ ...m, [groupId]: true }));

    try {
      const res = await fetch(
        `${API_BASE}/api/group-summary/${encodeURIComponent(groupId)}`
      );

      const json = await res.json().catch(() => null);

      if (!res.ok) {
        const msg =
          json?.error ||
          `Error HTTP ${res.status}. Revisa el server y la consola.`;
        setRowMsg((m) => ({ ...m, [groupId]: `⚠️ ${msg}` }));
        setCacheMap((m) => ({ ...m, [groupId]: "error" }));
        return;
      }

      setRowMsg((m) => ({ ...m, [groupId]: "✅ Informe global generado" }));
      setCacheMap((m) => ({ ...m, [groupId]: "ready" }));
    } catch (e: any) {
      setRowMsg((m) => ({
        ...m,
        [groupId]: `⚠️ ${e?.message || "Error generando informe"}`,
      }));
      setCacheMap((m) => ({ ...m, [groupId]: "error" }));
    } finally {
      setBusyMap((m) => ({ ...m, [groupId]: false }));
    }
  }

  return (
    <div className="HeyGenStreamingAvatar">
      <header className="App-header" style={{ alignItems: "flex-start" }}>
        <h1 style={{ marginBottom: 6 }}>📋 Results — Grupos</h1>
        <p style={{ fontSize: 14, opacity: 0.8, marginTop: 0 }}>
          Aquí puedes generar y abrir el informe global de cada grupo.
        </p>

        <p style={{ marginTop: 10 }}>
          <Link to="/">← Volver a Home</Link>
        </p>

        {loading && <p style={{ marginTop: 16 }}>⏳ Cargando…</p>}

        {error && !loading && (
          <p style={{ marginTop: 16, opacity: 0.8 }}>⚠️ {error}</p>
        )}

        {!loading && rows.length === 0 && (
          <div
            style={{
              marginTop: 18,
              padding: 16,
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.15)",
              background: "rgba(2,6,23,0.6)",
              maxWidth: 900,
            }}
          >
            <strong>No hay grupos aún.</strong>
            <div style={{ marginTop: 6, fontSize: 14, opacity: 0.85 }}>
              Genera enlaces desde Admin para que se creen grupos automáticamente.
            </div>
          </div>
        )}

        {!loading && rows.length > 0 && (
          <div
            className="ResultsTableWrap"
            style={{ marginTop: 18, width: "100%", maxWidth: 1150 }}
          >
            <table className="ResultsTable">
              <thead>
                <tr>
                  <th>ID grupo / restaurante</th>
                  <th style={{ width: 120 }}>#</th>
                  <th style={{ width: 260 }}>Informe global</th>
                  <th style={{ width: 220 }}>Acción</th>
                  <th style={{ width: 360 }}>Entrevistas</th>
                </tr>
              </thead>

              <tbody>
                {rows.map((g) => {
                  const safeGroupId = encodeURIComponent(g.groupId);
                  const count = g.interviewIds?.length || 0;

                  const status = cacheMap[g.groupId] || "unknown";
                  const busy = !!busyMap[g.groupId];
                  const msg = rowMsg[g.groupId];

                  return (
                    <tr key={g.groupId}>
                      <td style={{ fontWeight: 800 }}>
                        {g.groupId}
                        {g.restaurantName ? (
                          <div style={{ fontWeight: 500, opacity: 0.75, marginTop: 4 }}>
                            {g.restaurantName}
                          </div>
                        ) : null}

                        <div style={{ marginTop: 6, fontSize: 12, opacity: 0.75 }}>
                          Estado global:{" "}
                          {status === "ready"
                            ? "✅ generado"
                            : status === "missing"
                            ? "— no generado"
                            : status === "error"
                            ? "⚠️ error"
                            : "…"}
                          {msg ? <div style={{ marginTop: 4 }}>{msg}</div> : null}
                        </div>
                      </td>

                      <td style={{ fontWeight: 700 }}>{count}</td>

                      <td>
                        <a
                          href={`/results/group/${safeGroupId}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          /results/group/{g.groupId}
                        </a>
                      </td>

                      <td>
                        <button
                          className="PrimaryFlavButton"
                          disabled={busy}
                          onClick={() => generateGlobal(g.groupId)}
                        >
                          {busy ? "⏳ Generando…" : "🧾 Generar / Regenerar"}
                        </button>
                      </td>

                      <td>
                        <details>
                          <summary style={{ cursor: "pointer", fontWeight: 700 }}>
                            Ver entrevistas ({count})
                          </summary>

                          <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                            {g.interviewIds.map((id) => {
                              const safeId = encodeURIComponent(id);
                              return (
                                <a
                                  key={id}
                                  href={`/results/${safeId}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  style={{ wordBreak: "break-all" }}
                                >
                                  {id}
                                </a>
                              );
                            })}
                          </div>
                        </details>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <p style={{ marginTop: 12, fontSize: 13, opacity: 0.75 }}>
              Nota: el informe global se genera en backend con{" "}
              <code>/api/group-summary/:groupId</code>.
            </p>
          </div>
        )}
      </header>
    </div>
  );
};

export default ResultsListPage;
