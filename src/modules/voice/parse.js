const { normalizePhone } = require("../../shared/validate");

function langFrom(req) {
  if (req.query.lang === "es") return "es";
  if (req.query.lang === "en") return "en";
  if (req.body.Digits === "2") return "es";
  return "en";
}

function outboundLangFrom(req) {
  if (req.query.lang === "es") return "es";
  if (req.query.lang === "en") return "en";
  if (req.body.Digits === "1") return "en";
  if (req.body.Digits === "2") return "es";
  return null;
}

function clientPhoneFromDigits(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 10) return normalizePhone(`+1${digits}`);
  if (digits.length === 11 && digits.startsWith("1")) return normalizePhone(`+${digits}`);
  return normalizePhone(`+${digits}`);
}

function callDirectionFrom(req) {
  if (req.query.direction === "outbound") return "outbound";
  if (req.query.direction === "inbound") return "inbound";
  return null;
}

function afterHoursFrom(req) {
  const raw = req.query.afterhours;
  if (raw === "1" || raw === "true") return true;
  if (raw === "0" || raw === "false") return false;
  return undefined;
}

function deptFrom(req) {
  const digit = req.body.Digits;
  if (digit === "0") return "admin";
  if (digit === "1") return "tech";
  if (digit === "2") return "operator";
  const q = req.query.dept;
  if (q === "admin" || q === "tech" || q === "operator") return q;
  return null;
}

module.exports = { langFrom, outboundLangFrom, clientPhoneFromDigits, callDirectionFrom, afterHoursFrom, deptFrom };
