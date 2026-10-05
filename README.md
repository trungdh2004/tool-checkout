# Scheduled Replay

Node.js + React tool that submits one stored face image for an employee when that
employee has exactly one check in the current work date.

> This is a production write tool, not a camera. It replays a stored image through
> the mobile attendance endpoint, creates a real `time_logs` row with
> `source=mobile`, and stores that image as evidence. Use it only when this
> provenance trade-off is explicitly accepted.

## Setup

Requires Node.js 22.5 or newer because the server uses the built-in SQLite API.

```bash
npm install
cp .env.example .env
openssl rand -hex 32
```

Put the generated value in `REPLAY_MASTER_KEY`. Keep this key stable: changing it
makes existing profile passwords impossible to decrypt.

```bash
npm run dev
```

- React development UI: `http://localhost:5173`
- Express API: `http://localhost:4300/tool-api`

For production:

```bash
npm run build
npm start
```

The production UI and API are both served from `http://<host>:4300`.

## Operation

1. Set the Flask API URL in Settings, including `/api/v1`.
2. Add a profile with the employee's Flask login and an absolute image-folder path.
3. Upload JPEG or PNG images to that profile, or place them directly in its folder.
4. Enable the profile after checking its daily time.

Profile credentials are verified against Flask before being saved and encrypted
with AES-256-GCM in SQLite. The key remains in the environment. Profiles scheduled
at the same time run sequentially. A missed schedule is not run later at startup.

The UI has no authentication and accepts arbitrary absolute folder paths by
design. Anyone who can reach it can change profiles and write uploaded images to
directories writable by this process. Restrict network access outside the tool.
# tool-checkout
