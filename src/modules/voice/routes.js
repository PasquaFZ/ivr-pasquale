const express = require("express");
const { requireTwilio } = require("../../infra/twilio");
const { isCompanyCaller, isOwnedNumber, isInternalPhone } = require("../../config");
const twiml = require("./twiml");
const { langFrom, outboundLangFrom, clientPhoneFromDigits, callDirectionFrom, deptFrom } = require("./parse");
const { registerIncoming, registerOutgoing, saveRecording } = require("./service");

const router = express.Router();

function xml(res, body) {
  res.type("text/xml").send(body);
}

router.post("/incoming", requireTwilio, async (req, res) => {
  const from = req.body.From;
  const to = req.body.To;
  const callSid = req.body.CallSid;
  console.log("incoming", { from, to, callSid, forwardedFrom: req.body.ForwardedFrom });

  if (isCompanyCaller(from)) {
    console.log("outbound from company", { from, to, callSid });
    xml(res, twiml.companyLanguageMenu());
    return;
  }

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
  xml(res, twiml.connectDepartment(lang, dept));
});

router.post("/whisper", requireTwilio, (req, res) => {
  xml(res, twiml.whisper(langFrom(req), deptFrom(req) || "operator"));
});

router.post("/outbound/language", requireTwilio, async (req, res) => {
  const lang = outboundLangFrom(req);
  if (!lang) {
    xml(res, twiml.companyLanguageMenu());
    return;
  }

  const to = req.body.To;
  if (to && !isOwnedNumber(to) && !isCompanyCaller(to)) {
    const phone = clientPhoneFromDigits(to);
    if (phone && !isInternalPhone(phone)) {
      await registerOutgoing(phone);
      xml(res, twiml.connectClient(lang, phone));
      return;
    }
  }

  xml(res, twiml.companyAskNumber(lang));
});

router.post("/outbound/connect", requireTwilio, async (req, res) => {
  const lang = outboundLangFrom(req) || "en";
  const tries = Number(req.query.tries) || 0;
  const digits = String(req.body.Digits || "").replace(/\D/g, "");
  const phone = clientPhoneFromDigits(req.body.Digits);

  if (!digits) {
    if (tries + 1 >= 2) {
      xml(res, twiml.noNumberHangup(lang));
      return;
    }
    xml(res, twiml.companyAskNumber(lang, { missing: true, tries: tries + 1 }));
    return;
  }

  if (!phone || isInternalPhone(phone)) {
    xml(res, twiml.companyAskNumber(lang, { invalid: true, tries }));
    return;
  }

  await registerOutgoing(phone);
  xml(res, twiml.connectClient(lang, phone));
});

router.post("/outbound/client", requireTwilio, (req, res) => {
  xml(res, twiml.clientOutboundNotice(langFrom(req)));
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
  const clientPhone = clientPhoneFromDigits(req.query.client);
  const direction = callDirectionFrom(req);
  console.log("recording-complete", { callSid, duration, clientPhone, direction });

  try {
    const out = await saveRecording({
      callSid,
      recordingUrl,
      status: req.body.RecordingStatus,
      duration,
      clientPhone,
      direction,
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
