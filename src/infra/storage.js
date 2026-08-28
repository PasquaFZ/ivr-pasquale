const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/cloudfront-signer");
const axios = require("axios");
const {
  AUDIO_URL_TTL_SEC,
  cloudFrontDomain,
  cloudFrontKeyPairId,
  cloudFrontPrivateKey,
} = require("../config");

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

function audioUrl({ key }) {
  const domain = cloudFrontDomain();
  const keyPairId = cloudFrontKeyPairId();
  const privateKey = cloudFrontPrivateKey();
  if (!domain || !keyPairId || !privateKey) {
    const err = new Error("CloudFront is not configured");
    err.code = "CLOUDFRONT_NOT_CONFIGURED";
    throw err;
  }

  const encodedKey = String(key)
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  const url = getSignedUrl({
    url: `https://${domain}/${encodedKey}`,
    keyPairId,
    privateKey,
    dateLessThan: new Date(Date.now() + AUDIO_URL_TTL_SEC * 1000),
  });
  return { url, expiresIn: AUDIO_URL_TTL_SEC };
}

module.exports = { downloadTwilioMp3, uploadCallAudio, audioUrl };
