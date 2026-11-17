const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const envPath = path.join(__dirname, "..", ".env");
if (fs.existsSync(envPath)) {
	console.log(".env already exists. It was not overwritten.");
	process.exit(0);
}
const secret = () => crypto.randomBytes(32).toString("hex");
const content = `PORT=3000\nAPP_BASE_URL=http://localhost:3000\nUPLOAD_KEY=${secret()}\nDEVICE_TOKEN=${secret()}\nMAX_FILE_SIZE_MB=100\nFILE_TTL_HOURS=72\n`;
fs.writeFileSync(envPath, content, { mode: 0o600 });
console.log("Created server/.env. Keep UPLOAD_KEY and DEVICE_TOKEN private.");
