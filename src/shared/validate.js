const EMAIL_RE = /^[a-z0-9._%+\-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
const NAME_RE = /^[\p{L}\p{M} .'-]{1,80}$/u;
const USER_ID_RE = /^[A-Za-z0-9_-]{10,64}$/;
const CALL_SID_RE = /^[A-Za-z0-9]{10,64}$/;
const CURSOR_KEYS = ["PK", "SK", "GSI1PK", "GSI1SK", "GSI2PK", "GSI2SK"];

function normalizeEmail(raw) {
  return String(raw || "").trim().toLowerCase();
}

function isEmail(value) {
  return EMAIL_RE.test(value);
}

function isName(value) {
  return NAME_RE.test(value);
}

function isUserId(value) {
  return USER_ID_RE.test(String(value || ""));
}

function isCallSid(value) {
  return CALL_SID_RE.test(String(value || ""));
}

function normalizePhone(raw) {
  const p = String(raw || "").trim().replace(/[\s()-]/g, "");
  if (!p) return "";
  const withPlus = p.startsWith("+") ? p : `+${p}`;
  if (!/^\+[1-9]\d{7,14}$/.test(withPlus)) return null;
  return withPlus;
}

function looksLikePhone(raw) {
  const s = String(raw || "").trim();
  if (!s) return false;
  const digits = s.replace(/\D/g, "");
  return digits.length >= 8 && /^[\d+\s()-]+$/.test(s);
}

function classifySearch(raw) {
  const q = String(raw || "").trim();
  if (!q) return { type: "list", value: "" };
  if (q.includes("@")) return { type: "email", value: normalizeEmail(q) };
  if (looksLikePhone(q)) return { type: "phone", value: normalizePhone(q) };
  return { type: "name", value: q.toLowerCase() };
}

function encodeCursor(key) {
  if (!key) return null;
  return Buffer.from(JSON.stringify(key)).toString("base64url");
}

function decodeCursor(raw) {
  if (!raw) return undefined;
  let obj;
  try {
    obj = JSON.parse(Buffer.from(String(raw), "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  const out = {};
  for (const k of CURSOR_KEYS) {
    if (typeof obj[k] === "string" && obj[k].length < 512) out[k] = obj[k];
  }
  if (!out.PK && !out.GSI1PK && !out.GSI2PK) return null;
  return out;
}

function publicUser(item) {
  if (!item) return null;
  return {
    userId: item.UserId,
    firstName: item.FirstName || "",
    lastName: item.LastName || "",
    phone: item.Phone || "",
    email: item.Email || "",
    role: item.Role || "user",
    status: item.Status || "ACTIVE",
    createdAt: item.CreatedAt || "",
  };
}

function publicAudio(item) {
  return {
    audioId: item.CallSid || item.AudioId,
    callSid: item.CallSid || item.AudioId,
    durationSeconds: item.DurationSeconds || 0,
    uploadedAt: item.UploadedAt || "",
    mimeType: item.MimeType || "audio/mpeg",
  };
}

module.exports = {
  normalizeEmail,
  isEmail,
  isName,
  isUserId,
  isCallSid,
  normalizePhone,
  classifySearch,
  encodeCursor,
  decodeCursor,
  publicUser,
  publicAudio,
};
