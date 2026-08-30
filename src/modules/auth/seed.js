const { hashPassword } = require("./tokens");
const { findUserByEmail, createAdminUser, applyAdminSeedProfile } = require("../users/repository");
const { normalizeEmail, isEmail } = require("../../shared/validate");
const { ALL } = require("./permissions");

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
    await applyAdminSeedProfile(existing, {
      firstName: "admin",
      lastName: "business",
      permissions: ALL,
    });
    console.log("admin user already exists — profile synced");
    return;
  }

  const passwordHash = await hashPassword(password);
  const out = await createAdminUser({
    email,
    passwordHash,
    firstName: "admin",
    lastName: "business",
    permissions: ALL,
  });
  if (out.error) {
    console.error("admin seed failed", out.error);
    return;
  }
  console.log("admin user seeded");
}

module.exports = { seedAdmin };
