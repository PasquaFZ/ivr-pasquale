const express = require("express");
const { getUserById } = require("../users/repository");
const { listAudios, findAudio } = require("./repository");
const { audioUrl } = require("../../infra/storage");
const {
  isUserId,
  isCallSid,
  decodeCursor,
  encodeCursor,
  publicAudio,
  publicUser,
  personFromPublic,
} = require("../../shared/validate");
const { requirePermission } = require("../auth/middleware");
const { PERMISSIONS } = require("../auth/permissions");
const { writeRequestAudit } = require("../logs/audit");

const router = express.Router();

function badCursor(res) {
  return res.status(400).json({ error: "Cursor inválido" });
}

router.get("/users/:userId/audios", requirePermission(PERMISSIONS.USERS_READ), async (req, res) => {
  if (!isUserId(req.params.userId)) return res.status(404).json({ error: "No encontrado" });
  const cursor = decodeCursor(req.query.cursor);
  if (cursor === null) return badCursor(res);

  try {
    const user = await getUserById(req.params.userId);
    if (!user) return res.status(404).json({ error: "No encontrado" });
    const out = await listAudios(req.params.userId, cursor);
    res.json({
      items: out.items.map(publicAudio),
      nextCursor: encodeCursor(out.lastKey),
    });
  } catch (err) {
    console.error("list audios", err);
    res.status(500).json({ error: "Error al listar audios" });
  }
});

function requireAudioUrl(req, res, next) {
  const intent = req.query.intent === "download" ? PERMISSIONS.AUDIOS_DOWNLOAD : PERMISSIONS.AUDIOS_PLAY;
  return requirePermission(intent)(req, res, next);
}

router.get("/users/:userId/audios/:callSid/url", requireAudioUrl, async (req, res) => {
  if (!isUserId(req.params.userId) || !isCallSid(req.params.callSid)) {
    return res.status(404).json({ error: "No encontrado" });
  }

  try {
    const audio = await findAudio(req.params.userId, req.params.callSid);
    if (!audio || !audio.S3Key) return res.status(404).json({ error: "No encontrado" });
    const intent = req.query.intent === "download" ? "download" : "play";
    const targetUser = publicUser(await getUserById(req.params.userId));
    await writeRequestAudit(req, {
      action: intent === "download" ? "DOWNLOAD" : "PLAY",
      resource: "audio",
      target: personFromPublic(targetUser),
      callSid: req.params.callSid,
      changes: [{ field: "callSid", from: null, to: req.params.callSid }],
    });
    res.json(audioUrl({ key: audio.S3Key }));
  } catch (err) {
    if (err.code === "CLOUDFRONT_NOT_CONFIGURED") {
      return res.status(503).json({ error: "CloudFront no está configurado" });
    }
    console.error("audio url", err);
    res.status(500).json({ error: "Error al firmar el audio" });
  }
});

module.exports = router;
