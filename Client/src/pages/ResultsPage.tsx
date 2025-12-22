// src/pages/ResultsPage.tsx
import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

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
};

const ResultsPage: React.FC = () => {
  const { token } = useParams<{ token: string }>();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<SummaryResponse | null>(null);

  useEffect(() => {
    if (!token) {
      setError("Falta el identificador de entrevista en la URL.");
      setLoading(false);
      return;
    }

    const fetchSummary = async () => {
      try {
        setLoading(true);
        setError(null);

        const res = await fetch(
          `http://localhost:3001/api/summary/${encodeURIComponent(token)}`
        );

        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(text || `No se ha encontrado ningún resumen para la entrevista.`);
        }

        const json: SummaryResponse | SummaryResponse[] = await res.json();
        const entry = Array.isArray(json) ? json[0] : json;

        if (!entry || !entry.summary) {
          throw new Error("No hay resumen guardado para esta entrevista.");
        }

        setData(entry);
                // cache local para usos futuros (por ejemplo, agregación o fallback)
                try {
                localStorage.setItem(
                    `interview-summary-${token}`,
                    JSON.stringify({
                    interviewId: token,
                    summary: entry.summary,
                    createdAt: entry.createdAt,
                    })
                );
                } catch {}

        // ✅ CACHE LOCAL: para poder generar informes globales aunque falle el backend luego
        const cache: IndividualSummaryCache = {
          interviewId: token,
          summary: entry.summary,
          createdAt: entry.createdAt,
        };
        localStorage.setItem(`interview-summary-${token}`, JSON.stringify(cache));
      } catch (e: any) {
        console.error("Error cargando resumen:", e);
        setError(
          e?.message ||
            "Se ha producido un error al recuperar el resumen de la entrevista."
        );
      } finally {
        setLoading(false);
      }
    };

    fetchSummary();
  }, [token]);

  return (
    <div className="HeyGenStreamingAvatar">
      <header className="App-header" style={{ alignItems: "flex-start" }}>
        <div className="BrandBar">
          <div className="BrandLeft">
            <div className="BrandText">
              <span className="BrandName">AMINT</span>
              <span className="BrandSubtitle">Informe de entrevista</span>
            </div>
          </div>
        </div>

        <h1 style={{ marginBottom: 4 }}>📊 Resultados de la entrevista</h1>

        <p style={{ fontSize: 14, opacity: 0.8, marginBottom: 4 }}>
          Token: <strong>{token}</strong>
        </p>

        {data?.createdAt && (
          <p style={{ fontSize: 13, opacity: 0.6, marginTop: 0 }}>
            Generado el: {new Date(data.createdAt.replace(" ", "T")).toLocaleString()}
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

        {data && !loading && !error && (
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
