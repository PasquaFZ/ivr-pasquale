const express = require("express");
const { listLogs, publicLog } = require("./repository");
const { decodeCursor, encodeCursor } = require("../../shared/validate");
const { requireOwnerAdmin } = require("../auth/middleware");

const router = express.Router();

router.get("/logs", requireOwnerAdmin, async (req, res) => {
  const cursor = decodeCursor(req.query.cursor);
  if (cursor === null) return res.status(400).json({ error: "Cursor inválido" });

  try {
    const out = await listLogs({ cursor });
    res.json({
      items: out.items.map(publicLog),
      nextCursor: encodeCursor(out.lastKey),
    });
  } catch (err) {
    console.error("list logs", err);
    res.status(500).json({ error: "No se pudieron cargar los logs" });
  }
});

module.exports = router;
