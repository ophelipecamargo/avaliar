const fs = require("fs");
const path = require("path");

require("dotenv").config();

const appUrl = String(process.env.APP_SERVER_URL || "").trim();
if (!appUrl) {
  console.error("Defina APP_SERVER_URL no .env (ex: http://SEU_IP:3000).");
  process.exit(1);
}

const normalized = appUrl.replace(/\/+$/, "");
const finalUrl = `${normalized}/login.html`;

const configPath = path.join(__dirname, "..", "capacitor.config.json");
const raw = fs.readFileSync(configPath, "utf8");
const json = JSON.parse(raw);

json.server = json.server || {};
json.server.url = finalUrl;
json.server.cleartext = true;

fs.writeFileSync(configPath, JSON.stringify(json, null, 2) + "\n");
console.log(`Atualizado: server.url = ${finalUrl}`);
