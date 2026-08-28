function publicBaseUrl() {
  return (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
}

function tableName() {
  return process.env.DDB_TABLE || "ivr-business";
}

function isProd() {
  return process.env.NODE_ENV === "production";
}

function adminOrigin() {
  return (process.env.ADMIN_ORIGIN || "http://localhost:5173").replace(/\/$/, "");
}

function accessSecret() {
  return process.env.JWT_ACCESS_SECRET || "";
}

function refreshSecret() {
  return process.env.JWT_REFRESH_SECRET || "";
}

function authConfigured() {
  return accessSecret().length >= 32 && refreshSecret().length >= 32;
}

function cloudFrontDomain() {
  return (process.env.CLOUDFRONT_DOMAIN || "")
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");
}

function cloudFrontKeyPairId() {
  return process.env.CLOUDFRONT_KEY_PAIR_ID || "";
}

function cloudFrontPrivateKey() {
  return (process.env.CLOUDFRONT_PRIVATE_KEY || "").replace(/\\n/g, "\n");
}

const DEPT_ENV = {
  admin: "ADMINISTRATIVE_PHONE",
  tech: "TECHNICAL_PHONE",
  operator: "OPERATOR_PHONE",
};

function departmentPhone(lang, dept) {
  const key = DEPT_ENV[dept];
  if (!key) return "";
  const prefix = lang === "es" ? "ES" : "EN";
  return (process.env[`${prefix}_${key}`] || "").trim();
}

function departmentPhones() {
  return ["es", "en"].flatMap((lang) =>
    Object.keys(DEPT_ENV).map((dept) => ({ lang, dept, phone: departmentPhone(lang, dept) })),
  );
}

const ACCESS_TTL = "1h";
const ACCESS_TTL_SEC = 60 * 60;
const REFRESH_TTL_SEC = 7 * 24 * 60 * 60;
const PAGE_SIZE = 50;
const AUDIO_URL_TTL_SEC = 300;
const REFRESH_COOKIE = "rt";

module.exports = {
  publicBaseUrl,
  tableName,
  isProd,
  adminOrigin,
  accessSecret,
  refreshSecret,
  authConfigured,
  cloudFrontDomain,
  cloudFrontKeyPairId,
  cloudFrontPrivateKey,
  departmentPhone,
  departmentPhones,
  ACCESS_TTL,
  ACCESS_TTL_SEC,
  REFRESH_TTL_SEC,
  PAGE_SIZE,
  AUDIO_URL_TTL_SEC,
  REFRESH_COOKIE,
};
