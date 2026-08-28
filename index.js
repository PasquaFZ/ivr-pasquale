const fs = require("fs");
const path = require("path");

const envFile = path.join(__dirname, ".env");
if (fs.existsSync(envFile)) {
  require("dotenv").config({ path: envFile, quiet: true });
}

const { createApp } = require("./src/app");
const { departmentPhones } = require("./src/config");

const port = process.env.PORT || 3000;
const app = createApp();

app.listen(port, () => {
  console.log(`listening on ${port}`);
  if (!process.env.PUBLIC_BASE_URL) console.warn("PUBLIC_BASE_URL is empty");
  const company = process.env.COMPANY_PHONE || "";
  for (const row of departmentPhones()) {
    if (!row.phone) {
      console.warn(`missing ${row.lang.toUpperCase()} ${row.dept} phone`);
      continue;
    }
    if (company && row.phone === company) {
      console.warn(`${row.lang} ${row.dept} phone is COMPANY_PHONE — that will loop the IVR`);
    }
  }
});
