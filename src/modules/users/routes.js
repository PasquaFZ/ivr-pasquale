const express = require("express");
const {
  listUsers,
  getUserById,
  findUserByEmail,
  findUserByPhone,
  updateUserProfile,
  updateUserName,
} = require("./repository");
const {
  classifySearch,
  isEmail,
  isName,
  isUserId,
  normalizePhone,
  decodeCursor,
  encodeCursor,
  publicUser,
} = require("../../shared/validate");

const router = express.Router();

function badCursor(res) {
  return res.status(400).json({ error: "Cursor inválido" });
}

router.get("/users", async (req, res) => {
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

router.get("/users/:userId", async (req, res) => {
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

router.patch("/users/:userId", async (req, res) => {
  if (!isUserId(req.params.userId)) return res.status(404).json({ error: "No encontrado" });

  const body = req.body || {};
  const patch = {};

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
  if (body.phone !== undefined) {
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

  if (!Object.keys(patch).length) {
    return res.status(400).json({ error: "Nada para actualizar" });
  }

  try {
    const out = await updateUserProfile(req.params.userId, patch);
    if (out.error === "not_found") return res.status(404).json({ error: "No encontrado" });
    if (out.error === "phone_taken") return res.status(409).json({ error: "Ese teléfono ya existe" });
    if (out.error === "email_taken") return res.status(409).json({ error: "Ese email ya existe" });
    if (out.error === "admin_email_required") {
      return res.status(400).json({ error: "El admin necesita un email" });
    }
    if (out.error === "conflict") return res.status(409).json({ error: "Conflicto al guardar" });
    res.json(publicUser(out.user));
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
