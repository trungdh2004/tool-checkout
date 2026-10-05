import { decryptSecret } from "./crypto.js";
import { getChecks, getMe, login, postMobileWithRetry } from "./flask-client.js";
import { randomImage } from "./images.js";

export function shouldReplay(checkCount) {
  return checkCount === 1;
}

function localDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function createRunner({ db, masterKey }) {
  let queue = Promise.resolve();

  function enqueue(profileId, trigger, context = {}) {
    const operation = queue.then(() => run(profileId, trigger, context));
    queue = operation.catch(() => undefined);
    return operation;
  }

  async function run(profileId, trigger, context) {
    const profile = db.prepare(
      "SELECT * FROM profiles WHERE id = ? AND deleted_at IS NULL",
    ).get(profileId);
    if (!profile) throw new Error("profile not found");
    if (trigger === "scheduled" && !profile.enabled) {
      return { status: "skipped", message: "profile is disabled" };
    }
    if (
      trigger === "scheduled" &&
      context.expectedScheduleTime &&
      profile.schedule_time !== context.expectedScheduleTime
    ) {
      return { status: "skipped", message: "stale schedule was replaced" };
    }

    const startedAt = new Date().toISOString();
    const scheduledDate = trigger === "scheduled" ? localDate() : null;
    let historyId;
    try {
      const inserted = db.prepare(`
        INSERT INTO run_history (
          profile_id, profile_name, employee_id, trigger, scheduled_date,
          status, started_at
        ) VALUES (?, ?, ?, ?, ?, 'running', ?)
      `).run(profile.id, profile.full_name, profile.employee_id, trigger, scheduledDate, startedAt);
      historyId = Number(inserted.lastInsertRowid);
    } catch (error) {
      if (trigger === "scheduled" && String(error).includes("UNIQUE constraint failed")) {
        return { status: "skipped", message: "scheduled replay already ran today" };
      }
      throw error;
    }

    let checkCount = null;
    let imagePath = null;
    try {
      const apiBaseUrl = db.prepare("SELECT api_base_url FROM settings WHERE id = 1").get().api_base_url;
      const password = decryptSecret(profile.encrypted_password, masterKey);
      const session = await login(apiBaseUrl, profile.login_name, password);
      const me = await getMe(apiBaseUrl, session.token);
      if (me.id !== profile.employee_id) {
        throw new Error("the login now belongs to a different employee");
      }

      const checks = await getChecks(apiBaseUrl, session.token);
      checkCount = checks.check_count;
      if (!shouldReplay(checkCount)) {
        return finish(historyId, "skipped", {
          checkCount,
          message: `expected exactly 1 check, found ${checkCount}`,
        });
      }

      const image = await randomImage(profile.image_folder);
      imagePath = image.path;
      const result = await postMobileWithRetry(apiBaseUrl, session.token, image);
      const status = result.recorded ? "success" : "skipped";
      const message = result.recorded
        ? `recorded log ${result.log_id} using ${image.name}`
        : result.reason || "Flask did not record a check";
      return finish(historyId, status, { checkCount, imagePath, message, result });
    } catch (error) {
      return finish(historyId, "failed", {
        checkCount,
        imagePath,
        message: error.message || String(error),
      });
    }
  }

  function finish(historyId, status, details) {
    const completedAt = new Date().toISOString();
    db.prepare(`
      UPDATE run_history
      SET status = ?, check_count = ?, image_path = ?, message = ?,
          result_json = ?, completed_at = ?
      WHERE id = ?
    `).run(
      status,
      details.checkCount ?? null,
      details.imagePath ?? null,
      details.message ?? null,
      details.result ? JSON.stringify(details.result) : null,
      completedAt,
      historyId,
    );
    return { historyId, status, ...details, completedAt };
  }

  return { enqueue };
}
