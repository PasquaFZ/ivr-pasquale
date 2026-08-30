const express = require("express");
const { login, refresh, logout, me, REFRESH_COOKIE } = require("./service");
const { requireAdminOrigin, requireAuth, requireAdmin } = require("./middleware");
const { loginLimiter } = require("./rate-limit");
const { normalizeEmail, isEmail, personFromPublic, clientIp } = require("../../shared/validate");
const { writeAudit } = require("../logs/audit");

const router = express.Router();

router.post("/login", requireAdminOrigin, loginLimiter, async (req, res) => {
  const email = normalizeEmail(req.body && req.body.email);
  const password = String((req.body && req.body.password) || "");

  if (!isEmail(email) || password.length < 8 || password.length > 200) {
    return res.status(401).json({ error: "Credenciales inválidas" });
  }

  try {
    const out = await login(email, password, res);
    if (out.error) return res.status(401).json({ error: "Credenciales inválidas" });
    await writeAudit({
      action: "LOGIN",
      resource: "session",
      actor: personFromPublic(out.user),
      target: personFromPublic(out.user),
      ip: clientIp(req),
    });
    res.json(out);
  } catch (err) {
    console.error("login", err);
    res.status(500).json({ error: "Error al iniciar sesión" });
  }
});

router.post("/refresh", requireAdminOrigin, async (req, res) => {
  try {
    const out = await refresh(req.cookies && req.cookies[REFRESH_COOKIE], res);
    if (out.error) return res.status(401).json({ error: "No autorizado" });
    res.json(out);
  } catch (err) {
    console.error("refresh", err);
    res.status(500).json({ error: "Error al renovar sesión" });
  }
});

router.get("/me", requireAuth, requireAdmin, async (req, res) => {
  try {
    const out = await me(req.auth.sub);
    if (out.error) return res.status(401).json({ error: "No autorizado" });
    res.json(out);
  } catch (err) {
    console.error("me", err);
    res.status(500).json({ error: "Error al cargar la sesión" });
  }
});

router.post("/logout", requireAdminOrigin, async (req, res) => {
  const out = await logout(req.cookies && req.cookies[REFRESH_COOKIE], res);
  if (out && out.user) {
    const person = personFromPublic(out.user);
    await writeAudit({
      action: "LOGOUT",
      resource: "session",
      actor: person,
      target: person,
      ip: clientIp(req),
    });
  }
  res.status(204).end();
});

module.exports = router;
