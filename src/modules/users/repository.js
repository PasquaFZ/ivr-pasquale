const {
  QueryCommand,
  GetCommand,
  BatchGetCommand,
  TransactWriteCommand,
  UpdateCommand,
} = require("@aws-sdk/lib-dynamodb");
const { ulid } = require("ulid");
const { doc } = require("../../infra/db");
const { tableName, PAGE_SIZE } = require("../../config");

const USER_PROJECTION =
  "UserId, FirstName, LastName, Phone, Email, #R, #S, CreatedAt, UpdatedAt, #Perms";
const USER_NAMES = { "#R": "Role", "#S": "Status", "#Perms": "Permissions" };

function nameSortKey(lastName, firstName, userId) {
  return `${lastName.toLowerCase()}#${firstName.toLowerCase()}#${userId}`;
}

function searchName(firstName, lastName) {
  return `${firstName} ${lastName}`.trim().toLowerCase();
}

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

async function findUserByEmail(email) {
  const out = await doc.send(
    new GetCommand({
      TableName: tableName(),
      Key: { PK: `EMAIL#${email}`, SK: "UNIQUE" },
    }),
  );
  return out.Item && out.Item.UserId ? out.Item.UserId : null;
}

async function getUserById(userId) {
  const out = await doc.send(
    new GetCommand({
      TableName: tableName(),
      Key: { PK: `USER#${userId}`, SK: "METADATA" },
      ProjectionExpression: USER_PROJECTION,
      ExpressionAttributeNames: USER_NAMES,
    }),
  );
  return out.Item || null;
}

async function getUserAuthById(userId) {
  const out = await doc.send(
    new GetCommand({
      TableName: tableName(),
      Key: { PK: `USER#${userId}`, SK: "METADATA" },
      ProjectionExpression: "UserId, Email, PasswordHash, #R, #S, FirstName, LastName, Phone, CreatedAt, #Perms",
      ExpressionAttributeNames: USER_NAMES,
    }),
  );
  return out.Item || null;
}

async function ensureListed(userId) {
  await doc.send(
    new UpdateCommand({
      TableName: tableName(),
      Key: { PK: `USER#${userId}`, SK: "METADATA" },
      UpdateExpression:
        "SET GSI2PK = if_not_exists(GSI2PK, :gpk), GSI2SK = if_not_exists(GSI2SK, :gsk), #R = if_not_exists(#R, :role)",
      ExpressionAttributeNames: { "#R": "Role" },
      ExpressionAttributeValues: {
        ":gpk": "ENTITY#USER",
        ":gsk": `#${userId}`,
        ":role": "user",
      },
    }),
  );
}

async function upsertUserByPhone(phone) {
  const existing = await findUserByPhone(phone);
  if (existing) {
    ensureListed(existing).catch((err) => console.error("ensure listed", err));
    return existing;
  }

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
              Role: "user",
              Status: "ACTIVE",
              SearchName: "",
              GSI2PK: "ENTITY#USER",
              GSI2SK: `#${userId}`,
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

async function updateUserName(phone, firstName, lastName) {
  const userId = await findUserByPhone(phone);
  if (!userId) return null;

  const first = firstName.trim();
  const last = lastName.trim();

  await doc.send(
    new UpdateCommand({
      TableName: tableName(),
      Key: { PK: `USER#${userId}`, SK: "METADATA" },
      UpdateExpression:
        "SET FirstName = :f, LastName = :l, SearchName = :sn, GSI2PK = :gpk, GSI2SK = :gsk",
      ExpressionAttributeValues: {
        ":f": first,
        ":l": last,
        ":sn": searchName(first, last),
        ":gpk": "ENTITY#USER",
        ":gsk": nameSortKey(last, first, userId),
      },
    }),
  );

  return userId;
}

async function createUser({ firstName, lastName, email, phone, passwordHash, role, permissions }) {
  const userId = ulid();
  const now = new Date().toISOString();
  const first = firstName.trim();
  const last = lastName.trim();
  const roleName = role === "admin" ? "admin" : "user";
  const perms = Array.isArray(permissions) ? permissions : [];

  const item = {
    PK: `USER#${userId}`,
    SK: "METADATA",
    UserId: userId,
    Role: roleName,
    Status: "ACTIVE",
    FirstName: first,
    LastName: last,
    SearchName: searchName(first, last),
    Permissions: perms,
    GSI2PK: "ENTITY#USER",
    GSI2SK: nameSortKey(last, first, userId),
    CreatedAt: now,
  };
  if (email) item.Email = email;
  if (phone) item.Phone = phone;
  if (passwordHash) item.PasswordHash = passwordHash;

  const transact = [
    {
      Put: {
        TableName: tableName(),
        Item: item,
        ConditionExpression: "attribute_not_exists(PK)",
      },
    },
  ];

  if (email) {
    transact.push({
      Put: {
        TableName: tableName(),
        Item: { PK: `EMAIL#${email}`, SK: "UNIQUE", UserId: userId },
        ConditionExpression: "attribute_not_exists(PK)",
      },
    });
  }

  if (phone) {
    transact.push({
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
    });
  }

  try {
    await doc.send(new TransactWriteCommand({ TransactItems: transact }));
  } catch (err) {
    if (err.name === "TransactionCanceledException") return { error: "conflict" };
    throw err;
  }

  return { user: await getUserById(userId) };
}

async function createAdminUser({ email, passwordHash, firstName, lastName, permissions }) {
  return createUser({
    firstName: firstName || "admin",
    lastName: lastName || "business",
    email,
    passwordHash,
    role: "admin",
    permissions: permissions || [],
  });
}

async function applyAdminSeedProfile(userId, { firstName, lastName, permissions }) {
  const first = firstName || "admin";
  const last = lastName || "business";
  await doc.send(
    new UpdateCommand({
      TableName: tableName(),
      Key: { PK: `USER#${userId}`, SK: "METADATA" },
      UpdateExpression:
        "SET FirstName = :f, LastName = :l, SearchName = :sn, GSI2PK = :gpk, GSI2SK = :gsk, #R = :role, #S = :status, #Perms = :perms",
      ExpressionAttributeNames: { "#R": "Role", "#S": "Status", "#Perms": "Permissions" },
      ExpressionAttributeValues: {
        ":f": first,
        ":l": last,
        ":sn": searchName(first, last),
        ":gpk": "ENTITY#USER",
        ":gsk": nameSortKey(last, first, userId),
        ":role": "admin",
        ":status": "ACTIVE",
        ":perms": permissions || [],
      },
    }),
  );
}

async function hydrateUsers(items) {
  if (!items.length) return [];
  if (items[0].UserId) return items;

  const keys = items.map((item) => ({ PK: item.PK, SK: "METADATA" }));
  const out = await doc.send(
    new BatchGetCommand({
      RequestItems: {
        [tableName()]: {
          Keys: keys,
          ProjectionExpression: USER_PROJECTION,
          ExpressionAttributeNames: USER_NAMES,
        },
      },
    }),
  );
  return (out.Responses && out.Responses[tableName()]) || [];
}

async function listUsers({ cursor, namePrefix } = {}) {
  const params = {
    TableName: tableName(),
    IndexName: "GSI2",
    KeyConditionExpression: namePrefix
      ? "GSI2PK = :pk AND begins_with(GSI2SK, :sk)"
      : "GSI2PK = :pk",
    ExpressionAttributeValues: namePrefix
      ? { ":pk": "ENTITY#USER", ":sk": namePrefix }
      : { ":pk": "ENTITY#USER" },
    Limit: PAGE_SIZE,
    ExclusiveStartKey: cursor,
  };

  const out = await doc.send(new QueryCommand(params));
  const items = await hydrateUsers(out.Items || []);
  return {
    items,
    lastKey: out.LastEvaluatedKey || null,
  };
}

async function updateUserProfile(userId, patch) {
  const user = await getUserById(userId);
  if (!user) return { error: "not_found" };

  const transact = [];
  const sets = ["UpdatedAt = :now"];
  const values = { ":now": new Date().toISOString() };
  let removeEmail = false;

  const first = patch.firstName !== undefined ? patch.firstName.trim() : (user.FirstName || "");
  const last = patch.lastName !== undefined ? patch.lastName.trim() : (user.LastName || "");
  if (patch.firstName !== undefined || patch.lastName !== undefined) {
    sets.push("FirstName = :f", "LastName = :l", "SearchName = :sn", "GSI2PK = :gpk", "GSI2SK = :gsk");
    values[":f"] = first;
    values[":l"] = last;
    values[":sn"] = searchName(first, last);
    values[":gpk"] = "ENTITY#USER";
    values[":gsk"] = nameSortKey(last, first, userId);
  }

  if (patch.phone !== undefined && patch.phone !== (user.Phone || "")) {
    const taken = await findUserByPhone(patch.phone);
    if (taken && taken !== userId) return { error: "phone_taken" };
    sets.push("Phone = :p");
    values[":p"] = patch.phone;
    if (user.Phone) {
      transact.push({
        Delete: {
          TableName: tableName(),
          Key: { PK: `USER#${userId}`, SK: `INDEX#PHONE#${user.Phone}` },
        },
      });
    }
    transact.push({
      Put: {
        TableName: tableName(),
        Item: {
          PK: `USER#${userId}`,
          SK: `INDEX#PHONE#${patch.phone}`,
          GSI1PK: `PHONE#${patch.phone}`,
          GSI1SK: `USER#${userId}`,
        },
      },
    });
  }

  if (patch.email !== undefined) {
    const next = patch.email;
    const prev = (user.Email || "").toLowerCase();
    if (next !== prev) {
      if ((user.Role || "user") === "admin" && !next) return { error: "admin_email_required" };
      if (next) {
        const taken = await findUserByEmail(next);
        if (taken && taken !== userId) return { error: "email_taken" };
      }
      if (next) {
        sets.push("Email = :e");
        values[":e"] = next;
      } else {
        removeEmail = true;
      }
      if (prev) {
        transact.push({
          Delete: {
            TableName: tableName(),
            Key: { PK: `EMAIL#${prev}`, SK: "UNIQUE" },
          },
        });
      }
      if (next) {
        transact.push({
          Put: {
            TableName: tableName(),
            Item: { PK: `EMAIL#${next}`, SK: "UNIQUE", UserId: userId },
            ConditionExpression: "attribute_not_exists(PK)",
          },
        });
      }
    }
  }

  transact.unshift({
    Update: {
      TableName: tableName(),
      Key: { PK: `USER#${userId}`, SK: "METADATA" },
      UpdateExpression: removeEmail ? `SET ${sets.join(", ")} REMOVE Email` : `SET ${sets.join(", ")}`,
      ExpressionAttributeValues: values,
      ConditionExpression: "attribute_exists(PK)",
    },
  });

  try {
    await doc.send(new TransactWriteCommand({ TransactItems: transact }));
  } catch (err) {
    if (err.name === "TransactionCanceledException") return { error: "conflict" };
    throw err;
  }

  return { user: await getUserById(userId) };
}

module.exports = {
  findUserByPhone,
  findUserByEmail,
  getUserById,
  getUserAuthById,
  upsertUserByPhone,
  updateUserName,
  createAdminUser,
  applyAdminSeedProfile,
  createUser,
  listUsers,
  updateUserProfile,
};
