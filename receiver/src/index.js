require("dotenv").config();
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { pipeline } = require("node:stream/promises");
const { Readable } = require("node:stream");

const base = (process.env.NEXLINK_SERVER_URL || "").replace(/\/$/, "");
const token = process.env.NEXLINK_DEVICE_TOKEN || "";
const outDir = path.resolve(
	process.env.NEXLINK_DOWNLOAD_DIR ||
		path.join(require("node:os").homedir(), "Downloads", "NexLink"),
);
const interval = Math.max(5000, Number(process.env.POLL_INTERVAL_MS || 15000));
if (!base || !token) {
	console.error("Set NEXLINK_SERVER_URL and NEXLINK_DEVICE_TOKEN in .env");
	process.exit(1);
}
fs.mkdirSync(outDir, { recursive: true });
const headers = { Authorization: `Bearer ${token}` };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const safeName = (name) =>
	path
		.basename(String(name).replace(/\\/g, "/"))
		.replace(/[\x00-\x1f\x7f]/g, "")
		.slice(0, 200) || "download";

async function request(url, options = {}) {
	const response = await fetch(url, {
		...options,
		headers: { ...headers, ...(options.headers || {}) },
		signal: AbortSignal.timeout(10 * 60 * 1000),
	});
	if (!response.ok) {
		const body = await response.text().catch(() => "");
		throw new Error(`HTTP ${response.status}: ${body.slice(0, 200)}`);
	}
	return response;
}
async function download(transfer) {
	const finalPath = path.join(
		outDir,
		`${transfer.id.slice(0, 8)}-${safeName(transfer.name)}`,
	);
	const tempPath = `${finalPath}.part`;
	if (fs.existsSync(finalPath)) {
		console.log(`Already exists, skipping: ${path.basename(finalPath)}`);
		return;
	}
	console.log(`Receiving ${transfer.name} (${transfer.size} bytes)`);
	const response = await request(
		`${base}/api/device/transfers/${transfer.id}/download`,
	);
	if (!response.body)
		throw new Error("Server returned an empty download stream.");
	const hash = crypto.createHash("sha256");
	const source = Readable.fromWeb(response.body);
	source.on("data", (chunk) => hash.update(chunk));
	try {
		await pipeline(source, fs.createWriteStream(tempPath, { flags: "wx" }));
		const actual = hash.digest("hex");
		if (actual !== transfer.sha256)
			throw new Error("SHA-256 verification failed; file was not accepted.");
		fs.renameSync(tempPath, finalPath);
		await request(`${base}/api/device/transfers/${transfer.id}/complete`, {
			method: "POST",
		});
		console.log(`Saved and verified: ${finalPath}`);
	} catch (error) {
		try {
			fs.unlinkSync(tempPath);
		} catch {}
		throw error;
	}
}
async function cycle() {
	try {
		await request(`${base}/api/device/heartbeat`, { method: "POST" });
		const response = await request(`${base}/api/device/pending`);
		const data = await response.json();
		for (const transfer of data.transfers || []) {
			try {
				await download(transfer);
			} catch (error) {
				console.error(`Could not receive ${transfer.name}: ${error.message}`);
			}
		}
	} catch (error) {
		console.error(`Server unavailable; will retry: ${error.message}`);
	}
}
console.log(`NexLink receiver active. Saving files to ${outDir}`);
(async () => {
	while (true) {
		await cycle();
		await sleep(interval);
	}
})();
