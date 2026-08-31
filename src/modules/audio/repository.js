const { QueryCommand, PutCommand } = require("@aws-sdk/lib-dynamodb");
const { doc } = require("../../infra/db");
const { tableName, PAGE_SIZE } = require("../../config");

async function putAudioItem({ userId, callSid, durationSeconds, s3Key, direction, afterHours }) {
  const now = new Date().toISOString();
  const item = {
    PK: `USER#${userId}`,
    SK: `AUDIO#${now}#${callSid}`,
    AudioId: callSid,
    CallSid: callSid,
    DurationSeconds: durationSeconds,
    Direction: direction,
    S3Bucket: process.env.S3_BUCKET,
    S3Key: s3Key,
    MimeType: "audio/mpeg",
    UploadedAt: now,
  };
  if (afterHours === true) item.AfterHours = true;
  if (afterHours === false) item.AfterHours = false;
  await doc.send(
    new PutCommand({
      TableName: tableName(),
      Item: item,
    }),
  );
}

async function listAudios(userId, cursor) {
  const out = await doc.send(
    new QueryCommand({
      TableName: tableName(),
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      ExpressionAttributeValues: {
        ":pk": `USER#${userId}`,
        ":sk": "AUDIO#",
      },
      ProjectionExpression: "CallSid, AudioId, DurationSeconds, Direction, UploadedAt, MimeType, S3Bucket, S3Key, AfterHours",
      Limit: PAGE_SIZE,
      ScanIndexForward: false,
      ExclusiveStartKey: cursor,
    }),
  );
  return {
    items: out.Items || [],
    lastKey: out.LastEvaluatedKey || null,
  };
}

async function findAudio(userId, callSid) {
  let startKey;
  do {
    const out = await doc.send(
      new QueryCommand({
        TableName: tableName(),
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
        FilterExpression: "CallSid = :c OR AudioId = :c",
        ExpressionAttributeValues: {
          ":pk": `USER#${userId}`,
          ":sk": "AUDIO#",
          ":c": callSid,
        },
        ExclusiveStartKey: startKey,
      }),
    );
    if (out.Items && out.Items[0]) return out.Items[0];
    startKey = out.LastEvaluatedKey;
  } while (startKey);
  return null;
}

module.exports = { putAudioItem, listAudios, findAudio };
