// Server/summaryRoutes.js
const express = require("express");
const router = express.Router();

// Memoria simple en el servidor (para pruebas)
const summaries = {}; // { [interviewId]: { summary, rawConversation } }

// Guardar resumen
router.post("/save-summary", (req, res) => {
  const { interviewId, summary, rawConversation } = req.body || {};

  if (!interviewId || !summary) {
    return res.status(400).json({ error: "Faltan datos para guardar el resumen." });
  }

  summaries[interviewId] = {
    summary,
    rawConversation: rawConversation || "",
    createdAt: new Date().toISOString(),
  };

  console.log("✅ Resumen guardado para", interviewId);
  res.json({ ok: true });
});

// Obtener resumen
router.get("/get-summary/:interviewId", (req, res) => {
  const { interviewId } = req.params;
  const data = summaries[interviewId];

  if (!data) {
    return res
      .status(404)
      .json({ error: "No se ha encontrado ningún resumen para esta entrevista." });
  }

  res.json(data);
});

module.exports = router;
