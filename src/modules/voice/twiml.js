const VoiceResponse = require("twilio").twiml.VoiceResponse;
const { publicBaseUrl, departmentPhone } = require("../../config");

const GREETING_EN =
  "Thank you for calling Pasquale. For Spanish, press 2. To continue in English, please remain on the line.";

const NOTICE = {
  en: "Please note that this call will be recorded for quality assurance, security, and service improvement purposes. Remaining on the line constitutes your acknowledgment of this notice.",
  es: "Le informamos que esta llamada será grabada con fines de control de calidad, seguridad y mejora del servicio. Permanecer en la línea implica que ha tomado conocimiento de este aviso.",
};

const MENU = {
  en: "To reach our administrative department, press 0. For technical support, press 1. To speak with an operator, press 2.",
  es: "Para el departamento administrativo, marque 0. Para soporte técnico, marque 1. Para comunicarse con un operador, marque 2.",
};

const BUSY = {
  en: "All of our representatives are currently unavailable. We will return your call as soon as possible. Thank you for contacting Pasquale.",
  es: "En este momento todos nuestros representantes se encuentran ocupados. Retornaremos su llamada a la mayor brevedad. Gracias por comunicarse con Pasquale.",
};

const DEPT_NAME = {
  admin: { en: "administrative department", es: "departamento administrativo" },
  tech: { en: "technical support department", es: "departamento de soporte técnico" },
  operator: { en: "operator", es: "departamento de operadores" },
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

const DIGIT_EN = {
  0: "zero",
  1: "one",
  2: "two",
  3: "three",
  4: "four",
  5: "five",
  6: "six",
  7: "seven",
  8: "eight",
  9: "nine",
};

function spokenDigits(phone, lang) {
  const digits = String(phone || "").replace(/\D/g, "");
  const map = lang === "es" ? DIGIT_ES : DIGIT_EN;
  if (!digits) return lang === "es" ? "número no identificado" : "unidentified number";
  return [...digits].map((d) => map[d]).join(", ");
}

function voiceLang(lang) {
  return lang === "es" ? "es-MX" : "en-US";
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
  gather.say({ language: "en-US" }, GREETING_EN);
  twiml.redirect({ method: "POST" }, `${publicBaseUrl()}/voice/language`);
  return xml(twiml);
}

function afterLanguage(lang) {
  const twiml = new VoiceResponse();
  const locale = voiceLang(lang);
  twiml.say({ language: locale }, NOTICE[lang] || NOTICE.en);
  const gather = twiml.gather({
    numDigits: 1,
    timeout: 6,
    action: `${publicBaseUrl()}/voice/department?lang=${lang}`,
    method: "POST",
  });
  gather.say({ language: locale }, MENU[lang] || MENU.en);
  twiml.redirect({ method: "POST" }, `${publicBaseUrl()}/voice/department?lang=${lang}`);
  return xml(twiml);
}

function departmentMenu(lang) {
  const twiml = new VoiceResponse();
  const locale = voiceLang(lang);
  const gather = twiml.gather({
    numDigits: 1,
    timeout: 6,
    action: `${publicBaseUrl()}/voice/department?lang=${lang}`,
    method: "POST",
  });
  gather.say({ language: locale }, MENU[lang] || MENU.en);
  twiml.redirect({ method: "POST" }, `${publicBaseUrl()}/voice/department?lang=${lang}`);
  return xml(twiml);
}

function connectDepartment(lang, dept, from) {
  const to = departmentPhone(lang, dept);
  if (!to) return operatorBusy(lang);

  const twiml = new VoiceResponse();
  const base = publicBaseUrl();
  const dial = twiml.dial({
    timeout: 25,
    action: `${base}/voice/dial-status?lang=${lang}`,
    method: "POST",
    callerId: process.env.TWILIO_PHONE_NUMBER,
  });
  const phone = from ? String(from).replace(/^\+/, "") : "";
  const whisperQs = new URLSearchParams({ lang, dept });
  if (phone) whisperQs.set("phone", phone);
  dial.number({ url: `${base}/voice/whisper?${whisperQs}` }, to);
  return xml(twiml);
}

function operatorBusy(lang) {
  const twiml = new VoiceResponse();
  twiml.say({ language: voiceLang(lang) }, BUSY[lang] || BUSY.en);
  twiml.hangup();
  return xml(twiml);
}

function whisper(lang, dept, phone) {
  const twiml = new VoiceResponse();
  const locale = voiceLang(lang);
  const name = (DEPT_NAME[dept] && DEPT_NAME[dept][lang]) || DEPT_NAME.operator[lang];
  const digits = spokenDigits(phone, lang);
  if (lang === "es") {
    twiml.say(
      { language: locale },
      `Llamada entrante para el ${name}. Número de origen: ${digits}.`,
    );
  } else {
    twiml.say(
      { language: locale },
      `Incoming call for the ${name}. Originating number: ${digits}.`,
    );
  }
  return xml(twiml);
}

function empty() {
  return "<Response/>";
}

module.exports = {
  greeting,
  afterLanguage,
  departmentMenu,
  connectDepartment,
  operatorBusy,
  whisper,
  empty,
};
