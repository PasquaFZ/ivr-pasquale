const { PutCommand, GetCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");
const { doc } = require("../../infra/db");
const { tableName, REFRESH_TTL_SEC } = require("../../config");

async function putSession(userId, jti, tokenHash) {
  const now = new Date().toISOString();
  const expiresAt = Math.floor(Date.now() / 1000) + REFRESH_TTL_SEC;
  await doc.send(
    new PutCommand({
      TableName: tableName(),
      Item: {
        PK: `USER#${userId}`,
        SK: `SESSION#${jti}`,
        TokenHash: tokenHash,
        ExpiresAt: expiresAt,
        CreatedAt: now,
      },
    }),
  );
}

async function getSession(userId, jti) {
  const out = await doc.send(
    new GetCommand({
      TableName: tableName(),
      Key: { PK: `USER#${userId}`, SK: `SESSION#${jti}` },
    }),
  );
  const item = out.Item;
  if (!item || item.RevokedAt) return null;
  return item;
}

async function revokeSession(userId, jti) {
  try {
    await doc.send(
      new UpdateCommand({
        TableName: tableName(),
        Key: { PK: `USER#${userId}`, SK: `SESSION#${jti}` },
        UpdateExpression: "SET RevokedAt = :t, TokenHash = :h",
        ConditionExpression: "attribute_exists(PK)",
        ExpressionAttributeValues: {
          ":t": new Date().toISOString(),
          ":h": "revoked",
        },
      }),
    );
  } catch (err) {
    if (err.name !== "ConditionalCheckFailedException") throw err;
  }
}

module.exports = { putSession, getSession, revokeSession };
