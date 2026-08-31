const { upsertUserByPhone, touchCallActivity } = require("../users/repository");
const { putAudioItem } = require("../audio/repository");
const { startCallRecording, fetchCallFrom } = require("../../infra/twilio");
const { downloadTwilioMp3, uploadCallAudio } = require("../../infra/storage");
const { isOfficeOpen } = require("./officeHours");

async function registerIncoming(from, callSid, { recordCall = true } = {}) {
  const open = isOfficeOpen();
  try {
    const userId = await upsertUserByPhone(from);
    console.log("user", userId);
    if (userId) {
      await touchCallActivity(userId, { direction: "inbound", afterHours: !open });
    }
  } catch (err) {
    console.error("upsert user", err);
  }

  if (recordCall) {
    const qs = open ? "direction=inbound&afterhours=0" : "direction=inbound&afterhours=1";
    startCallRecording(callSid, qs).catch((err) => {
      console.error("start recording", err);
    });
  }
}

async function registerOutgoing(clientPhone) {
  try {
    const userId = await upsertUserByPhone(clientPhone);
    console.log("outbound user", userId);
  } catch (err) {
    console.error("upsert outbound user", err);
  }
}

async function saveRecording({ callSid, recordingUrl, status, duration, clientPhone, direction, afterHours }) {
  if (!recordingUrl || status === "absent") return { skipped: true };

  const phone = clientPhone || (await fetchCallFrom(callSid));
  if (!phone) {
    const err = new Error("no user for phone");
    err.code = "NO_USER";
    throw err;
  }
  const userId = await upsertUserByPhone(phone);
  if (!userId) {
    const err = new Error("no user for phone");
    err.code = "NO_USER";
    throw err;
  }

  if (!direction) {
    const err = new Error("invalid audio direction");
    err.code = "INVALID_DIRECTION";
    throw err;
  }

  const mp3 = await downloadTwilioMp3(recordingUrl);
  const s3Key = await uploadCallAudio(userId, callSid, mp3, direction);
  await putAudioItem({
    userId,
    callSid,
    durationSeconds: duration,
    s3Key,
    direction,
    afterHours: direction === "inbound" ? afterHours : undefined,
  });
  await touchCallActivity(userId, {
    direction,
    afterHours: direction === "inbound" ? afterHours : undefined,
  });
  return { s3Key };
}

module.exports = { registerIncoming, registerOutgoing, saveRecording };
