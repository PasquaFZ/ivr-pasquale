const hits = new Map();

function prune(now) {
  if (hits.size < 500) return;
  for (const [key, row] of hits) {
    if (row.reset < now) hits.delete(key);
  }
}

function tooMany(key, limit, windowMs) {
  const now = Date.now();
  prune(now);
  const row = hits.get(key);
  if (!row || row.reset < now) {
    hits.set(key, { n: 1, reset: now + windowMs });
    return { blocked: false, retryAfter: 0 };
  }
  row.n += 1;
  const retryAfter = Math.ceil((row.reset - now) / 1000);
  return { blocked: row.n > limit, retryAfter };
}

function clientIp(req) {
  const xf = req.get("x-forwarded-for");
  if (xf) return xf.split(",")[0].trim();
  return req.ip || "unknown";
}

function loginLimiter(req, res, next) {
  const ip = clientIp(req);
  const email = String((req.body && req.body.email) || "").trim().toLowerCase();
  const byEmail = tooMany(`login:${ip}:${email}`, 8, 15 * 60 * 1000);
  const byIp = tooMany(`login-ip:${ip}`, 30, 15 * 60 * 1000);
  if (byEmail.blocked || byIp.blocked) {
    const retryAfter = Math.max(byEmail.retryAfter, byIp.retryAfter);
    res.set("Retry-After", String(retryAfter));
    return res.status(429).json({ error: "Demasiados intentos. Prueba más tarde." });
  }
  next();
}

module.exports = { loginLimiter };
