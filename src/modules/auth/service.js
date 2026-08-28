const { ACCESS_TTL_SEC, REFRESH_COOKIE } = require("../../config");
const { findUserByEmail, getUserAuthById } = require("../users/repository");
const { putSession, getSession, revokeSession } = require("./sessions");
const {
  verifyPassword,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  hashToken,
  hashesEqual,
  newJti,
  setRefreshCookie,
  clearRefreshCookie,
} = require("./tokens");
const { publicUser } = require("../../shared/validate");

function canLogin(user) {
  return user && user.Role === "admin" && user.Status === "ACTIVE" && user.PasswordHash;
}

async function startSession(res, user) {
  const jti = newJti();
  const refresh = signRefreshToken(user.UserId, jti);
  const accessToken = signAccessToken(user);
  await putSession(user.UserId, jti, hashToken(refresh));
  setRefreshCookie(res, refresh);
  return {
    accessToken,
    expiresIn: ACCESS_TTL_SEC,
    user: publicUser(user),
  };
}

async function login(email, password, res) {
  const userId = await findUserByEmail(email);
  const user = userId ? await getUserAuthById(userId) : null;
  const ok = await verifyPassword(password, user && user.PasswordHash);
  if (!ok || !canLogin(user)) return { error: "unauthorized" };
  return startSession(res, user);
}

async function refresh(token, res) {
  if (!token) return { error: "unauthorized" };
  let payload;
  try {
    payload = verifyRefreshToken(token);
  } catch (err) {
    clearRefreshCookie(res);
    if (err.name === "JsonWebTokenError" || err.name === "TokenExpiredError") {
      return { error: "unauthorized" };
    }
    throw err;
  }

  const session = await getSession(payload.sub, payload.jti);
  const now = Math.floor(Date.now() / 1000);
  if (!session || !hashesEqual(session.TokenHash, hashToken(token)) || session.ExpiresAt < now) {
    clearRefreshCookie(res);
    return { error: "unauthorized" };
  }

  const user = await getUserAuthById(payload.sub);
  if (!canLogin(user)) {
    await revokeSession(payload.sub, payload.jti);
    clearRefreshCookie(res);
    return { error: "unauthorized" };
  }

  await revokeSession(payload.sub, payload.jti);
  return startSession(res, user);
}

async function logout(token, res) {
  clearRefreshCookie(res);
  if (!token) return;
  try {
    const payload = verifyRefreshToken(token);
    await revokeSession(payload.sub, payload.jti);
  } catch {
    // cookie already invalid
  }
}

async function me(userId) {
  const user = await getUserAuthById(userId);
  if (!canLogin(user)) return { error: "unauthorized" };
  return { user: publicUser(user) };
}

module.exports = { login, refresh, logout, me, REFRESH_COOKIE };
