import "./load-env.js";
import express from "express";
import multer from "multer";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { decryptSecret, encryptSecret, parseMasterKey } from "./crypto.js";
import { openDatabase, rowToHistory, rowToProfile } from "./database.js";
import { FlaskApiError, getMe, login } from "./flask-client.js";
import { listImages, prepareImageFolder, saveUploadedImage } from "./images.js";
import { createRunner } from "./runner.js";
import { createScheduler } from "./scheduler.js";

const host = process.env.REPLAY_HOST || "0.0.0.0";
const port = Number(process.env.REPLAY_PORT || 4300);
const masterKey = parseMasterKey(process.env.REPLAY_MASTER_KEY);
const db = openDatabase();
const runner = createRunner({ db, masterKey });
const scheduler = createScheduler({ db, runner });
const upload = multer({ storage: multer.memoryStorage(), limits: { files: 30, fileSize: 10 * 1024 * 1024 } });
const app = express();

app.use(express.json({ limit: "1mb" }));

const ok = (res, data) => res.json({ ok: true, data });
const fail = (res, status, error) => res.status(status).json({ ok: false, error });
const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res)).catch(next);

function settings() {
  const row = db.prepare("SELECT api_base_url FROM settings WHERE id = 1").get();
  return { apiBaseUrl: row.api_base_url };
}

function activeProfile(id) {
  return db.prepare("SELECT * FROM profiles WHERE id = ? AND deleted_at IS NULL").get(id);
}

function validateTime(value) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value || "")) {
    throw new Error("scheduleTime must use HH:mm in 24-hour time");
  }
}

async function validatedProfile(body, existing = null) {
  const loginName = String(body.loginName ?? existing?.login_name ?? "").trim();
  const password = String(body.password || "");
  const requestedFolder = String(body.imageFolder ?? existing?.image_folder ?? "").trim();
  const scheduleTime = String(body.scheduleTime ?? existing?.schedule_time ?? "17:40");
  validateTime(scheduleTime);
  if (!loginName) throw new Error("loginName is required");
  if (!existing && !password) throw new Error("password is required");

  const resolvedPassword = password || null;
  let encryptedPassword = existing?.encrypted_password;
  let session;
  try {
    if (resolvedPassword) {
      session = await login(settings().apiBaseUrl, loginName, resolvedPassword);
      encryptedPassword = encryptSecret(resolvedPassword, masterKey);
    } else {
      session = await login(settings().apiBaseUrl, loginName, decryptSecret(encryptedPassword, masterKey));
    }
  } catch (error) {
    if (error instanceof FlaskApiError && error.status === 401) {
      throw new Error(
        `Không đăng nhập được tài khoản "${loginName}" trên Face API. ` +
        "Hãy dùng login/password của chính nhân viên, không dùng tài khoản admin.",
      );
    }
    throw error;
  }
  const employee = await getMe(settings().apiBaseUrl, session.token);
  const imageFolder = await prepareImageFolder(requestedFolder);
  return {
    loginName,
    encryptedPassword,
    imageFolder,
    scheduleTime,
    enabled: body.enabled === true || body.enabled === 1,
    employee,
  };
}

app.get("/tool-api/health", (_req, res) => ok(res, { service: "scheduled-replay" }));

app.get("/tool-api/settings", (_req, res) => ok(res, settings()));

app.put("/tool-api/settings", (req, res) => {
  try {
    const url = new URL(req.body.apiBaseUrl);
    if (!new Set(["http:", "https:"]).has(url.protocol)) throw new Error();
    const apiBaseUrl = url.toString().replace(/\/$/, "");
    db.prepare("UPDATE settings SET api_base_url = ? WHERE id = 1").run(apiBaseUrl);
    return ok(res, settings());
  } catch {
    return fail(res, 400, "apiBaseUrl must be a valid HTTP(S) URL");
  }
});

app.get("/tool-api/profiles", (_req, res) => {
  const rows = db.prepare("SELECT * FROM profiles WHERE deleted_at IS NULL ORDER BY full_name").all();
  return ok(res, rows.map(rowToProfile));
});

app.post("/tool-api/profiles", asyncRoute(async (req, res) => {
  const profile = await validatedProfile(req.body);
  const now = new Date().toISOString();
  const result = db.prepare(`
    INSERT INTO profiles (
      employee_id, employee_code, full_name, login_name, encrypted_password,
      image_folder, schedule_time, enabled, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    profile.employee.id,
    profile.employee.employee_code,
    profile.employee.full_name,
    profile.loginName,
    profile.encryptedPassword,
    profile.imageFolder,
    profile.scheduleTime,
    Number(profile.enabled),
    now,
    now,
  );
  const id = Number(result.lastInsertRowid);
  scheduler.refresh(id);
  return ok(res.status(201), rowToProfile(activeProfile(id)));
}));

app.put("/tool-api/profiles/:id", asyncRoute(async (req, res) => {
  const existing = activeProfile(Number(req.params.id));
  if (!existing) return fail(res, 404, "profile not found");
  const profile = await validatedProfile(req.body, existing);
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE profiles SET employee_id = ?, employee_code = ?, full_name = ?,
      login_name = ?, encrypted_password = ?, image_folder = ?, schedule_time = ?,
      enabled = ?, updated_at = ? WHERE id = ?
  `).run(
    profile.employee.id,
    profile.employee.employee_code,
    profile.employee.full_name,
    profile.loginName,
    profile.encryptedPassword,
    profile.imageFolder,
    profile.scheduleTime,
    Number(profile.enabled),
    now,
    existing.id,
  );
  scheduler.refresh(existing.id);
  return ok(res, rowToProfile(activeProfile(existing.id)));
}));

app.delete("/tool-api/profiles/:id", (req, res) => {
  const id = Number(req.params.id);
  const result = db.prepare("DELETE FROM profiles WHERE id = ?").run(id);
  if (!result.changes) return fail(res, 404, "profile not found");
  scheduler.remove(id);
  return ok(res, { deleted: true });
});

app.post("/tool-api/profiles/:id/run", asyncRoute(async (req, res) => {
  if (!activeProfile(Number(req.params.id))) return fail(res, 404, "profile not found");
  return ok(res, await runner.enqueue(Number(req.params.id), "manual"));
}));

app.get("/tool-api/profiles/:id/images", asyncRoute(async (req, res) => {
  const profile = activeProfile(Number(req.params.id));
  if (!profile) return fail(res, 404, "profile not found");
  return ok(res, await listImages(profile.image_folder));
}));

app.post("/tool-api/profiles/:id/images", upload.array("images", 30), asyncRoute(async (req, res) => {
  const profile = activeProfile(Number(req.params.id));
  if (!profile) return fail(res, 404, "profile not found");
  if (!req.files?.length) return fail(res, 400, "at least one image is required");
  const saved = [];
  for (const file of req.files) {
    saved.push(await saveUploadedImage(profile.image_folder, file));
  }
  return ok(res.status(201), { saved });
}));

app.get("/tool-api/history", (req, res) => {
  const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1);
  const pageSize = Math.min(Math.max(Number.parseInt(req.query.pageSize, 10) || 20, 1), 100);
  const profileId = Number(req.query.profileId);
  const status = String(req.query.status || "");
  const allowedStatuses = new Set(["running", "success", "skipped", "failed"]);
  if (status && !allowedStatuses.has(status)) {
    return fail(res, 400, "status must be running, success, skipped, or failed");
  }

  const clauses = [];
  const params = [];
  if (Number.isInteger(profileId) && profileId > 0) {
    clauses.push("profile_id = ?");
    params.push(profileId);
  }
  if (status) {
    clauses.push("status = ?");
    params.push(status);
  }
  const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
  const total = db.prepare(`SELECT COUNT(*) AS total FROM run_history${where}`).get(...params).total;
  const totalPages = Math.max(Math.ceil(total / pageSize), 1);
  const safePage = Math.min(page, totalPages);
  const offset = (safePage - 1) * pageSize;
  const rows = db.prepare(
    `SELECT * FROM run_history${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
  ).all(...params, pageSize, offset);
  return ok(res, {
    items: rows.map(rowToHistory),
    page: safePage,
    pageSize,
    total,
    totalPages,
  });
});

const dist = resolve(fileURLToPath(new URL("../dist", import.meta.url)));
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get("/{*path}", (_req, res) => res.sendFile(resolve(dist, "index.html")));
}

app.use((error, _req, res, _next) => {
  console.error(error);
  if (error?.code?.startsWith("SQLITE_CONSTRAINT")) {
    return fail(res, 409, "employee, login, or image folder is already used by another profile");
  }
  if (error instanceof multer.MulterError) return fail(res, 400, error.message);
  return fail(res, 400, error.message || "request failed");
});

scheduler.start();
const server = app.listen(port, host, () => {
  console.log(`Scheduled Replay listening on http://${host}:${port}`);
});

function shutdown() {
  scheduler.stop();
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
