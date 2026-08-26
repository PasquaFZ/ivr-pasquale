const VoiceResponse = require("twilio").twiml.VoiceResponse;
const { publicBaseUrl } = require("./config");

const NOTICE = {
  en: "This call may be recorded to help us improve our service and keep an accurate record of your request.",
  es: "Esta llamada puede ser grabada para mejorar nuestro servicio y conservar un registro de su solicitud.",
};

function xml(twiml) {
  return twiml.toString();
}

function greeting() {
  const twiml = new VoiceResponse();
  twiml.say({ language: "en-US" }, "Pasquale. Good day.");
  const gather = twiml.gather({
    numDigits: 1,
    timeout: 4,
    action: `${publicBaseUrl()}/voice/language`,
    method: "POST",
  });
  gather.say({ language: "en-US" }, "For Spanish, press 2.");
  twiml.redirect({ method: "POST" }, `${publicBaseUrl()}/voice/language`);
  return xml(twiml);
}

function connectOperator(lang, from) {
  const twiml = new VoiceResponse();
  const voiceLang = lang === "es" ? "es-MX" : "en-US";
  twiml.say({ language: voiceLang }, NOTICE[lang] || NOTICE.en);

  const base = publicBaseUrl();
  const dial = twiml.dial({
    timeout: 25,
    action: `${base}/voice/dial-status?lang=${lang}`,
    method: "POST",
    callerId: process.env.TWILIO_PHONE_NUMBER,
  });
  const whisperQs = from
    ? `?phone=${encodeURIComponent(String(from).replace(/^\+/, ""))}`
    : "";
  dial.number({ url: `${base}/voice/whisper${whisperQs}` }, process.env.OPERATOR_PHONE);
  return xml(twiml);
}

function operatorBusy(lang) {
  const twiml = new VoiceResponse();
  if (lang === "es") {
    twiml.say(
      { language: "es-MX" },
      "En este momento no hay quien atienda. Le devolveremos la llamada. Gracias.",
    );
  } else {
    twiml.say(
      { language: "en-US" },
      "No one is available right now. We will call you back. Thank you.",
    );
  }
  twiml.hangup();
  return xml(twiml);
}

function whisper(phone) {
  const twiml = new VoiceResponse();
  twiml.say({ language: "en-US" }, `Incoming call from ${phone || "unknown number"}.`);
  return xml(twiml);
}

function empty() {
  return "<Response/>";
}

module.exports = {
  greeting,
  connectOperator,
  operatorBusy,
  whisper,
  empty,
};
