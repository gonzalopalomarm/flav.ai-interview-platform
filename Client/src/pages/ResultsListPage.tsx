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

const API_BASE = process.env.REACT_APP_API_BASE_URL || "http://localhost:3001";

const ResultsListPage: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<GroupRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [cacheMap, setCacheMap] = useState<Record<string, CacheStatus>>({});
  const [busyMap, setBusyMap] = useState<Record<string, boolean>>({});
  const [rowMsg, setRowMsg] = useState<Record<string, string>>({});

  // =========================
  // CARGAR GRUPOS DESDE LOCALSTORAGE
  // =========================
  const localStorageGroups = useMemo(() => {
    const groups: GroupRow[] = [];

    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || !k.startsWith("interview-group-")) continue;

        const raw = localStorage.getItem(k);
        if (!raw) continue;

        const parsed = JSON.parse(raw) as StoredGroup;
        const groupId =
          parsed?.groupId || k.replace("interview-group-", "").trim();

        groups.push({
          groupId,
          restaurantName: parsed?.restaurantName,
          interviewIds: Array.isArray(parsed?.interviewIds)
            ? parsed.interviewIds
            : [],
          createdAt: parsed?.createdAt,
          updatedAt: parsed?.updatedAt,
        });
      }
    } catch (e) {
      console.error("Error leyendo grupos:", e);
    }

    // ordenar
    groups.sort((a, b) => {
      const ad = a.updatedAt ? Date.parse(a.updatedAt) : 0;
      const bd = b.updatedAt ? Date.parse(b.updatedAt) : 0;
      return bd - ad;
    });

    const map = new Map<string, GroupRow>();
    for (const g of groups) map.set(g.groupId, g);
    return Array.from(map.values());
  }, []);

  useEffect(() => {
    setLoading(true);
    setRows(localStorageGroups);
    setLoading(false);
  }, [localStorageGroups]);

  // =========================
  // COMPROBAR CACHE GLOBAL
  // =========================
  useEffect(() => {
    rows.forEach(async (g) => {
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
    });
  }, [rows]);

  // =========================
  // GENERAR INFORME GLOBAL
  // =========================
  async function generateGlobal(groupId: string) {
    setBusyMap((m) => ({ ...m, [groupId]: true }));
    setRowMsg((m) => ({ ...m, [groupId]: "" }));

    try {
      const res = await fetch(
        `${API_BASE}/api/group-summary/${encodeURIComponent(groupId)}`
      );

      if (!res.ok) throw new Error("Error generando informe");

      setRowMsg((m) => ({ ...m, [groupId]: "✅ Informe generado" }));
      setCacheMap((m) => ({ ...m, [groupId]: "ready" }));
    } catch (e: any) {
      setRowMsg((m) => ({ ...m, [groupId]: `⚠️ ${e.message}` }));
      setCacheMap((m) => ({ ...m, [groupId]: "error" }));
    } finally {
      setBusyMap((m) => ({ ...m, [groupId]: false }));
    }
  }

  // =========================
  // ELIMINAR GRUPO (NUEVA COLUMNA)
  // =========================
  async function deleteGroup(groupId: string) {
    const ok = window.confirm(
      `¿Seguro que quieres eliminar el grupo "${groupId}"?\n\nEsta acción no se puede deshacer.`
    );
    if (!ok) return;

    // UI inmediata
    setRows((prev) => prev.filter((g) => g.groupId !== groupId));

    // limpiar caches locales
    localStorage.removeItem(`interview-group-${groupId}`);
    localStorage.removeItem(`group-global-sum-${groupId}`);

    // backend (si existe)
    try {
      await fetch(`${API_BASE}/api/group/${encodeURIComponent(groupId)}`, {
        method: "DELETE",
      });
    } catch {
      // silencioso
    }
  }

  // =========================
  // RENDER
  // =========================
  return (
    <div className="HeyGenStreamingAvatar">
      <header className="App-header" style={{ alignItems: "flex-start" }}>
        <h1>📋 Results — Grupos</h1>

        <p>
          <Link to="/">← Volver a Home</Link>
        </p>

        {loading && <p>⏳ Cargando…</p>}
        {error && <p>⚠️ {error}</p>}

        {!loading && rows.length > 0 && (
          <div style={{ marginTop: 18, width: "100%", maxWidth: 1200 }}>
            <table className="ResultsTable">
              <thead>
                <tr>
                  <th>ID grupo / restaurante</th>
                  <th>#</th>
                  <th>Informe global</th>
                  <th>Acción</th>
                  <th>Entrevistas</th>
                  <th style={{ width: 120 }}>Eliminar</th>
                </tr>
              </thead>

              <tbody>
                {rows.map((g) => {
                  const count = g.interviewIds.length;
                  const status = cacheMap[g.groupId] || "unknown";
                  const busy = busyMap[g.groupId];

                  return (
                    <tr key={g.groupId}>
                      <td style={{ fontWeight: 800 }}>
                        {g.groupId}
                        {g.restaurantName && (
                          <div style={{ opacity: 0.7 }}>{g.restaurantName}</div>
                        )}
                        <div style={{ fontSize: 12, opacity: 0.75 }}>
                          Estado global:{" "}
                          {status === "ready"
                            ? "✅ generado"
                            : status === "missing"
                            ? "— no generado"
                            : status === "error"
                            ? "⚠️ error"
                            : "…"}
                        </div>
                      </td>

                      <td>{count}</td>

                      <td>
                        <a
                          href={`/results/group/${encodeURIComponent(g.groupId)}`}
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
                          <summary style={{ cursor: "pointer" }}>
                            Ver entrevistas ({count})
                          </summary>
                          <div style={{ marginTop: 8 }}>
                            {g.interviewIds.map((id) => (
                              <div key={id}>{id}</div>
                            ))}
                          </div>
                        </details>
                      </td>

                      {/* 👇 COLUMNA NUEVA A LA DERECHA DEL TODO */}
                      <td>
                        <button
                          className="PrimaryFlavButton"
                          onClick={() => deleteGroup(g.groupId)}
                        >
                          🗑 Eliminar
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </header>
    </div>
  );
};

export default ResultsListPage;
