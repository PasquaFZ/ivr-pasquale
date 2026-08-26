const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  QueryCommand,
  TransactWriteCommand,
  PutCommand,
  UpdateCommand,
} = require("@aws-sdk/lib-dynamodb");
const { ulid } = require("ulid");
const { tableName } = require("./config");

const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

async function findUserByPhone(phone) {
  const out = await doc.send(
    new QueryCommand({
      TableName: tableName(),
      IndexName: "GSI1",
      KeyConditionExpression: "GSI1PK = :pk",
      ExpressionAttributeValues: { ":pk": `PHONE#${phone}` },
      Limit: 1,
    }),
  );
  const item = out.Items && out.Items[0];
  if (!item || !item.GSI1SK) return null;
  return item.GSI1SK.replace(/^USER#/, "");
}

async function upsertUserByPhone(phone) {
  const existing = await findUserByPhone(phone);
  if (existing) return existing;

  const userId = ulid();
  const now = new Date().toISOString();

  await doc.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: tableName(),
            Item: {
              PK: `USER#${userId}`,
              SK: "METADATA",
              UserId: userId,
              Phone: phone,
              Status: "ACTIVE",
              CreatedAt: now,
            },
            ConditionExpression: "attribute_not_exists(PK)",
          },
        },
        {
          Put: {
            TableName: tableName(),
            Item: {
              PK: `USER#${userId}`,
              SK: `INDEX#PHONE#${phone}`,
              GSI1PK: `PHONE#${phone}`,
              GSI1SK: `USER#${userId}`,
            },
            ConditionExpression: "attribute_not_exists(PK)",
          },
        },
      ],
    }),
  );

  return userId;
}

async function putAudioItem({ userId, callSid, durationSeconds, s3Key }) {
  const now = new Date().toISOString();
  await doc.send(
    new PutCommand({
      TableName: tableName(),
      Item: {
        PK: `USER#${userId}`,
        SK: `AUDIO#${now}#${callSid}`,
        AudioId: callSid,
        CallSid: callSid,
        DurationSeconds: durationSeconds,
        S3Bucket: process.env.S3_BUCKET,
        S3Key: s3Key,
        MimeType: "audio/mpeg",
        UploadedAt: now,
      },
    }),
  );
}

async function updateUserName(phone, firstName, lastName) {
  const userId = await findUserByPhone(phone);
  if (!userId) return null;

  const first = firstName.trim();
  const last = lastName.trim();
  const gsi2sk = `${last.toLowerCase()}#${first.toLowerCase()}`;

  await doc.send(
    new UpdateCommand({
      TableName: tableName(),
      Key: { PK: `USER#${userId}`, SK: "METADATA" },
      UpdateExpression:
        "SET FirstName = :f, LastName = :l, GSI2PK = :gpk, GSI2SK = :gsk",
      ExpressionAttributeValues: {
        ":f": first,
        ":l": last,
        ":gpk": "ENTITY#USER",
        ":gsk": gsi2sk,
      },
    }),
  );

  return userId;
}

module.exports = {
  findUserByPhone,
  upsertUserByPhone,
  putAudioItem,
  updateUserName,
};
