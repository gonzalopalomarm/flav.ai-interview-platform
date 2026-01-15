// Server/server.js
// ✅ FORCE GIT CHANGE: lock down admin endpoints + protect refresh (2026-01-10)

const path = require("path");
const fs = require("fs");

// ✅ Forzar a cargar SIEMPRE el .env dentro de /Server
const ENV_PATH = path.join(__dirname, ".env");
require("dotenv").config({ path: ENV_PATH });

const express = require("express");
const cors = require("cors");
const sqlite3 = require("sqlite3").verbose();

// ✅ HTTP client (ya lo tienes en package.json)
const axios = require("axios");

// ✅ para subir audio (multipart/form-data)
const multer = require("multer");
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
});

let OpenAI = null;
let toFile = null;

try {
  OpenAI = require("openai");
  ({ toFile } = require("openai/uploads"));
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

app.use(express.json({ limit: "10mb" }));

// ===============================
// ✅ Endpoints simples para comprobar que el server está vivo
// ===============================
app.get("/", (_req, res) => res.status(200).send("OK - flavaai api"));
app.get("/healthz", (_req, res) => res.status(200).json({ ok: true }));
app.get("/health", (_req, res) => res.json({ ok: true }));

// (Opcional) devolver URL pública del front según backend
app.get("/api/public-app-url", (_req, res) => {
  res.json({
    publicAppUrl: String(process.env.PUBLIC_CLIENT_URL || "").trim() || null,
  });
});

// ✅ Whoami (debug rápido)
app.get("/api/whoami", (_req, res) => {
  res.json({
    ok: true,
    service: "flavaai-api",
    openaiCtor: !!OpenAI,
    toFile: !!toFile,
    hasOPENAIKey: !!process.env.OPENAI_API_KEY,
    hasHEYGENKey: !!process.env.HEYGEN_API_KEY,
    hasADMINToken: !!process.env.ADMIN_TOKEN,
    node: process.version,
  });
});

// =====================================================
// ✅ ADMIN TOKEN (proteger panel y endpoints internos)
// =====================================================
function getAdminToken() {
  return String(process.env.ADMIN_TOKEN || "").trim();
}

function requireAdmin(req, res, next) {
  const serverToken = getAdminToken();
  if (!serverToken) {
    // Si no hay token configurado, mejor bloquear por seguridad.
    return res.status(500).json({ error: "ADMIN_TOKEN no configurado en el server" });
  }

  // Permitimos 2 formas: header x-admin-token o Authorization: Bearer
  const headerToken = String(req.headers["x-admin-token"] || "").trim();
  const auth = String(req.headers.authorization || "").trim();
  const bearerToken = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";

  const token = headerToken || bearerToken;
  if (!token || token !== serverToken) {
    return res.status(401).json({ error: "Unauthorized (admin)" });
  }

  return next();
}

// Ping para comprobar token fácilmente
app.get("/api/admin/ping", requireAdmin, (_req, res) => res.json({ ok: true }));

// =====================================================
// ✅ PROXY HeyGen (CORRECTO) para evitar CORS del navegador
// =====================================================
function requireHeyGen(res) {
  const key = String(process.env.HEYGEN_API_KEY || "").trim();
  if (!key) {
    res.status(500).json({ error: "Falta HEYGEN_API_KEY en Render (Server)" });
    return null;
  }
  return key;
}

// Preflight específico (por si el navegador hace OPTIONS a /api/heygen/...)
app.options("/api/heygen/*", (_req, res) => {
  return res.status(204).send("");
});

app.all("/api/heygen/*", async (req, res) => {
  try {
    const heygenKey = requireHeyGen(res);
    if (!heygenKey) return;

    const targetPath = req.originalUrl.replace("/api/heygen", "");
    const url = `https://api.heygen.com${targetPath}`;

    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${heygenKey}`,
    };

    const method = String(req.method || "GET").toUpperCase();
    const data =
      method === "POST" || method === "PUT" || method === "PATCH"
        ? req.body && Object.keys(req.body).length
          ? req.body
          : {}
        : undefined;

    const axRes = await axios({
      method,
      url,
      headers,
      data,
      validateStatus: () => true,
      responseType: "arraybuffer",
      timeout: 30000,
    });

    res.status(axRes.status);

    const ct = axRes.headers["content-type"];
    if (ct) res.setHeader("content-type", ct);

    const buf = Buffer.from(axRes.data || []);

    if (ct && ct.includes("application/json")) {
      const text = buf.toString("utf8");
      try {
        return res.send(JSON.parse(text));
      } catch {
        return res.send(text);
      }
    }

    return res.send(buf);
  } catch (e) {
    console.error("❌ HeyGen proxy error:", e?.message || e);
    res.status(500).json({
      error: "Error proxy HeyGen",
      detail: e?.message || String(e),
    });
  }
});

// ===============================
// SQLite setup
// ===============================
const DATA_DIR = path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, "summaries.db");
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
// 🔒 protegido porque da info interna
app.get("/api/debug/db", requireAdmin, async (_req, res) => {
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

// =====================================================
// ✅ OpenAI server-side endpoints (PRODUCCIÓN)
// =====================================================
function requireOpenAI(res) {
  if (!OpenAI) {
    res.status(500).json({ error: "Falta paquete openai (npm i openai)" });
    return null;
  }
  if (!process.env.OPENAI_API_KEY) {
    res.status(500).json({ error: "Falta OPENAI_API_KEY en variables de entorno (Render)" });
    return null;
  }
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

function sendOpenAIError(res, e, where) {
  const status = e?.status || e?.response?.status || 500;
  const detail =
    e?.error?.message ||
    e?.response?.data?.error?.message ||
    e?.message ||
    "Unknown error";
  console.error(`❌ ${where}:`, e);
  return res.status(status).json({
    error: `Error en ${where}`,
    status,
    detail,
  });
}

// ✅ 1) Chat completions
app.post("/api/openai/chat", async (req, res) => {
  try {
    const openai = requireOpenAI(res);
    if (!openai) return;

    const { messages, model, temperature } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "Faltan messages[]" });
    }

    const completion = await openai.chat.completions.create({
      model: String(model || "gpt-4.1-mini"),
      messages,
      temperature: typeof temperature === "number" ? temperature : 0.4,
    });

    const text = completion?.choices?.[0]?.message?.content?.trim() || "";
    if (!text) return res.status(500).json({ error: "OpenAI devolvió respuesta vacía" });

    res.json({ ok: true, text });
  } catch (e) {
    return sendOpenAIError(res, e, "/api/openai/chat");
  }
});

// ✅ 2) Transcripción (Whisper)
app.post("/api/openai/transcribe", upload.single("file"), async (req, res) => {
  try {
    const openai = requireOpenAI(res);
    if (!openai) return;

    if (!toFile) {
      return res.status(500).json({
        error: "openai/uploads (toFile) no disponible. Revisa versión del SDK.",
      });
    }

    const file = req.file;
    if (!file || !file.buffer) {
      return res.status(400).json({ error: "Falta archivo (field: file)" });
    }

    const model = String(req.body?.model || "whisper-1");
    const language = String(req.body?.language || "es");

    const filename = file.originalname || "audio.webm";
    const contentType = file.mimetype || "audio/webm";

    const audioFile = await toFile(file.buffer, filename, { type: contentType });

    const transcription = await openai.audio.transcriptions.create({
      file: audioFile,
      model,
      language,
    });

    const text = String(transcription?.text || "").trim();
    if (!text) return res.status(500).json({ error: "Transcripción vacía" });

    res.json({ ok: true, text });
  } catch (e) {
    return sendOpenAIError(res, e, "/api/openai/transcribe");
  }
});

// ===============================
// ✅ ENDPOINTS PARA CONFIG DE ENTREVISTA
// ===============================
// 🔒 RECOMENDADO: proteger creación de config (para que solo tú generes enlaces)
// Si prefieres mantenerlo público, quita requireAdmin aquí.
app.post("/api/save-interview-config", requireAdmin, async (req, res) => {
  try {
    const { interviewId, config, meta } = req.body || {};
    if (!interviewId || !config) {
      return res.status(400).json({ error: "Faltan interviewId o config" });
    }

    const cfg = config || {};
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

    res.json({ ok: true });
  } catch (e) {
    console.error("❌ save-interview-config:", e);
    res.status(500).json({ error: "Error guardando config" });
  }
});

app.get("/api/interview-config/:token", async (req, res) => {
  try {
    const token = String(req.params.token);

    const row = await get(
      `SELECT interviewId, configJson, metaJson, createdAt, updatedAt FROM interview_configs WHERE interviewId = ?`,
      [token]
    );

    if (!row) return res.status(404).json({ error: "Config no encontrada" });

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
// Group summary (OpenAI)
// - Público: cached (sin refresh)
// - 🔒 Admin: refresh=1
// ===============================
const GROUP_SYSTEM_PROMPT = `
Actúa como un consultor senior en investigación cualitativa y sociología aplicada
(CX, UX y Voice of the Customer), especializado en hostelería y restauración.

Contexto
Vas a recibir VARIOS INFORMES INDIVIDUALES ya elaborados,
correspondientes a entrevistas a clientes reales de un mismo restaurante o grupo.

Cada informe individual resume una experiencia concreta.
Tu tarea es analizarlos en conjunto para construir una visión global, estratégica y accionable.

Objetivo
Elabora UN ÚNICO INFORME GLOBAL, de nivel directivo,
que sintetice de forma clara y profesional todo lo aprendido a partir del conjunto de entrevistas.

Este informe servirá como base para una presentación ejecutiva
(dirigida a dirección, CX, operaciones o gerencia).

Principios clave
- Responde SIEMPRE en español.
- No inventes datos ni introduzcas información no presente en los informes individuales.
- Basa todas las conclusiones en patrones, recurrencias o contrastes observados.
- Diferencia claramente entre:
  • Hallazgos consistentes (repetidos)
  • Hallazgos puntuales pero relevantes
  • Ausencias significativas de información

Rol analítico
- Identifica patrones comunes en la experiencia del cliente.
- Detecta fricciones recurrentes, tensiones y contradicciones.
- Señala qué aspectos de la experiencia generan mayor impacto en la percepción global.
- Prioriza los insights según su relevancia para la mejora de la experiencia del cliente.
- Mantén una mirada crítica, profesional y orientada a la toma de decisiones.

Formato de salida (MUY IMPORTANTE)
Estructura el informe de forma clara, visual y fácilmente convertible en diapositivas:

1) Resumen ejecutivo global  
- 6–8 líneas máximo  
- Visión general de la experiencia del cliente en el restaurante  
- Nivel de satisfacción predominante  
- Principales palancas positivas y negativas detectadas  

2) Patrones clave de la experiencia  
- Bullet points desarrollados  
- Describe los temas que aparecen de forma recurrente en varias entrevistas  
- Incluye tanto patrones positivos como negativos  

3) Fricciones y puntos de dolor prioritarios  
- Bullet points  
- Solo fricciones mencionadas explícitamente en los informes  
- Prioriza las que se repiten o tienen mayor impacto en la experiencia  

4) Oportunidades de mejora y recomendaciones estratégicas  
- Bullet points  
- Derivadas directamente de los patrones y fricciones detectadas  
- Enfocadas a experiencia de cliente y operaciones (no marketing genérico)  

5) Señales cualitativas destacadas  
- Citas o ideas representativas extraídas de los informes individuales  
- Reformuladas si es necesario, pero fieles al contenido original  

Estilo
- Profesional, claro y estructurado
- Nivel consultora estratégica (tipo McKinsey / BCG)
- Lenguaje preciso, sin exageraciones ni juicios gratuitos
- Evita párrafos largos: prioriza bullets con contexto
- Usa emojis de forma moderada para facilitar lectura y jerarquía visual

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
// summaries individuales
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

// 🔒 DETALLE summary por token = ADMIN ONLY (si quieres que el candidato NO vea el texto)
app.get("/api/summary/:token", requireAdmin, async (req, res) => {
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

// 🔒 LISTADO de summaries = ADMIN ONLY
app.get("/api/summaries", requireAdmin, async (_req, res) => {
  try {
    const rows = await all(`SELECT * FROM summaries ORDER BY createdAt DESC LIMIT 500`);
    res.json(rows);
  } catch (e) {
    console.error("❌ list summaries:", e);
    res.status(500).json([]);
  }
});

// ===============================
// grupos
// ===============================
// 🔒 RECOMENDADO: proteger creación de grupos (si quieres que SOLO tú puedas crear grupos)
app.post("/api/save-group", requireAdmin, async (req, res) => {
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

// ✅ listado grupos (para admin normalmente) -> ADMIN ONLY
app.get("/api/groups", requireAdmin, async (_req, res) => {
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

app.get("/api/group-summary/:groupId", requireAdmin, async (req, res) => {
  try {
    const gid = String(req.params.groupId);
    const refresh = String(req.query.refresh || "") === "1";

    // 🔒 Si piden refresh=1, exigimos admin (evita abuso / coste OpenAI)
    if (refresh) {
      let denied = false;
      await new Promise((resolve) => {
        requireAdmin(req, res, () => resolve());
        // si requireAdmin respondió con 401/500, ya cortó la respuesta
        // aquí marcamos denied si headers ya enviados
        denied = res.headersSent;
        resolve();
      });
      if (denied) return;
    }

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

    const openai = requireOpenAI(res);
    if (!openai) return;

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
// ✅ Render-compatible listen
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
