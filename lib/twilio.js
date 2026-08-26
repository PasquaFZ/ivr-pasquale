const twilio = require("twilio");
const { publicBaseUrl } = require("./config");

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

function startCallRecording(callSid) {
  const callback = `${publicBaseUrl()}/voice/recording-complete`;
  return client()
    .calls(callSid)
    .recordings.create({
      recordingChannels: "dual",
      recordingStatusCallback: callback,
      recordingStatusCallbackEvent: ["completed"],
    });
}

async function fetchCallFrom(callSid) {
  const call = await client().calls(callSid).fetch();
  return call.from;
}

module.exports = {
  client,
  requireTwilio,
  startCallRecording,
  fetchCallFrom,
};
