const VoiceResponse = require("twilio").twiml.VoiceResponse;
const { publicBaseUrl, departmentPhone } = require("../../config");

const COMPANY = "Restoration A R";

const GREETING_EN = `Thank you for calling ${COMPANY}. For Spanish, press two. To continue in English, please remain on the line.`;

const NOTICE = {
  en: "Please note that this call will be recorded for quality assurance, security, and service improvement purposes. Remaining on the line constitutes your acknowledgment of this notice.",
  es: "Le informamos que esta llamada será grabada con fines de control de calidad, seguridad y mejora del servicio. Permanecer en la línea implica que ha tomado conocimiento de este aviso.",
};

const MENU = {
  en: "To reach our administrative department, press zero. For technical support, press one. To speak with an operator, press two.",
  es: "Para el departamento administrativo, mar que cero. Para soporte técnico, mar que uno. Para comunicarse con un operador, mar que dos.",
};

const BUSY = {
  en: `All of our representatives are currently unavailable. We will return your call as soon as possible. Thank you for contacting ${COMPANY}.`,
  es: `En este momento todos nuestros representantes se encuentran ocupados. Retornaremos su llamada a la mayor brevedad. Gracias por comunicarse con ${COMPANY}.`,
};

const DEPT_NAME = {
  admin: { en: "administrative department", es: "departamento de administración" },
  tech: { en: "technical support department", es: "departamento de soporte técnico" },
  operator: { en: "operator department", es: "departamento de operadores" },
};

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

function connectDepartment(lang, dept) {
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
  const whisperQs = new URLSearchParams({ lang, dept });
  dial.number({ url: `${base}/voice/whisper?${whisperQs}` }, to);
  return xml(twiml);
}

function operatorBusy(lang) {
  const twiml = new VoiceResponse();
  twiml.say({ language: voiceLang(lang) }, BUSY[lang] || BUSY.en);
  twiml.hangup();
  return xml(twiml);
}

function whisper(lang, dept) {
  const twiml = new VoiceResponse();
  const locale = voiceLang(lang);
  const name = (DEPT_NAME[dept] && DEPT_NAME[dept][lang]) || DEPT_NAME.operator[lang];
  if (lang === "es") {
    twiml.say({ language: locale }, `Llamada para el ${name}.`);
  } else {
    twiml.say({ language: locale }, `Call for the ${name}.`);
  }
  return xml(twiml);
}

function empty() {
  return "<Response/>";
}

const OUTBOUND_LANG_EN =
  "To speak with the client in English, press one. To speak in Spanish, press two.";
const OUTBOUND_LANG_ES =
  "Para comunicarse con el cliente en inglés, mar que uno. Para comunicarse en español, mar que dos.";

const ASK_NUMBER = {
  en: "Enter the client's phone number, then press pound.",
  es: "Mar que el número del cliente y luego numeral.",
};

const INVALID_NUMBER = {
  en: "That phone number is not valid.",
  es: "Ese número de teléfono no es válido.",
};

const NO_NUMBER = {
  en: "We did not receive a number.",
  es: "No se recibió ningún número.",
};

const OUTBOUND_HELLO = {
  en: `Hello. This call is from ${COMPANY}.`,
  es: `Hola. Esta llamada es de parte de ${COMPANY}.`,
};

function companyLanguageMenu() {
  const twiml = new VoiceResponse();
  const gather = twiml.gather({
    numDigits: 1,
    timeout: 6,
    action: `${publicBaseUrl()}/voice/outbound/language`,
    method: "POST",
  });
  gather.say({ language: "en-US" }, OUTBOUND_LANG_EN);
  gather.say({ language: "es-MX" }, OUTBOUND_LANG_ES);
  twiml.redirect({ method: "POST" }, `${publicBaseUrl()}/voice/outbound/language`);
  return xml(twiml);
}

function companyAskNumber(lang, opts = {}) {
  const twiml = new VoiceResponse();
  const locale = voiceLang(lang);
  const tries = Number(opts.tries) || 0;
  if (opts.missing) {
    twiml.say({ language: locale }, NO_NUMBER[lang] || NO_NUMBER.en);
  } else if (opts.invalid) {
    twiml.say({ language: locale }, INVALID_NUMBER[lang] || INVALID_NUMBER.en);
  }
  const action = `${publicBaseUrl()}/voice/outbound/connect?lang=${lang}&tries=${tries}`;
  const gather = twiml.gather({
    finishOnKey: "#",
    timeout: 12,
    action,
    method: "POST",
  });
  gather.say({ language: locale }, ASK_NUMBER[lang] || ASK_NUMBER.en);
  twiml.redirect({ method: "POST" }, action);
  return xml(twiml);
}

function noNumberHangup(lang) {
  const twiml = new VoiceResponse();
  twiml.say({ language: voiceLang(lang) }, NO_NUMBER[lang] || NO_NUMBER.en);
  twiml.hangup();
  return xml(twiml);
}

function clientOutboundNotice(lang) {
  const twiml = new VoiceResponse();
  const locale = voiceLang(lang);
  twiml.say({ language: locale }, OUTBOUND_HELLO[lang] || OUTBOUND_HELLO.en);
  twiml.say({ language: locale }, NOTICE[lang] || NOTICE.en);
  return xml(twiml);
}

function connectClient(lang, clientPhone) {
  const twiml = new VoiceResponse();
  const base = publicBaseUrl();
  const recQs = new URLSearchParams({ client: clientPhone, direction: "outbound" });
  const dial = twiml.dial({
    timeout: 25,
    answerOnBridge: true,
    record: "record-from-answer-dual",
    recordingStatusCallback: `${base}/voice/recording-complete?${recQs}`,
    recordingStatusCallbackEvent: ["completed"],
    action: `${base}/voice/dial-status?lang=${lang}`,
    method: "POST",
    callerId: process.env.TWILIO_PHONE_NUMBER,
  });
  const qs = new URLSearchParams({ lang });
  dial.number({ url: `${base}/voice/outbound/client?${qs}` }, clientPhone);
  return xml(twiml);
}

module.exports = {
  greeting,
  afterLanguage,
  departmentMenu,
  connectDepartment,
  operatorBusy,
  whisper,
  empty,
  companyLanguageMenu,
  companyAskNumber,
  noNumberHangup,
  clientOutboundNotice,
  connectClient,
};
