# NexLink Lite

A clean, self-hosted remote file-drop MVP. Upload from any browser; an Ubuntu receiver downloads queued files when it is online.

## Architecture
- `server/`: Express API, SQLite metadata, persistent local file storage, and web UI.
- `receiver/`: Node.js agent for Ubuntu. Polls for queued transfers, downloads to a local folder, verifies SHA-256, then acknowledges completion.
- `web/`: responsive single-page sender/dashboard UI.

## Requirements
- Node.js 20 or newer on both server and Ubuntu receiver.
- A publicly reachable server with persistent disk storage and HTTPS for remote use.
- Keep the server's `server/data/` directory persistent across restarts/deployments.

## 1. Configure and run the server

```bash
cd server
npm install
npm run setup
npm start
```

`npm run setup` creates `server/.env` with two random secrets:
- `UPLOAD_KEY`: enter this in the web app before sending files.
- `DEVICE_TOKEN`: configure this in the Ubuntu receiver.

The server listens on port 3000 by default. Open `http://localhost:3000` to use the web app. For remote use, deploy the server behind HTTPS and set `APP_BASE_URL` to its public URL.

**Important:** `UPLOAD_KEY` is a shared secret. Only share it with people you trust. Anyone who has it can queue files for your receiver. Never publish `.env` or commit it to Git.

## 2. Configure the Ubuntu receiver

Copy `receiver/` to Ubuntu, then:

```bash
cd receiver
npm install
cp .env.example .env
```

Edit `.env`:

```env
NEXLINK_SERVER_URL=https://your-server.example.com
NEXLINK_DEVICE_TOKEN=PASTE_DEVICE_TOKEN_FROM_server/.env
NEXLINK_DOWNLOAD_DIR=/home/YOUR_USER/Downloads/NexLink
POLL_INTERVAL_MS=15000
```

Start it:

```bash
npm start
```

Keep it running while you want automatic delivery. It resumes checking after network interruptions and after Ubuntu starts again.

### Optional: start receiver automatically with Ubuntu (systemd)

Use the provided `receiver/nexlink-receiver.service.example`. Replace `YOUR_USER` and paths, then install it:

```bash
sudo cp nexlink-receiver.service.example /etc/systemd/system/nexlink-receiver.service
sudo systemctl daemon-reload
sudo systemctl enable --now nexlink-receiver
sudo systemctl status nexlink-receiver
```

## 3. Use it
1. Open the public NexLink URL on the sending computer.
2. Enter `UPLOAD_KEY` and select/drop files.
3. Files enter the cloud queue, even if Ubuntu is powered off.
4. When Ubuntu is online and the receiver is running, files are downloaded to the configured folder.

## API
- `POST /api/transfers` — multipart upload (`file` field), header `x-upload-key`.
- `GET /api/dashboard` — queue overview, header `x-upload-key`.
- `GET /api/device/pending` — pending transfers, bearer `DEVICE_TOKEN`.
- `GET /api/device/transfers/:id/download` — authenticated file download.
- `POST /api/device/transfers/:id/complete` — authenticated completion acknowledgement.
- `POST /api/device/heartbeat` — authenticated receiver heartbeat.
- `GET /api/health` — health check.

## MVP limitations and security
- The shared upload key is intentionally simple for a personal MVP. Rotate it if exposed.
- Use HTTPS for any traffic over the internet.
- The server needs enough persistent disk space for queued files. Set a sensible `MAX_FILE_SIZE_MB` and monitor storage.
- Files expire after `FILE_TTL_HOURS` (default 72 hours). Expired files are removed by the server cleanup task.
- This MVP is intended for personal/trusted use, not as a public anonymous file-hosting service. Add per-user accounts, quotas, abuse controls, and malware scanning before opening it to the public.
- Keep a backup if files matter. A successful server upload is not a substitute for a backup.
