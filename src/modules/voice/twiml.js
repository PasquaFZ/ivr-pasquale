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

module.exports = {
  greeting,
  afterLanguage,
  departmentMenu,
  connectDepartment,
  operatorBusy,
  whisper,
  empty,
};
