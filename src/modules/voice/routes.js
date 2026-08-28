const express = require("express");
const { requireTwilio } = require("../../infra/twilio");
const twiml = require("./twiml");
const { langFrom, deptFrom } = require("./parse");
const { registerIncoming, saveRecording } = require("./service");

const router = express.Router();

function xml(res, body) {
  res.type("text/xml").send(body);
}

router.post("/incoming", requireTwilio, async (req, res) => {
  const from = req.body.From;
  const callSid = req.body.CallSid;
  console.log("incoming", { from, callSid, forwardedFrom: req.body.ForwardedFrom });
  await registerIncoming(from, callSid);
  xml(res, twiml.greeting());
});

router.post("/language", requireTwilio, (req, res) => {
  xml(res, twiml.afterLanguage(langFrom(req)));
});

router.post("/department", requireTwilio, (req, res) => {
  const lang = langFrom(req);
  const dept = deptFrom(req);
  if (!dept) {
    xml(res, twiml.departmentMenu(lang));
    return;
  }
  xml(res, twiml.connectDepartment(lang, dept, req.body.From));
});

router.post("/whisper", requireTwilio, (req, res) => {
  const digits = req.query.phone;
  const phone = digits ? `+${digits}` : req.body.From;
  xml(res, twiml.whisper(langFrom(req), deptFrom(req) || "operator", phone));
});

router.post("/dial-status", requireTwilio, (req, res) => {
  const status = req.body.DialCallStatus;
  console.log("dial-status", status);
  if (status === "completed") {
    xml(res, twiml.empty());
    return;
  }
  xml(res, twiml.operatorBusy(langFrom(req)));
});

router.post("/recording-complete", requireTwilio, async (req, res) => {
  const callSid = req.body.CallSid;
  const recordingUrl = req.body.RecordingUrl;
  const duration = Number(req.body.RecordingDuration || 0);
  console.log("recording-complete", { callSid, duration });

  try {
    const out = await saveRecording({
      callSid,
      recordingUrl,
      status: req.body.RecordingStatus,
      duration,
    });
    if (out.s3Key) console.log("saved audio", out.s3Key);
    res.sendStatus(200);
  } catch (err) {
    if (err.code === "NO_USER") {
      console.error("no user for phone");
      return res.sendStatus(500);
    }
    console.error("recording-complete", err);
    res.sendStatus(500);
  }
});

router.post("/status", requireTwilio, (req, res) => {
  console.log("call status", req.body.CallStatus, req.body.CallSid);
  res.sendStatus(200);
});

module.exports = router;
