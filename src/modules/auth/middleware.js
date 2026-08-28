const { adminOrigin, isProd } = require("../../config");
const { bearerToken, verifyAccessToken } = require("./tokens");

function requireAdminOrigin(req, res, next) {
  const origin = req.get("origin");
  if (origin && origin.replace(/\/$/, "") !== adminOrigin()) {
    return res.status(403).json({ error: "Origen no permitido" });
  }
  if (isProd() && !origin) {
    return res.status(403).json({ error: "Origen no permitido" });
  }
  next();
}

function requireAuth(req, res, next) {
  const token = bearerToken(req);
  if (!token) return res.status(401).json({ error: "No autorizado" });
  try {
    req.auth = verifyAccessToken(token);
    next();
  } catch {
    return res.status(401).json({ error: "No autorizado" });
  }
}

function requireAdmin(req, res, next) {
  if (!req.auth || req.auth.role !== "admin") {
    return res.status(403).json({ error: "Sin permisos" });
  }
  next();
}

module.exports = { requireAdminOrigin, requireAuth, requireAdmin };
