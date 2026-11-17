require("dotenv").config({
	path: require("node:path").join(__dirname, "..", ".env"),
});
const express = require("express");
const helmet = require("helmet");
const multer = require("multer");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const db = require("./db");
const { uploadAuth, deviceAuth } = require("./auth");

if (!process.env.UPLOAD_KEY || !process.env.DEVICE_TOKEN) {
	console.error("Missing secrets. Run: npm run setup");
	process.exit(1);
}
const app = express();
const storageDir = path.join(__dirname, "..", "storage");
const webDir = path.join(__dirname, "..", "..", "web");
fs.mkdirSync(storageDir, { recursive: true });
const maxBytes =
	Math.max(1, Number(process.env.MAX_FILE_SIZE_MB || 100)) * 1024 * 1024;
const ttlHours = Math.max(1, Number(process.env.FILE_TTL_HOURS || 72));
let lastHeartbeat = 0;

app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "32kb" }));
app.use(express.static(webDir));

const upload = multer({
	storage: multer.diskStorage({
		destination: (_req, _file, cb) => cb(null, storageDir),
		filename: (_req, _file, cb) =>
			cb(null, crypto.randomBytes(24).toString("hex")),
	}),
	limits: { fileSize: maxBytes, files: 1 },
	fileFilter: (_req, file, cb) => {
		if (!file.originalname || file.originalname.length > 240)
			return cb(new Error("Filename is too long."));
		cb(null, true);
	},
});

function hashFile(filePath) {
	return new Promise((resolve, reject) => {
		const hash = crypto.createHash("sha256");
		const stream = fs.createReadStream(filePath);
		stream.on("data", (chunk) => hash.update(chunk));
		stream.on("error", reject);
		stream.on("end", () => resolve(hash.digest("hex")));
	});
}
function safeName(name) {
	return (
		path
			.basename(String(name).replace(/\\/g, "/"))
			.replace(/[\x00-\x1f\x7f]/g, "")
			.slice(0, 240) || "download"
	);
}
function removeExpired() {
	const expired = db
		.prepare(
			"SELECT id, stored_name FROM transfers WHERE expires_at <= ? AND status != 'completed'",
		)
		.all(new Date().toISOString());
	const mark = db.prepare("UPDATE transfers SET status='expired' WHERE id=?");
	for (const item of expired) {
		try {
			fs.unlinkSync(path.join(storageDir, item.stored_name));
		} catch {}
		mark.run(item.id);
	}
}
setInterval(removeExpired, 10 * 60 * 1000).unref();

app.get("/api/health", (_req, res) =>
	res.json({ ok: true, service: "NexLink Lite" }),
);

app.post("/api/transfers", uploadAuth, (req, res) => {
	upload.single("file")(req, res, async (err) => {
		if (err) {
			const status =
				err instanceof multer.MulterError
					? err.code === "LIMIT_FILE_SIZE"
						? 413
						: 400
					: 400;
			return res
				.status(status)
				.json({
					error:
						err.code === "LIMIT_FILE_SIZE"
							? `File exceeds ${Math.floor(maxBytes / 1024 / 1024)} MB limit.`
							: err.message,
				});
		}
		if (!req.file)
			return res.status(400).json({ error: "Choose a file first." });
		try {
			const id = crypto.randomBytes(18).toString("hex");
			const now = new Date();
			const expires = new Date(now.getTime() + ttlHours * 3600000);
			const digest = await hashFile(req.file.path);
			db.prepare(
				`INSERT INTO transfers (id, original_name, stored_name, mime_type, size, sha256, status, created_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
			).run(
				id,
				safeName(req.file.originalname),
				req.file.filename,
				req.file.mimetype || "application/octet-stream",
				req.file.size,
				digest,
				now.toISOString(),
				expires.toISOString(),
			);
			res
				.status(201)
				.json({
					id,
					name: safeName(req.file.originalname),
					size: req.file.size,
					sha256: digest,
					status: "pending",
					expiresAt: expires.toISOString(),
				});
		} catch (e) {
			try {
				fs.unlinkSync(req.file.path);
			} catch {}
			console.error(e);
			res.status(500).json({ error: "Could not save transfer." });
		}
	});
});

app.get("/api/dashboard", uploadAuth, (_req, res) => {
	removeExpired();
	const rows = db
		.prepare(
			"SELECT id, original_name AS name, size, status, created_at AS createdAt, expires_at AS expiresAt FROM transfers WHERE status != 'expired' ORDER BY created_at DESC LIMIT 30",
		)
		.all();
	const counts = db
		.prepare("SELECT status, COUNT(*) AS count FROM transfers GROUP BY status")
		.all();
	res.json({
		transfers: rows,
		counts,
		receiverOnline: Date.now() - lastHeartbeat < 45000,
	});
});

app.get("/api/device/pending", deviceAuth, (_req, res) => {
	removeExpired();
	lastHeartbeat = Date.now();
	const rows = db
		.prepare(
			"SELECT id, original_name AS name, size, sha256, mime_type AS mimeType FROM transfers WHERE status IN ('pending','downloading') ORDER BY created_at ASC LIMIT 10",
		)
		.all();
	res.json({ transfers: rows });
});
app.post("/api/device/heartbeat", deviceAuth, (_req, res) => {
	lastHeartbeat = Date.now();
	res.json({ ok: true, serverTime: new Date().toISOString() });
});
app.get("/api/device/transfers/:id/download", deviceAuth, (req, res) => {
	const item = db
		.prepare(
			"SELECT * FROM transfers WHERE id=? AND status IN ('pending','downloading')",
		)
		.get(req.params.id);
	if (!item)
		return res.status(404).json({ error: "Transfer is no longer available." });
	const filePath = path.join(storageDir, item.stored_name);
	if (!fs.existsSync(filePath))
		return res.status(404).json({ error: "Stored file is missing." });
	db.prepare("UPDATE transfers SET status='downloading' WHERE id=?").run(
		item.id,
	);
	res.setHeader("Content-Type", "application/octet-stream");
	res.setHeader("Content-Length", item.size);
	res.setHeader(
		"Content-Disposition",
		`attachment; filename="${encodeURIComponent(item.original_name)}"`,
	);
	fs.createReadStream(filePath).pipe(res);
});
app.post("/api/device/transfers/:id/complete", deviceAuth, (req, res) => {
	const result = db
		.prepare(
			"UPDATE transfers SET status='completed', completed_at=? WHERE id=? AND status IN ('pending','downloading')",
		)
		.run(new Date().toISOString(), req.params.id);
	if (!result.changes)
		return res
			.status(404)
			.json({ error: "Transfer not found or already completed." });
	// Keep the file for a short recovery window; cleanup below removes completed files after 24h.
	res.json({ ok: true });
});

// Remove completed payloads after 24 hours, preserving lightweight history.
setInterval(
	() => {
		const cutoff = new Date(Date.now() - 24 * 3600000).toISOString();
		const old = db
			.prepare(
				"SELECT id, stored_name FROM transfers WHERE status='completed' AND completed_at < ?",
			)
			.all(cutoff);
		for (const item of old) {
			try {
				fs.unlinkSync(path.join(storageDir, item.stored_name));
			} catch {}
			db.prepare("DELETE FROM transfers WHERE id=?").run(item.id);
		}
	},
	60 * 60 * 1000,
).unref();

app.use((err, _req, res, _next) => {
	console.error(err);
	res.status(500).json({ error: "Unexpected server error." });
});
const port = Number(process.env.PORT || 3000);
app.listen(port, "0.0.0.0", () =>
	console.log(`NexLink Lite running on http://localhost:${port}`),
);
