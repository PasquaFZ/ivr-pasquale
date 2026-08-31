const express = require("express");
const {
  listUsers,
  getUserById,
  findUserByEmail,
  findUserByPhone,
  updateUserProfile,
  updateUserName,
  createUser,
  clearUnreadInbound,
} = require("./repository");
const { hashPassword } = require("../auth/tokens");
const {
  classifySearch,
  isEmail,
  isName,
  isUserId,
  normalizeEmail,
  normalizePhone,
  decodeCursor,
  encodeCursor,
  parseRole,
  parseStatus,
  publicUser,
  personFromPublic,
  snapshotFromPublic,
} = require("../../shared/validate");
const { requirePermission } = require("../auth/middleware");
const { writeRequestAudit } = require("../logs/audit");
const { PERMISSIONS, ALL, sanitizePermissions, permissionsForRole, isPanelRole } = require("../auth/permissions");
const { revokeAllSessions } = require("../auth/sessions");

const router = express.Router();

function badCursor(res) {
  return res.status(400).json({ error: "Cursor inválido" });
}

router.post("/users", requirePermission(PERMISSIONS.USERS_CREATE), async (req, res) => {
  const body = req.body || {};
  const firstName = String(body.firstName || "").trim();
  const lastName = String(body.lastName || "").trim();
  let role = parseRole(body.role) || "user";
  if (req.auth.role !== "admin") role = "user";
  const email = normalizeEmail(body.email);
  const password = String(body.password || "");
  const rawPhone = String(body.phone || "").trim();
  const panel = isPanelRole(role);

  if (!isName(firstName)) return res.status(400).json({ error: "Nombre inválido" });
  if (!isName(lastName)) return res.status(400).json({ error: "Apellido inválido" });

  let phone = "";
  if (rawPhone) {
    phone = normalizePhone(rawPhone);
    if (!phone) return res.status(400).json({ error: "Teléfono inválido" });
  }

  if (panel) {
    if (!email || !isEmail(email)) return res.status(400).json({ error: "La cuenta de panel necesita un email" });
    if (password.length < 12 || password.length > 200) {
      return res.status(400).json({ error: "La contraseña debe tener al menos 12 caracteres" });
    }
  } else if (email && !isEmail(email)) {
    return res.status(400).json({ error: "Email inválido" });
  }

  if (!email && !phone) {
    return res.status(400).json({ error: "Indica un email o un teléfono" });
  }

  const requested = sanitizePermissions(body.permissions);
  let permissions = [];
  if (role === "admin") {
    permissions = requested && requested.length ? requested : ALL;
  } else if (role === "operator") {
    permissions = requested && requested.length ? requested : permissionsForRole("operator");
  }

  try {
    if (email && (await findUserByEmail(email))) {
      return res.status(409).json({ error: "Ese email ya existe" });
    }
    if (phone && (await findUserByPhone(phone))) {
      return res.status(409).json({ error: "Ese teléfono ya existe" });
    }

    const passwordHash = panel ? await hashPassword(password) : undefined;
    const out = await createUser({
      firstName,
      lastName,
      email: email || undefined,
      phone: phone || undefined,
      passwordHash,
      role,
      permissions,
    });
    if (out.error === "conflict") return res.status(409).json({ error: "Conflicto al guardar" });
    const created = publicUser(out.user);
    const snap = snapshotFromPublic(created);
    const extras = passwordHash ? [{ field: "password", from: null, to: "(definida)" }] : [];
    const changes = Object.keys(snap)
      .filter((field) => field !== "permissions" || (snap.permissions && snap.permissions.length))
      .map((field) => ({ field, from: null, to: snap[field] }))
      .concat(extras);
    await writeRequestAudit(req, {
      action: "CREATE",
      resource: "user",
      target: personFromPublic(created),
      changes,
    });
    res.status(201).json(created);
  } catch (err) {
    console.error("create user", err);
    res.status(500).json({ error: "Error al crear el usuario" });
  }
});

router.get("/users", requirePermission(PERMISSIONS.USERS_LIST), async (req, res) => {
  const cursor = decodeCursor(req.query.cursor);
  if (cursor === null) return badCursor(res);

  const search = classifySearch(req.query.q);

  try {
    if (search.type === "email") {
      if (!isEmail(search.value)) return res.json({ items: [], nextCursor: null });
      const userId = await findUserByEmail(search.value);
      const user = userId ? await getUserById(userId) : null;
      return res.json({ items: user ? [publicUser(user)] : [], nextCursor: null });
    }

    if (search.type === "phone") {
      if (!search.value) return res.json({ items: [], nextCursor: null });
      const userId = await findUserByPhone(search.value);
      const user = userId ? await getUserById(userId) : null;
      return res.json({ items: user ? [publicUser(user)] : [], nextCursor: null });
    }

    let namePrefix;
    if (search.type === "name") {
      const parts = search.value.split(/\s+/).filter(Boolean);
      namePrefix = parts.length >= 2 ? `${parts[parts.length - 1]}#${parts[0]}` : parts[0];
    }

    const out = await listUsers({ cursor, namePrefix });
    res.json({
      items: out.items.map(publicUser),
      nextCursor: encodeCursor(out.lastKey),
    });
  } catch (err) {
    console.error("list users", err);
    res.status(500).json({ error: "Error al listar usuarios" });
  }
});

router.get("/users/:userId", requirePermission(PERMISSIONS.USERS_READ), async (req, res) => {
  if (!isUserId(req.params.userId)) return res.status(404).json({ error: "No encontrado" });
  try {
    const user = await getUserById(req.params.userId);
    if (!user) return res.status(404).json({ error: "No encontrado" });
    res.json(publicUser(user));
  } catch (err) {
    console.error("get user", err);
    res.status(500).json({ error: "Error al cargar el usuario" });
  }
});

router.post("/users/:userId/seen", requirePermission(PERMISSIONS.USERS_READ), async (req, res) => {
  if (!isUserId(req.params.userId)) return res.status(404).json({ error: "No encontrado" });
  try {
    const user = await getUserById(req.params.userId);
    if (!user) return res.status(404).json({ error: "No encontrado" });
    if (user.UnreadInbound) {
      await clearUnreadInbound(req.params.userId);
      user.UnreadInbound = false;
    }
    res.json(publicUser(user));
  } catch (err) {
    console.error("mark user seen", err);
    res.status(500).json({ error: "Error al actualizar el usuario" });
  }
});

router.patch("/users/:userId", requirePermission(PERMISSIONS.USERS_UPDATE), async (req, res) => {
  if (!isUserId(req.params.userId)) return res.status(404).json({ error: "No encontrado" });

  const body = req.body || {};
  const patch = {};
  const actorAdmin = req.auth.role === "admin";
  const isSelf = req.auth.sub === req.params.userId;

  if (body.firstName !== undefined) {
    const firstName = String(body.firstName).trim();
    if (firstName) {
      if (!isName(firstName)) return res.status(400).json({ error: "Nombre inválido" });
      patch.firstName = firstName;
    }
  }
  if (body.lastName !== undefined) {
    const lastName = String(body.lastName).trim();
    if (lastName) {
      if (!isName(lastName)) return res.status(400).json({ error: "Apellido inválido" });
      patch.lastName = lastName;
    }
  }
  if (body.phone !== undefined && actorAdmin) {
    const raw = String(body.phone).trim();
    if (raw) {
      const phone = normalizePhone(raw);
      if (!phone) return res.status(400).json({ error: "Teléfono inválido" });
      patch.phone = phone;
    }
  }
  if (body.email !== undefined) {
    const email = String(body.email).trim() === "" ? "" : String(body.email).trim().toLowerCase();
    if (email && !isEmail(email)) return res.status(400).json({ error: "Email inválido" });
    patch.email = email;
  }
  if (body.role !== undefined) {
    if (!actorAdmin) {
      return res.status(403).json({ error: "Solo un administrador puede cambiar el rol" });
    }
    const role = parseRole(body.role);
    if (!role) return res.status(400).json({ error: "Rol inválido" });
    if (isSelf && role !== req.auth.role) {
      return res.status(400).json({ error: "No puedes cambiar tu propio rol" });
    }
    patch.role = role;
  }
  if (body.permissions !== undefined) {
    if (!actorAdmin) {
      return res.status(403).json({ error: "Solo un administrador puede cambiar los permisos" });
    }
    if (!Array.isArray(body.permissions)) {
      return res.status(400).json({ error: "Permisos inválidos" });
    }
    patch.permissions = sanitizePermissions(body.permissions) || [];
  }
  if (body.status !== undefined) {
    if (!actorAdmin) {
      return res.status(403).json({ error: "Solo un administrador puede cambiar el estado" });
    }
    const status = parseStatus(body.status);
    if (!status) return res.status(400).json({ error: "Estado inválido" });
    if (isSelf && status === "INACTIVE") {
      return res.status(400).json({ error: "No puedes desactivar tu propia cuenta" });
    }
    patch.status = status;
  }
  if (body.password) {
    if (!actorAdmin) {
      return res.status(403).json({ error: "Solo un administrador puede cambiar la contraseña" });
    }
    const password = String(body.password);
    if (password.length < 12 || password.length > 200) {
      return res.status(400).json({ error: "La contraseña debe tener al menos 12 caracteres" });
    }
    patch.passwordHash = await hashPassword(password);
  }

  if (patch.role === "user") {
    patch.permissions = [];
  }

  if (!Object.keys(patch).length) {
    return res.status(400).json({ error: "Nada para actualizar" });
  }

  try {
    const out = await updateUserProfile(req.params.userId, patch);
    if (out.error === "not_found") return res.status(404).json({ error: "No encontrado" });
    if (out.error === "phone_taken") return res.status(409).json({ error: "Ese teléfono ya existe" });
    if (out.error === "email_taken") return res.status(409).json({ error: "Ese email ya existe" });
    if (out.error === "panel_email_required" || out.error === "admin_email_required") {
      return res.status(400).json({ error: "La cuenta de panel necesita un email" });
    }
    if (out.error === "panel_password_required") {
      return res.status(400).json({ error: "La cuenta de panel necesita una contraseña" });
    }
    if (out.error === "conflict") return res.status(409).json({ error: "Conflicto al guardar" });
    if (out.revokeSessions) {
      await revokeAllSessions(req.params.userId);
    }
    const updated = publicUser(out.user);
    if (out.changes && out.changes.length) {
      await writeRequestAudit(req, {
        action: "UPDATE",
        resource: "user",
        target: personFromPublic(updated),
        changes: out.changes,
      });
    }
    res.json(updated);
  } catch (err) {
    console.error("update user", err);
    res.status(500).json({ error: "Error al guardar" });
  }
});

const operatorRouter = express.Router();

operatorRouter.post("/name", async (req, res) => {
  const pin = process.env.OPERATOR_PIN;
  if (pin && req.body.pin !== pin) {
    return res.status(403).json({ error: "PIN incorrecto" });
  }

  const phone = (req.body.phone || "").trim();
  const firstName = req.body.firstName || "";
  const lastName = req.body.lastName || "";
  if (!phone || !firstName || !lastName) {
    return res.status(400).json({ error: "Falta teléfono, nombre o apellido" });
  }

  try {
    const userId = await updateUserName(phone, firstName, lastName);
    if (!userId) return res.status(404).json({ error: "No hay usuario con ese teléfono" });
    res.json({ ok: true, userId, firstName, lastName });
  } catch (err) {
    console.error("update name", err);
    res.status(500).json({ error: "Error al guardar" });
  }
});

module.exports = { router, operatorRouter };
