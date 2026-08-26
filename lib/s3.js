const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const axios = require("axios");

const s3 = new S3Client({});

async function downloadTwilioMp3(recordingUrl) {
  const url = recordingUrl.endsWith(".mp3") ? recordingUrl : `${recordingUrl}.mp3`;
  const res = await axios.get(url, {
    auth: {
      username: process.env.TWILIO_ACCOUNT_SID,
      password: process.env.TWILIO_AUTH_TOKEN,
    },
    responseType: "arraybuffer",
  });
  return Buffer.from(res.data);
}

async function uploadCallAudio(userId, callSid, body) {
  const bucket = process.env.S3_BUCKET;
  const key = `clients/${userId}/audios/${callSid}.mp3`;
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: "audio/mpeg",
    }),
  );
  return key;
}

module.exports = { downloadTwilioMp3, uploadCallAudio };
