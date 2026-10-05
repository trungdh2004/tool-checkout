import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const DEFAULT_API_URL = "http://127.0.0.1:5000/api/v1";

export function openDatabase(path = process.env.REPLAY_DB_PATH || "./data/scheduled-replay.sqlite") {
  const absolutePath = resolve(path);
  mkdirSync(dirname(absolutePath), { recursive: true });
  const db = new DatabaseSync(absolutePath);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      api_base_url TEXT NOT NULL
    );

    INSERT OR IGNORE INTO settings (id, api_base_url)
    VALUES (1, '${DEFAULT_API_URL}');

    CREATE TABLE IF NOT EXISTS profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      employee_code TEXT NOT NULL,
      full_name TEXT NOT NULL,
      login_name TEXT NOT NULL,
      encrypted_password TEXT NOT NULL,
      image_folder TEXT NOT NULL,
      schedule_time TEXT NOT NULL DEFAULT '17:40',
      enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );

    CREATE UNIQUE INDEX IF NOT EXISTS ux_profiles_login_active
      ON profiles(login_name) WHERE deleted_at IS NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS ux_profiles_folder_active
      ON profiles(image_folder) WHERE deleted_at IS NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS ux_profiles_employee_active
      ON profiles(employee_id) WHERE deleted_at IS NULL;

    CREATE TABLE IF NOT EXISTS run_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id INTEGER NOT NULL,
      profile_name TEXT NOT NULL,
      employee_id INTEGER NOT NULL,
      trigger TEXT NOT NULL CHECK (trigger IN ('scheduled', 'manual')),
      scheduled_date TEXT,
      status TEXT NOT NULL CHECK (status IN ('running', 'success', 'skipped', 'failed')),
      check_count INTEGER,
      image_path TEXT,
      message TEXT,
      result_json TEXT,
      started_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE UNIQUE INDEX IF NOT EXISTS ux_history_scheduled_once
      ON run_history(profile_id, scheduled_date)
      WHERE trigger = 'scheduled';
    CREATE INDEX IF NOT EXISTS ix_history_started_at
      ON run_history(started_at DESC);
  `);
  return db;
}

export function rowToProfile(row) {
  if (!row) return null;
  return {
    id: row.id,
    employeeId: row.employee_id,
    employeeCode: row.employee_code,
    fullName: row.full_name,
    loginName: row.login_name,
    imageFolder: row.image_folder,
    scheduleTime: row.schedule_time,
    enabled: Boolean(row.enabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function rowToHistory(row) {
  return {
    id: row.id,
    profileId: row.profile_id,
    profileName: row.profile_name,
    employeeId: row.employee_id,
    trigger: row.trigger,
    status: row.status,
    checkCount: row.check_count,
    imagePath: row.image_path,
    message: row.message,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}
