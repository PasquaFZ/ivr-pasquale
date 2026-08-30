const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const {
  accessSecret,
  refreshSecret,
  ACCESS_TTL,
  REFRESH_TTL_SEC,
  REFRESH_COOKIE,
  isProd,
} = require("../../config");

const BCRYPT_ROUNDS = 12;
const DUMMY_HASH = bcrypt.hashSync("__timing-guard__", BCRYPT_ROUNDS);

function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function hashesEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

async function verifyPassword(password, passwordHash) {
  if (!passwordHash) {
    await bcrypt.compare(password, DUMMY_HASH);
    return false;
  }
  return bcrypt.compare(password, passwordHash);
}

function signAccessToken(user, permissions) {
  return jwt.sign(
    {
      sub: user.UserId,
      role: user.Role,
      typ: "access",
      permissions: Array.isArray(permissions) ? permissions : [],
    },
    accessSecret(),
    { algorithm: "HS256", expiresIn: ACCESS_TTL },
  );
}

function signRefreshToken(userId, jti) {
  return jwt.sign(
    { sub: userId, jti, typ: "refresh" },
    refreshSecret(),
    { algorithm: "HS256", expiresIn: REFRESH_TTL_SEC },
  );
}

function verifyAccessToken(token) {
  const payload = jwt.verify(token, accessSecret(), { algorithms: ["HS256"] });
  if (payload.typ !== "access" || !payload.sub) {
    throw new Error("invalid token");
  }
  return payload;
}

function verifyRefreshToken(token) {
  const payload = jwt.verify(token, refreshSecret(), { algorithms: ["HS256"] });
  if (payload.typ !== "refresh" || !payload.sub || !payload.jti) {
    throw new Error("invalid token");
  }
  return payload;
}

function newJti() {
  return crypto.randomUUID();
}

function refreshCookieOptions() {
  const prod = isProd();
  return {
    httpOnly: true,
    secure: prod,
    sameSite: prod ? "none" : "lax",
    path: "/auth",
    maxAge: REFRESH_TTL_SEC * 1000,
  };
}

function setRefreshCookie(res, token) {
  res.cookie(REFRESH_COOKIE, token, refreshCookieOptions());
}

function clearRefreshCookie(res) {
  res.clearCookie(REFRESH_COOKIE, {
    httpOnly: true,
    secure: isProd(),
    sameSite: isProd() ? "none" : "lax",
    path: "/auth",
  });
}

function bearerToken(req) {
  const header = req.get("authorization") || "";
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) return null;
  return token;
}

module.exports = {
  hashPassword,
  hashToken,
  hashesEqual,
  verifyPassword,
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  newJti,
  setRefreshCookie,
  clearRefreshCookie,
  bearerToken,
};
