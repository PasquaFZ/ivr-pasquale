const VoiceResponse = require("twilio").twiml.VoiceResponse;
const { publicBaseUrl } = require("./config");

const NOTICE = {
  en: "Thank you for calling Pasquale. To ensure the quality of our service and for security reasons, this call may be recorded or monitored. If you wish to review our privacy policy, please visit our website. Please stay on the line.",
  es: "Gracias por llamar a Pasquale. Para garantizar la calidad de nuestro servicio y por motivos de seguridad, esta llamada puede ser grabada o monitoreada. Si desea consultar nuestra política de privacidad, visite nuestro sitio web. Por favor, permanezca en la línea.",
};

const DIGIT_ES = {
  0: "cero",
  1: "uno",
  2: "dos",
  3: "tres",
  4: "cuatro",
  5: "cinco",
  6: "seis",
  7: "siete",
  8: "ocho",
  9: "nueve",
};

function spokenDigitsEs(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "número desconocido";
  return [...digits].map((d) => DIGIT_ES[d]).join(", ");
}

function xml(twiml) {
  return twiml.toString();
}

function greeting() {
  const twiml = new VoiceResponse();
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
  twiml.say(
    { language: "es-MX" },
    `Llamada entrante del ${spokenDigitsEs(phone)}.`,
  );
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
