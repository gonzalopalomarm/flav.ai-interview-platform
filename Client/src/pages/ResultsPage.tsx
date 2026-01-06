// src/pages/ResultsPage.tsx
import React, { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";

const API_BASE = (process.env.REACT_APP_API_BASE_URL || "http://localhost:3001").trim();

type SummaryResponse = {
  interviewId: string;
  summary: string;
  rawConversation?: string;
  createdAt?: string;
};

type IndividualSummaryCache = {
  interviewId: string;
  summary: string;
  createdAt?: string;
  rawConversation?: string;
};

function safeJsonParse<T = any>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

const ResultsPage: React.FC = () => {
  const { token } = useParams<{ token: string }>();

  const requestUrl = useMemo(() => {
    if (!token) return "";
    return `${API_BASE}/api/summary/${encodeURIComponent(token)}`;
  }, [token]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<SummaryResponse | null>(null);

  // 👇 Debug visible para ver si el build usa un API_BASE raro (muy común)
  const [debug, setDebug] = useState("");

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (!token) {
        setError("Falta el identificador de entrevista en la URL.");
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);
      setData(null);

      setDebug(
        `API_BASE="${API_BASE}" | request="${requestUrl}" | origin="${window.location.origin}"`
      );

      // 1) Intento BACKEND
      try {
        const res = await fetch(requestUrl, {
          method: "GET",
          cache: "no-store",
          headers: {
            Accept: "application/json",
          },
        });

        const text = await res.text().catch(() => "");
        const parsed = safeJsonParse<SummaryResponse | SummaryResponse[] | { error?: string }>(text);

        if (!res.ok) {
          const msg =
            (parsed as any)?.error ||
            text ||
            `No se ha encontrado ningún resumen (HTTP ${res.status}).`;
          throw new Error(msg);
        }

        const entry = Array.isArray(parsed) ? (parsed[0] as SummaryResponse) : (parsed as SummaryResponse);

        if (!entry || !entry.summary) {
          throw new Error("El backend respondió, pero no hay 'summary' en la respuesta.");
        }

        if (cancelled) return;

        setData(entry);

        // ✅ Cache local (una sola vez)
        try {
          const cache: IndividualSummaryCache = {
            interviewId: token,
            summary: entry.summary,
            createdAt: entry.createdAt,
            rawConversation: entry.rawConversation,
          };
          localStorage.setItem(`interview-summary-${token}`, JSON.stringify(cache));
        } catch {}

        setLoading(false);
        return;
      } catch (e: any) {
        // 2) Fallback: localStorage (si existiera)
        try {
          const raw = localStorage.getItem(`interview-summary-${token}`);
          const cached = raw ? safeJsonParse<IndividualSummaryCache>(raw) : null;

          if (cached?.summary) {
            if (cancelled) return;

            setData({
              interviewId: cached.interviewId,
              summary: cached.summary,
              createdAt: cached.createdAt,
              rawConversation: cached.rawConversation,
            });

            setError(
              `⚠️ No pude cargar el resumen desde el backend. Mostrando copia local. Detalle: ${
                e?.message || "Error"
              }`
            );
            setLoading(false);
            return;
          }
        } catch {}

        if (cancelled) return;

        console.error("Error cargando resumen:", e);
        setError(e?.message || "Se ha producido un error al recuperar el resumen de la entrevista.");
        setLoading(false);
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [token, requestUrl]);

  return (
    <div className="HeyGenStreamingAvatar">
      <header className="App-header" style={{ alignItems: "flex-start" }}>
        <div className="BrandBar">
          <div className="BrandLeft">
            <div className="BrandText">
              <span className="BrandName">AMINT</span>
              <span className="BrandSubtitle"> - Informe de entrevista</span>
            </div>
          </div>
        </div>

        <h1 style={{ marginBottom: 4 }}>📊 Resultados de la entrevista</h1>

        <p style={{ fontSize: 14, opacity: 0.8, marginBottom: 4 }}>
          Token: <strong>{token}</strong>
        </p>

        {!!debug && (
          <p style={{ fontSize: 12, opacity: 0.55, marginTop: 0, marginBottom: 0 }}>
            (debug) {debug}
          </p>
        )}

        {data?.createdAt && (
          <p style={{ fontSize: 13, opacity: 0.6, marginTop: 6 }}>
            Generado el: {new Date(String(data.createdAt).replace(" ", "T")).toLocaleString()}
          </p>
        )}

        <p style={{ marginTop: 12 }}>
          <Link to="/">← Volver a Home</Link>
        </p>

        {loading && <p style={{ marginTop: 24 }}>⏳ Cargando informe de la entrevista…</p>}

        {error && !loading && (
          <div
            style={{
              marginTop: 24,
              padding: 16,
              borderRadius: 12,
              border: "1px solid #f97373",
              backgroundColor: "#451a1a",
              maxWidth: 800,
            }}
          >
            <h3 style={{ marginTop: 0 }}>⚠️ No se ha podido cargar el resumen</h3>
            <p style={{ marginBottom: 0 }}>{error}</p>
          </div>
        )}

        {data && !loading && (
          <main
            style={{
              marginTop: 24,
              padding: 24,
              borderRadius: 16,
              border: "1px solid #4b5563",
              backgroundColor: "#020617",
              width: "100%",
              maxWidth: 900,
              textAlign: "left",
            }}
          >
            <h2 style={{ marginTop: 0, marginBottom: 12 }}>🧾 Informe cualitativo</h2>

            <section
              style={{
                marginTop: 16,
                padding: 16,
                borderRadius: 12,
                backgroundColor: "#0b1120",
                lineHeight: 1.6,
                fontSize: 15,
                whiteSpace: "pre-wrap",
              }}
            >
              {data.summary}
            </section>

            {data.rawConversation && (
              <section style={{ marginTop: 24, paddingTop: 16, borderTop: "1px solid #374151" }}>
                <details>
                  <summary style={{ cursor: "pointer", fontSize: 15, fontWeight: 500 }}>
                    💬 Ver transcripción completa de la entrevista
                  </summary>
                  <pre
                    style={{
                      marginTop: 12,
                      whiteSpace: "pre-wrap",
                      backgroundColor: "#020617",
                      borderRadius: 8,
                      padding: 12,
                      maxHeight: 320,
                      overflow: "auto",
                      fontSize: 13,
                    }}
                  >
                    {data.rawConversation}
                  </pre>
                </details>
              </section>
            )}
          </main>
        )}
      </header>
    </div>
  );
};

export default ResultsPage;
