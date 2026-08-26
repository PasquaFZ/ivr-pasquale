const fs = require("fs");
const path = require("path");

const envFile = path.join(__dirname, ".env");
if (fs.existsSync(envFile)) {
  require("dotenv").config({ path: envFile, quiet: true });
}

const express = require("express");
const twiml = require("./lib/twiml");
const { requireTwilio, startCallRecording, fetchCallFrom } = require("./lib/twilio");
const {
  upsertUserByPhone,
  findUserByPhone,
  putAudioItem,
  updateUserName,
} = require("./lib/dynamodb");
const { downloadTwilioMp3, uploadCallAudio } = require("./lib/s3");

const app = express();
app.set("trust proxy", 1);
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

function xml(res, body) {
  res.type("text/xml").send(body);
}

function langFrom(req) {
  if (req.body.Digits === "2" || req.query.lang === "es") return "es";
  return "en";
}

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/voice/incoming", requireTwilio, async (req, res) => {
  const from = req.body.From;
  const callSid = req.body.CallSid;
  console.log("incoming", { from, callSid, forwardedFrom: req.body.ForwardedFrom });

  try {
    const userId = await upsertUserByPhone(from);
    console.log("user", userId);
  } catch (err) {
    console.error("upsert user", err);
  }

  startCallRecording(callSid).catch((err) => {
    console.error("start recording", err);
  });

  xml(res, twiml.greeting());
});

app.post("/voice/language", requireTwilio, (req, res) => {
  xml(res, twiml.connectOperator(langFrom(req), req.body.From));
});

app.post("/voice/whisper", requireTwilio, (req, res) => {
  const digits = req.query.phone;
  const phone = digits ? `+${digits}` : req.body.From;
  xml(res, twiml.whisper(phone));
});

app.post("/voice/dial-status", requireTwilio, (req, res) => {
  const status = req.body.DialCallStatus;
  console.log("dial-status", status);
  if (status === "completed") {
    xml(res, twiml.empty());
    return;
  }
  xml(res, twiml.operatorBusy(langFrom(req)));
});

app.post("/voice/recording-complete", requireTwilio, async (req, res) => {
  const callSid = req.body.CallSid;
  const recordingUrl = req.body.RecordingUrl;
  const duration = Number(req.body.RecordingDuration || 0);
  console.log("recording-complete", { callSid, duration });

  try {
    if (!recordingUrl || req.body.RecordingStatus === "absent") {
      return res.sendStatus(200);
    }

    const phone = await fetchCallFrom(callSid);
    const userId = await findUserByPhone(phone);
    if (!userId) {
      console.error("no user for phone", phone);
      return res.sendStatus(500);
    }

    const mp3 = await downloadTwilioMp3(recordingUrl);
    const s3Key = await uploadCallAudio(userId, callSid, mp3);
    await putAudioItem({
      userId,
      callSid,
      durationSeconds: duration,
      s3Key,
    });
    console.log("saved audio", s3Key);
    res.sendStatus(200);
  } catch (err) {
    console.error("recording-complete", err);
    res.sendStatus(500);
  }
});

app.post("/voice/status", requireTwilio, (req, res) => {
  console.log("call status", req.body.CallStatus, req.body.CallSid);
  res.sendStatus(200);
});

app.post("/operator/name", async (req, res) => {
  const pin = process.env.OPERATOR_PIN;
  if (pin && req.body.pin !== pin) {
    return res.status(403).json({ error: "PIN incorrecto" });
  }

  const phone = (req.body.phone || "").trim();
  const firstName = req.body.firstName || "";
  const lastName = req.body.lastName || "";
  if (!phone || !firstName || !lastName) {
    return res.status(400).json({ error: "Falta teléfono, nombre o apellido" });
  }

  try {
    const userId = await updateUserName(phone, firstName, lastName);
    if (!userId) return res.status(404).json({ error: "No hay usuario con ese teléfono" });
    res.json({ ok: true, userId, firstName, lastName });
  } catch (err) {
    console.error("update name", err);
    res.status(500).json({ error: "Error al guardar" });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`listening on ${port}`);
  const operator = process.env.OPERATOR_PHONE || "";
  console.log("operator", operator ? `…${operator.slice(-4)}` : "missing");
  if (!operator) console.warn("OPERATOR_PHONE is empty");
  if (!process.env.PUBLIC_BASE_URL) console.warn("PUBLIC_BASE_URL is empty");
  const company = process.env.COMPANY_PHONE;
  if (company && process.env.OPERATOR_PHONE && process.env.OPERATOR_PHONE === company) {
    console.warn("OPERATOR_PHONE is the company cell — that will loop the IVR");
  }
});
