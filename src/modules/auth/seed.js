const { hashPassword } = require("./tokens");
const { findUserByEmail, createAdminUser } = require("../users/repository");
const { normalizeEmail, isEmail } = require("../../shared/validate");

async function seedAdmin() {
  const email = normalizeEmail(process.env.ADMIN_EMAIL);
  const password = process.env.ADMIN_PASSWORD || "";

  if (!email || !password) {
    console.warn("ADMIN_EMAIL / ADMIN_PASSWORD missing — admin not seeded");
    return;
  }
  if (!isEmail(email)) {
    console.warn("ADMIN_EMAIL is invalid — admin not seeded");
    return;
  }
  if (password.length < 12) {
    console.warn("ADMIN_PASSWORD must be at least 12 characters — admin not seeded");
    return;
  }

  const existing = await findUserByEmail(email);
  if (existing) {
    console.log("admin user already exists");
    return;
  }

  const passwordHash = await hashPassword(password);
  await createAdminUser({ email, passwordHash });
  console.log("admin user seeded");
}

module.exports = { seedAdmin };
