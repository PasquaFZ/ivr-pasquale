const { upsertUserByPhone, touchCallActivity } = require("../users/repository");
const { putAudioItem } = require("../audio/repository");
const {
  startCallRecording,
  createOutboundCall,
  announceConference,
  countConferenceParticipants,
  redirectCall,
  endCall,
  fetchCallFrom,
} = require("../../infra/twilio");
const { downloadTwilioMp3, uploadCallAudio } = require("../../infra/storage");
const { publicBaseUrl } = require("../../config");
const { isOfficeOpen } = require("./officeHours");

const announcedConferences = new Set();
const outboundStarts = new Map();
const OUTBOUND_FAILURE_STATUSES = new Set(["busy", "failed", "no-answer", "canceled"]);

function callIsGone(err) {
  return err && (err.status === 404 || err.code === 20404 || err.code === 21220);
}

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

function outboundConferenceName(operatorCallSid) {
  return `outbound-${operatorCallSid}`;
}

async function createOutboundConference({ operatorCallSid, clientPhone, lang }) {
  const base = publicBaseUrl();
  const room = outboundConferenceName(operatorCallSid);
  const recordingQs = new URLSearchParams({
    client: clientPhone,
    direction: "outbound",
  });
  const answerQs = new URLSearchParams({
    room,
    client: clientPhone,
    lang,
    operator: operatorCallSid,
  });
  const statusQs = new URLSearchParams({
    lang,
    operator: operatorCallSid,
  });

  await startCallRecording(operatorCallSid, recordingQs.toString());
  const clientCall = await createOutboundCall({
    to: clientPhone,
    url: `${base}/voice/outbound/client?${answerQs}`,
    statusCallback: `${base}/voice/outbound/client-status?${statusQs}`,
    timeout: 40,
  });

  return {
    room,
    clientCallSid: clientCall.sid,
  };
}

async function startOutboundConference(args) {
  const existing = outboundStarts.get(args.operatorCallSid);
  if (existing) return existing;

  const start = createOutboundConference(args);
  outboundStarts.set(args.operatorCallSid, start);
  try {
    const result = await start;
    const timer = setTimeout(() => outboundStarts.delete(args.operatorCallSid), 10 * 60 * 1000);
    if (timer.unref) timer.unref();
    return result;
  } catch (err) {
    outboundStarts.delete(args.operatorCallSid);
    throw err;
  }
}

async function announceOutboundConference({ conferenceSid, lang }) {
  if (!conferenceSid || announcedConferences.has(conferenceSid)) return false;
  const participants = await countConferenceParticipants(conferenceSid);
  if (participants < 2) return false;

  announcedConferences.add(conferenceSid);
  try {
    const qs = new URLSearchParams({ lang });
    await announceConference(
      conferenceSid,
      `${publicBaseUrl()}/voice/outbound/conference-announcement?${qs}`,
    );
    return true;
  } catch (err) {
    announcedConferences.delete(conferenceSid);
    throw err;
  }
}

async function handleOutboundClientStatus({ status, operatorCallSid, lang }) {
  if (!OUTBOUND_FAILURE_STATUSES.has(status) || !operatorCallSid) return;
  const qs = new URLSearchParams({ lang });
  try {
    await redirectCall(
      operatorCallSid,
      `${publicBaseUrl()}/voice/outbound/no-answer?${qs}`,
    );
  } catch (err) {
    if (!callIsGone(err)) throw err;
  }
}

async function handleOutboundConferenceEvent({
  event,
  conferenceSid,
  participantCallSid,
  operatorCallSid,
  clientCallSid,
  lang,
}) {
  if (event === "participant-join") {
    await announceOutboundConference({ conferenceSid, lang });
    return;
  }

  if (event === "conference-end" || event === "participant-leave") {
    if (event === "conference-end") announcedConferences.delete(conferenceSid);
    if (
      event === "participant-leave" &&
      participantCallSid === operatorCallSid &&
      clientCallSid
    ) {
      try {
        await endCall(clientCallSid);
      } catch (err) {
        if (!callIsGone(err)) throw err;
      }
    }
    return;
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

module.exports = {
  registerIncoming,
  registerOutgoing,
  startOutboundConference,
  handleOutboundClientStatus,
  handleOutboundConferenceEvent,
  saveRecording,
};
