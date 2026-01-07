// Server/server.js
const path = require("path");
const fs = require("fs");

// ✅ Forzar a cargar SIEMPRE el .env dentro de /Server
const ENV_PATH = path.join(__dirname, ".env");
require("dotenv").config({ path: ENV_PATH });

const express = require("express");
const cors = require("cors");
const sqlite3 = require("sqlite3").verbose();

let OpenAI = null;
try {
  OpenAI = require("openai");
} catch {}

const app = express();

/**
 * CORS:
 * - En local: http://localhost:3000
 * - En producción: añade dominios en ENV:
 *   - PUBLIC_CLIENT_URL=https://xxxxx.trycloudflare.com
 *   - CORS_ORIGINS=https://tuapp.com,https://www.amint.es
 */
const DEFAULT_ORIGINS = ["http://localhost:3000"];

const extraOrigins = String(process.env.CORS_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const allowedOrigins = Array.from(
  new Set([
    ...DEFAULT_ORIGINS,
    ...extraOrigins,
    ...(process.env.PUBLIC_CLIENT_URL ? [process.env.PUBLIC_CLIENT_URL.trim()] : []),
  ])
);

// ✅ Logs útiles
console.log("🧾 ENV loaded from:", ENV_PATH, "exists:", fs.existsSync(ENV_PATH));
console.log("🌐 allowedOrigins (CORS):", allowedOrigins);
console.log("🧾 PUBLIC_CLIENT_URL:", process.env.PUBLIC_CLIENT_URL || null);
console.log("🧾 CORS_ORIGINS:", process.env.CORS_ORIGINS || null);
console.log("🧾 PORT (env):", process.env.PORT || null);

// OJO: si llega sin origin (curl/postman) lo permitimos.
app.use(
  cors({
    origin: function (origin, cb) {
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      return cb(new Error("Not allowed by CORS: " + origin));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  })
);

// ✅ Para evitar problemas con preflight en algunos casos
app.options("*", cors());

app.use(express.json({ limit: "5mb" }));

// ===============================
// ✅ PASO C: endpoints simples para comprobar que el server está vivo
// ===============================
app.get("/", (_req, res) => res.status(200).send("OK - flavaai api"));
app.get("/healthz", (_req, res) => res.status(200).json({ ok: true }));

// (Mantengo tu health anterior por compatibilidad)
app.get("/health", (_req, res) => res.json({ ok: true }));

// (Opcional) devolver URL pública del front según backend
app.get("/api/public-app-url", (_req, res) => {
  res.json({
    publicAppUrl: String(process.env.PUBLIC_CLIENT_URL || "").trim() || null,
  });
});

// ===============================
// SQLite setup
// ===============================
const DATA_DIR = path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, "summaries.db");

// ✅ Log CLAVE: cuál es la DB real que está usando ESTE backend
console.log("🗄️ SQLite DB_PATH:", DB_PATH);

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error("❌ Error abriendo SQLite:", err);
    process.exit(1);
  }
  console.log("✅ Base de datos SQLite inicializada");
});

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}
function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}
function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

async function initDb() {
  // ✅ configs por entrevista (para que el candidato NO dependa de localStorage)
  await run(`
    CREATE TABLE IF NOT EXISTS interview_configs (
      interviewId TEXT PRIMARY KEY,
      configJson TEXT NOT NULL,
      metaJson TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS summaries (
      interviewId TEXT PRIMARY KEY,
      summary TEXT NOT NULL,
      rawConversation TEXT,
      createdAt TEXT NOT NULL
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS groups (
      groupId TEXT PRIMARY KEY,
      restaurantName TEXT,
      interviewIds TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS group_summaries (
      groupId TEXT PRIMARY KEY,
      summary TEXT NOT NULL,
      createdAt TEXT NOT NULL
    )
  `);

  console.log("✅ Tablas verificadas");
}

// ✅ ENDPOINT DEBUG: confirma DB + contadores + ENV real + CORS real
app.get("/api/debug/db", async (_req, res) => {
  try {
    const row1 = await get(`SELECT COUNT(*) as n FROM interview_configs`);
    const row2 = await get(`SELECT COUNT(*) as n FROM summaries`);
    const row3 = await get(`SELECT COUNT(*) as n FROM groups`);
    res.json({
      ok: true,
      envPathLoaded: ENV_PATH,
      envFileExists: fs.existsSync(ENV_PATH),
      dbPath: DB_PATH,
      counts: {
        interview_configs: row1?.n ?? null,
        summaries: row2?.n ?? null,
        groups: row3?.n ?? null,
      },
      env: {
        PUBLIC_CLIENT_URL: process.env.PUBLIC_CLIENT_URL || null,
        CORS_ORIGINS: process.env.CORS_ORIGINS || null,
        PORT: process.env.PORT || null,
      },
      allowedOrigins,
    });
  } catch (e) {
    console.error("❌ debug/db:", e);
    res.status(500).json({ ok: false });
  }
});

// ===============================
// ✅ ENDPOINTS PUBLICOS PARA CONFIG DE ENTREVISTA
// ===============================
app.post("/api/save-interview-config", async (req, res) => {
  try {
    const { interviewId, config, meta } = req.body || {};
    if (!interviewId || !config) {
      return res.status(400).json({ error: "Faltan interviewId o config" });
    }

    const cfg = config || {};

    // Validación mínima
    if (
      !cfg.objective ||
      !cfg.tone ||
      !Array.isArray(cfg.questions) ||
      cfg.questions.length === 0 ||
      !cfg.avatarId ||
      !cfg.voiceId
    ) {
      return res.status(400).json({ error: "Config inválida (faltan campos)" });
    }

    const now = new Date().toISOString();
    const id = String(interviewId);

    await run(
      `
      INSERT INTO interview_configs (interviewId, configJson, metaJson, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(interviewId) DO UPDATE SET
        configJson=excluded.configJson,
        metaJson=excluded.metaJson,
        updatedAt=excluded.updatedAt
      `,
      [id, JSON.stringify(cfg), meta ? JSON.stringify(meta) : null, now, now]
    );

    console.log("✅ SAVE CONFIG", {
      interviewId: id,
      bytes: JSON.stringify(cfg).length,
      hasMeta: !!meta,
    });

    const check = await get(`SELECT interviewId FROM interview_configs WHERE interviewId = ?`, [id]);
    console.log("✅ SAVE CONFIG CHECK", { interviewId: id, exists: !!check });

    res.json({ ok: true });
  } catch (e) {
    console.error("❌ save-interview-config:", e);
    res.status(500).json({ error: "Error guardando config" });
  }
});

app.get("/api/interview-config/:token", async (req, res) => {
  try {
    const token = String(req.params.token);
    console.log("🔎 GET CONFIG", { token });

    const row = await get(
      `SELECT interviewId, configJson, metaJson, createdAt, updatedAt FROM interview_configs WHERE interviewId = ?`,
      [token]
    );

    if (!row) {
      const countRow = await get(`SELECT COUNT(*) as n FROM interview_configs`);
      console.log("🔎 GET CONFIG MISS", { token, totalConfigs: countRow?.n ?? null });
      return res.status(404).json({ error: "Config no encontrada" });
    }

    let config = null;
    try {
      config = JSON.parse(row.configJson || "{}");
    } catch {
      config = null;
    }

    if (!config) return res.status(500).json({ error: "Config corrupta en BD" });

    let meta = undefined;
    try {
      meta = row.metaJson ? JSON.parse(row.metaJson) : undefined;
    } catch {
      meta = undefined;
    }

    res.json({
      interviewId: row.interviewId,
      config,
      meta,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  } catch (e) {
    console.error("❌ get interview-config:", e);
    res.status(500).json({ error: "Error leyendo config" });
  }
});

// ===============================
// Global group summary (OpenAI)
// ===============================
const GROUP_SYSTEM_PROMPT = `
Eres un consultor senior de research cualitativo (CX/UX/Market Research) especializado en hostelería/restauración.

Vas a recibir VARIOS informes individuales (ya resumidos) de entrevistas del mismo restaurante/grupo.
Tu tarea es crear UN ÚNICO INFORME GLOBAL, más profesional y visual, siguiendo una estructura muy similar a la de los informes individuales.

Reglas:
- Responde en ESPAÑOL.
- No inventes datos. Solo sintetiza lo que aparece en los informes individuales.
- Debes detectar patrones repetidos, tensiones, contradicciones, y prioridades.
- Mantén formato muy visual, con emojis, títulos claros, y bullets que NO sean demasiado cortos (aporta contexto).
- NO escribas un texto largo sin estructura.
`.trim();

function buildGroupPrompt(group, blocks) {
  const restaurantLabel = group.restaurantName
    ? `Restaurante: ${group.restaurantName}`
    : `Grupo: ${group.groupId}`;

  return `
${restaurantLabel}
ID grupo: ${group.groupId}
Nº entrevistas en el grupo: ${group.interviewIds.length}
Nº entrevistas con informe disponible: ${blocks.length}

INFORMES INDIVIDUALES:
${blocks.map((b, i) => `--- ENTREVISTA ${i + 1} (${b.id}) ---\n${b.summary}`).join("\n\n")}

FORMATO:
📌 0) Resumen ejecutivo (1 frase)

📌 1) Insights clave (6-10 bullets)
- Emoji + **titular** + 1-2 frases con contexto

💬 2) Evidencias / citas (5-8)
- ➤ “cita” — (entrevista <id>)

🎯 3) Recomendaciones (6-10)
- ⬜️ Acción + impacto

🎨 4) Persona global
- Nombre ficticio, objetivos, frustraciones

⚠️ 5) Riesgos (si aplica)
`.trim();
}

// ===============================
// ENDPOINTS: summaries individuales
// ===============================
app.post("/api/save-summary", async (req, res) => {
  try {
    const { interviewId, summary, rawConversation } = req.body || {};
    if (!interviewId || !summary) {
      return res.status(400).json({ error: "Faltan interviewId o summary" });
    }

    const now = new Date().toISOString();

    await run(
      `
      INSERT INTO summaries (interviewId, summary, rawConversation, createdAt)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(interviewId) DO UPDATE SET
        summary=excluded.summary,
        rawConversation=excluded.rawConversation,
        createdAt=excluded.createdAt
      `,
      [String(interviewId), String(summary), rawConversation ? String(rawConversation) : null, now]
    );

    res.json({ ok: true });
  } catch (e) {
    console.error("❌ save-summary:", e);
    res.status(500).json({ error: "Error guardando summary" });
  }
});

app.get("/api/summary/:token", async (req, res) => {
  try {
    const token = String(req.params.token);
    const row = await get(`SELECT * FROM summaries WHERE interviewId = ?`, [token]);

    if (!row) return res.status(404).send("No existe summary para este token.");
    res.json(row);
  } catch (e) {
    console.error("❌ get summary:", e);
    res.status(500).send("Error leyendo summary.");
  }
});

app.get("/api/summaries", async (_req, res) => {
  try {
    const rows = await all(`SELECT * FROM summaries ORDER BY createdAt DESC LIMIT 500`);
    res.json(rows);
  } catch (e) {
    console.error("❌ list summaries:", e);
    res.status(500).json([]);
  }
});

// ===============================
// ENDPOINTS: grupos
// ===============================
app.post("/api/save-group", async (req, res) => {
  try {
    const { groupId, restaurantName, interviewIds } = req.body || {};
    if (!groupId || !Array.isArray(interviewIds) || interviewIds.length === 0) {
      return res.status(400).json({ error: "Faltan groupId o interviewIds" });
    }

    const gid = String(groupId);
    const now = new Date().toISOString();

    const existing = await get(`SELECT * FROM groups WHERE groupId = ?`, [gid]);
    const existingIds = existing?.interviewIds ? JSON.parse(existing.interviewIds) : [];
    const merged = Array.from(new Set([...(existingIds || []), ...interviewIds.map(String)]));

    await run(
      `
      INSERT INTO groups (groupId, restaurantName, interviewIds, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(groupId) DO UPDATE SET
        restaurantName=excluded.restaurantName,
        interviewIds=excluded.interviewIds,
        updatedAt=excluded.updatedAt
      `,
      [
        gid,
        restaurantName ? String(restaurantName) : existing?.restaurantName || null,
        JSON.stringify(merged),
        existing?.createdAt || now,
        now,
      ]
    );

    const saved = await get(`SELECT * FROM groups WHERE groupId = ?`, [gid]);
    res.json({
      ok: true,
      group: {
        groupId: saved.groupId,
        restaurantName: saved.restaurantName || undefined,
        interviewIds: JSON.parse(saved.interviewIds),
        createdAt: saved.createdAt,
        updatedAt: saved.updatedAt,
      },
    });
  } catch (e) {
    console.error("❌ save-group:", e);
    res.status(500).json({ error: "Error guardando grupo" });
  }
});

app.get("/api/group/:groupId", async (req, res) => {
  try {
    const gid = String(req.params.groupId);
    const g = await get(`SELECT * FROM groups WHERE groupId = ?`, [gid]);
    if (!g) return res.status(404).json({ error: "Grupo no encontrado" });

    res.json({
      groupId: g.groupId,
      restaurantName: g.restaurantName || undefined,
      interviewIds: JSON.parse(g.interviewIds),
      createdAt: g.createdAt,
      updatedAt: g.updatedAt,
    });
  } catch (e) {
    console.error("❌ get-group:", e);
    res.status(500).json({ error: "Error leyendo grupo" });
  }
});

app.get("/api/groups", async (_req, res) => {
  try {
    const rows = await all(`SELECT * FROM groups ORDER BY updatedAt DESC LIMIT 500`);
    res.json(
      rows.map((g) => ({
        groupId: g.groupId,
        restaurantName: g.restaurantName || undefined,
        interviewIds: JSON.parse(g.interviewIds),
        createdAt: g.createdAt,
        updatedAt: g.updatedAt,
      }))
    );
  } catch (e) {
    console.error("❌ list-groups:", e);
    res.status(500).json([]);
  }
});

// ===============================
// ENDPOINT: informe global de grupo (cache + refresh)
// ===============================
app.get("/api/group-summary/:groupId", async (req, res) => {
  try {
    const gid = String(req.params.groupId);
    const refresh = String(req.query.refresh || "") === "1";

    const g = await get(`SELECT * FROM groups WHERE groupId = ?`, [gid]);
    if (!g) return res.status(404).json({ error: "Grupo no encontrado" });

    const group = {
      groupId: g.groupId,
      restaurantName: g.restaurantName || undefined,
      interviewIds: JSON.parse(g.interviewIds),
    };

    if (!refresh) {
      const cached = await get(`SELECT * FROM group_summaries WHERE groupId = ?`, [gid]);
      if (cached?.summary?.trim()) return res.json(cached);
    }

    const blocks = [];
    for (const id of group.interviewIds) {
      const row = await get(`SELECT summary FROM summaries WHERE interviewId = ?`, [String(id)]);
      if (row?.summary?.trim()) blocks.push({ id: String(id), summary: String(row.summary).trim() });
    }

    if (blocks.length === 0) {
      return res.status(400).json({ error: "No hay summaries individuales todavía para este grupo." });
    }

    if (!OpenAI) return res.status(500).json({ error: "Falta paquete openai (npm i openai)" });
    if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: "Falta OPENAI_API_KEY en .env" });

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        { role: "system", content: GROUP_SYSTEM_PROMPT },
        { role: "user", content: buildGroupPrompt(group, blocks) },
      ],
      temperature: 0.4,
    });

    const text = completion?.choices?.[0]?.message?.content?.trim() || "";
    if (!text) return res.status(500).json({ error: "OpenAI devolvió respuesta vacía" });

    const now = new Date().toISOString();
    await run(
      `
      INSERT INTO group_summaries (groupId, summary, createdAt)
      VALUES (?, ?, ?)
      ON CONFLICT(groupId) DO UPDATE SET
        summary=excluded.summary,
        createdAt=excluded.createdAt
      `,
      [gid, text, now]
    );

    const saved = await get(`SELECT * FROM group_summaries WHERE groupId = ?`, [gid]);
    res.json(saved);
  } catch (e) {
    console.error("❌ group-summary:", e);
    res.status(500).json({ error: "Error generando informe global" });
  }
});

// ===============================
// ✅ Render-compatible listen: PORT + 0.0.0.0 + log correcto
// ===============================
const PORT = Number(process.env.PORT || 3001);

initDb()
  .then(() => {
    console.log("✅ CORS allowed origins:", allowedOrigins);
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`🚀 Server listening on http://0.0.0.0:${PORT}`);
    });
  })
  .catch((e) => {
    console.error("❌ Error initDb:", e);
    process.exit(1);
  });
