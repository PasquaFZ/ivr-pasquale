const helmet = require("helmet");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const express = require("express");
const { adminOrigin } = require("../config");

function applyHttp(app) {
  app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
  app.use(cookieParser());
  app.use(express.json({ limit: "32kb" }));
  app.use(express.urlencoded({ extended: false, limit: "32kb" }));
  app.use(
    cors({
      origin(origin, cb) {
        if (!origin) return cb(null, true);
        if (origin.replace(/\/$/, "") === adminOrigin()) return cb(null, true);
        cb(null, false);
      },
      credentials: true,
      methods: ["GET", "POST", "PATCH", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
      maxAge: 600,
    }),
  );
}

module.exports = { applyHttp };
