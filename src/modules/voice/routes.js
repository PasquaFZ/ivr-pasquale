const express = require("express");
const { requireTwilio } = require("../../infra/twilio");
const { isCompanyCaller, isOwnedNumber, isInternalPhone } = require("../../config");
const twiml = require("./twiml");
const { langFrom, outboundLangFrom, clientPhoneFromDigits, callDirectionFrom, afterHoursFrom, deptFrom } = require("./parse");
const {
  registerIncoming,
  registerOutgoing,
  startOutboundConference,
  handleOutboundClientStatus,
  handleOutboundConferenceEvent,
  saveRecording,
} = require("./service");
const { isOfficeOpen } = require("./officeHours");

const router = express.Router();
const CALL_SID_RE = /^CA[a-f0-9]{32}$/i;
const CONFERENCE_SID_RE = /^CF[a-f0-9]{32}$/i;
const ROOM_RE = /^outbound-CA[a-f0-9]{32}$/i;

function xml(res, body) {
  res.type("text/xml").send(body);
}

async function connectOutboundClient(req, res, lang, clientPhone) {
  const operatorCallSid = String(req.body.CallSid || "");
  if (!CALL_SID_RE.test(operatorCallSid)) {
    console.error("outbound missing operator CallSid");
    xml(res, twiml.outboundFailed(lang));
    return;
  }

  await registerOutgoing(clientPhone);
  try {
    const { room, clientCallSid } = await startOutboundConference({
      operatorCallSid,
      clientPhone,
      lang,
    });
    xml(
      res,
      twiml.joinOperatorConference({
        room,
        clientPhone,
        lang,
        operatorCallSid,
        clientCallSid,
      }),
    );
  } catch (err) {
    console.error("start outbound conference", err);
    xml(res, twiml.outboundFailed(lang));
  }
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

  await registerIncoming(from, callSid, { recordCall: isOfficeOpen() });
  xml(res, twiml.greeting());
});

router.post("/language", requireTwilio, (req, res) => {
  const lang = langFrom(req);
  if (!isOfficeOpen()) {
    xml(res, twiml.afterHoursRecord(lang));
    return;
  }
  xml(res, twiml.afterLanguage(lang));
});

router.post("/afterhours/thanks", requireTwilio, (req, res) => {
  xml(res, twiml.afterHoursThanks(langFrom(req)));
});

router.post("/department", requireTwilio, (req, res) => {
  const lang = langFrom(req);
  if (!isOfficeOpen()) {
    xml(res, twiml.afterHoursRecord(lang));
    return;
  }
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
      await connectOutboundClient(req, res, lang, phone);
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

  await connectOutboundClient(req, res, lang, phone);
});

router.post("/outbound/client", requireTwilio, (req, res) => {
  const room = String(req.query.room || "");
  const operatorCallSid = String(req.query.operator || "");
  const clientCallSid = String(req.body.CallSid || "");
  const clientPhone = clientPhoneFromDigits(req.query.client);
  const lang = langFrom(req);

  // Compatibilidad con un <Dial><Number> emitido antes de este despliegue.
  if (!ROOM_RE.test(room) || !CALL_SID_RE.test(operatorCallSid) || !CALL_SID_RE.test(clientCallSid) || !clientPhone) {
    xml(res, twiml.clientOutboundNotice(lang));
    return;
  }

  xml(
    res,
    twiml.joinClientConference({
      room,
      clientPhone,
      lang,
      operatorCallSid,
      clientCallSid,
    }),
  );
});

router.post("/outbound/conference-wait", requireTwilio, (req, res) => {
  xml(res, twiml.outboundConferenceWait(langFrom(req)));
});

router.post("/outbound/conference-announcement", requireTwilio, (req, res) => {
  xml(res, twiml.clientOutboundNotice(langFrom(req)));
});

router.post("/outbound/no-answer", requireTwilio, (req, res) => {
  xml(res, twiml.clientNoAnswer(langFrom(req)));
});

router.post("/outbound/client-status", requireTwilio, async (req, res) => {
  const status = String(req.body.CallStatus || "");
  const operatorCallSid = String(req.query.operator || "");
  console.log("outbound client status", { status, clientCallSid: req.body.CallSid, operatorCallSid });

  try {
    await handleOutboundClientStatus({
      status,
      operatorCallSid: CALL_SID_RE.test(operatorCallSid) ? operatorCallSid : "",
      lang: langFrom(req),
    });
    res.sendStatus(200);
  } catch (err) {
    console.error("outbound client status", err);
    res.sendStatus(500);
  }
});

router.post("/outbound/conference-status", requireTwilio, async (req, res) => {
  const event = String(req.body.StatusCallbackEvent || "");
  const conferenceSid = String(req.body.ConferenceSid || "");
  const participantCallSid = String(req.body.CallSid || "");
  const operatorCallSid = String(req.query.operator || "");
  const clientCallSid = String(req.query.clientCall || "");
  console.log("outbound conference status", { event, conferenceSid, participantCallSid });

  if (!CONFERENCE_SID_RE.test(conferenceSid)) {
    res.sendStatus(400);
    return;
  }

  try {
    await handleOutboundConferenceEvent({
      event,
      conferenceSid,
      participantCallSid,
      operatorCallSid: CALL_SID_RE.test(operatorCallSid) ? operatorCallSid : "",
      clientCallSid: CALL_SID_RE.test(clientCallSid) ? clientCallSid : "",
      lang: langFrom(req),
    });
    res.sendStatus(200);
  } catch (err) {
    console.error("outbound conference status", err);
    res.sendStatus(500);
  }
});

router.post("/dial-status", requireTwilio, (req, res) => {
  const status = req.body.DialCallStatus;
  console.log("dial-status", status);
  if (status === "completed") {
    xml(res, twiml.empty());
    return;
  }
  if (req.query.leg === "client") {
    xml(res, twiml.clientNoAnswer(langFrom(req)));
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
  const afterHours = afterHoursFrom(req);
  console.log("recording-complete", { callSid, duration, clientPhone, direction, afterHours });

  try {
    const out = await saveRecording({
      callSid,
      recordingUrl,
      status: req.body.RecordingStatus,
      duration,
      clientPhone,
      direction,
      afterHours,
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
