const express = require("express");
const { applyHttp } = require("./infra/http");
const { authConfigured } = require("./config");
const { requireAuth, requireAdmin } = require("./modules/auth/middleware");
const { seedAdmin } = require("./modules/auth/seed");
const voiceRoutes = require("./modules/voice/routes");
const authRoutes = require("./modules/auth/routes");
const { router: userRoutes, operatorRouter } = require("./modules/users/routes");
const audioRoutes = require("./modules/audio/routes");

function createApp() {
  const app = express();
  applyHttp(app);

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.use("/voice", voiceRoutes);
  app.use("/operator", operatorRouter);

  if (!authConfigured()) {
    console.warn("JWT secrets missing or too short — admin auth disabled");
  } else {
    const admin = express.Router();
    admin.use(requireAuth, requireAdmin);
    admin.use(userRoutes);
    admin.use(audioRoutes);
    app.use("/auth", authRoutes);
    app.use("/admin", admin);
    seedAdmin().catch((err) => console.error("seed admin", err));
  }

  return app;
}

module.exports = { createApp };
