const twilio = require("twilio");
const { publicBaseUrl } = require("../config");

function client() {
  return twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
}

function requireTwilio(req, res, next) {
  const token = process.env.TWILIO_AUTH_TOKEN;
  const base = publicBaseUrl();
  if (!token || !base) {
    console.error("Missing TWILIO_AUTH_TOKEN or PUBLIC_BASE_URL");
    return res.status(500).type("text/xml").send("<Response/>");
  }

  const signature = req.get("X-Twilio-Signature") || "";
  const url = `${base}${req.originalUrl}`;
  const ok = twilio.validateRequest(token, signature, url, req.body);
  if (!ok) {
    console.error("Invalid Twilio signature", url);
    return res.status(403).send("Forbidden");
  }
  next();
}

function startCallRecording(callSid, extraQuery) {
  const qs = extraQuery ? `?${extraQuery}` : "";
  const callback = `${publicBaseUrl()}/voice/recording-complete${qs}`;
  return client()
    .calls(callSid)
    .recordings.create({
      recordingChannels: "dual",
      recordingStatusCallback: callback,
      recordingStatusCallbackEvent: ["completed"],
    });
}

function createOutboundCall({ to, url, statusCallback, timeout = 40 }) {
  return client().calls.create({
    to,
    from: process.env.TWILIO_PHONE_NUMBER,
    url,
    method: "POST",
    timeout,
    statusCallback,
    statusCallbackMethod: "POST",
    statusCallbackEvent: ["completed", "busy", "failed", "no-answer", "canceled"],
  });
}

function announceConference(conferenceSid, announceUrl) {
  return client().conferences(conferenceSid).update({
    announceUrl,
    announceMethod: "POST",
  });
}

async function countConferenceParticipants(conferenceSid) {
  const participants = await client()
    .conferences(conferenceSid)
    .participants.list({ status: "connected", limit: 3 });
  return participants.length;
}

function redirectCall(callSid, url) {
  return client().calls(callSid).update({
    url,
    method: "POST",
  });
}

async function endCall(callSid) {
  const call = await client().calls(callSid).fetch();
  if (call.status === "queued" || call.status === "ringing") {
    return client().calls(callSid).update({ status: "canceled" });
  }
  if (call.status === "in-progress") {
    return client().calls(callSid).update({ status: "completed" });
  }
  return call;
}

async function fetchCallFrom(callSid) {
  const call = await client().calls(callSid).fetch();
  return call.from;
}

module.exports = {
  client,
  requireTwilio,
  startCallRecording,
  createOutboundCall,
  announceConference,
  countConferenceParticipants,
  redirectCall,
  endCall,
  fetchCallFrom,
};
