const { PutCommand, QueryCommand } = require("@aws-sdk/lib-dynamodb");
const { ulid } = require("ulid");
const { doc } = require("../../infra/db");
const { logTableName, PAGE_SIZE } = require("../../config");

const LOG_PK = "ENTITY#LOG";

async function putLog(entry) {
  const logId = ulid();
  const createdAt = new Date().toISOString();
  const actor = entry.actor || {};
  const target = entry.target || {};
  const item = {
    PK: LOG_PK,
    SK: `${createdAt}#${logId}`,
    LogId: logId,
    CreatedAt: createdAt,
    Action: entry.action,
    Resource: entry.resource,
    ActorUserId: actor.userId || "",
    ActorEmail: actor.email || "",
    ActorRole: actor.role || "",
    ActorName: actor.name || "",
    TargetUserId: target.userId || "",
    TargetEmail: target.email || "",
    TargetRole: target.role || "",
    TargetName: target.name || "",
    TargetPhone: target.phone || "",
    Changes: Array.isArray(entry.changes) ? entry.changes : [],
    Ip: entry.ip || "",
  };
  if (entry.callSid) item.CallSid = entry.callSid;

  await doc.send(
    new PutCommand({
      TableName: logTableName(),
      Item: item,
    }),
  );
  return item;
}

async function listLogs({ cursor } = {}) {
  const params = {
    TableName: logTableName(),
    KeyConditionExpression: "PK = :pk",
    ExpressionAttributeValues: { ":pk": LOG_PK },
    ScanIndexForward: false,
    Limit: PAGE_SIZE,
  };
  if (cursor) params.ExclusiveStartKey = cursor;

  const out = await doc.send(new QueryCommand(params));
  return {
    items: out.Items || [],
    lastKey: out.LastEvaluatedKey || null,
  };
}

function publicLog(item) {
  if (!item) return null;
  return {
    logId: item.LogId,
    createdAt: item.CreatedAt,
    action: item.Action,
    resource: item.Resource,
    actor: {
      userId: item.ActorUserId || "",
      name: item.ActorName || "",
      email: item.ActorEmail || "",
      role: item.ActorRole || "",
    },
    target: item.TargetUserId
      ? {
          userId: item.TargetUserId,
          name: item.TargetName || "",
          email: item.TargetEmail || "",
          role: item.TargetRole || "",
          phone: item.TargetPhone || "",
        }
      : null,
    changes: Array.isArray(item.Changes) ? item.Changes : [],
    callSid: item.CallSid || "",
    ip: item.Ip || "",
  };
}

module.exports = { putLog, listLogs, publicLog };
