const { getUserById } = require("../users/repository");
const { putLog } = require("./repository");
const { publicUser, personFromPublic, clientIp } = require("../../shared/validate");

async function actorFromRequest(req) {
  if (!req || !req.auth || !req.auth.sub) return { userId: "", name: "", email: "", role: "", phone: "" };
  const user = publicUser(await getUserById(req.auth.sub));
  const person = personFromPublic(user);
  if (!person.role) person.role = req.auth.role || "";
  if (!person.userId) person.userId = req.auth.sub;
  return person;
}

async function writeAudit(entry) {
  try {
    await putLog(entry);
  } catch (err) {
    console.error("audit log", err);
  }
}

async function writeRequestAudit(req, entry) {
  const actor = entry.actor || (await actorFromRequest(req));
  await writeAudit({
    ...entry,
    actor,
    ip: entry.ip !== undefined ? entry.ip : clientIp(req),
  });
}

module.exports = { actorFromRequest, writeAudit, writeRequestAudit };
