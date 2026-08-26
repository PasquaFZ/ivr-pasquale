function publicBaseUrl() {
  return (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
}

function tableName() {
  return process.env.DDB_TABLE || "ivr-business";
}

module.exports = { publicBaseUrl, tableName };
