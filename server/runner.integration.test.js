import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { encryptSecret, parseMasterKey } from "./crypto.js";
import { openDatabase } from "./database.js";
import { createRunner } from "./runner.js";

const resources = [];

afterEach(async () => {
  while (resources.length) await resources.pop()();
});

async function fakeFlask({ checkCount = 1, failFirstPost = false } = {}) {
  let mobilePosts = 0;
  const server = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.url === "/api/v1/login") {
      return res.end(JSON.stringify({
        ok: true,
        data: { token: "token", employee: { id: 7 } },
      }));
    }
    if (req.url === "/api/v1/me") {
      return res.end(JSON.stringify({
        ok: true,
        data: { id: 7, employee_code: "NV007", full_name: "Test Employee" },
      }));
    }
    if (req.url === "/api/v1/checks") {
      return res.end(JSON.stringify({ ok: true, data: { check_count: checkCount } }));
    }
    if (req.url === "/api/v1/checks/mobile") {
      mobilePosts += 1;
      if (failFirstPost && mobilePosts === 1) {
        res.statusCode = 503;
        return res.end(JSON.stringify({ ok: false, error: "temporary failure" }));
      }
      return res.end(JSON.stringify({
        ok: true,
        data: { recorded: true, log_id: 42 },
      }));
    }
    res.statusCode = 404;
    return res.end(JSON.stringify({ ok: false, error: "not found" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  resources.push(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();
  return {
    apiBaseUrl: `http://127.0.0.1:${port}/api/v1`,
    mobilePosts: () => mobilePosts,
  };
}

async function runnerFixture(apiBaseUrl) {
  const directory = await mkdtemp(join(tmpdir(), "scheduled-replay-"));
  resources.push(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, "face.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));

  const db = openDatabase(join(directory, "test.sqlite"));
  resources.push(async () => db.close());
  db.prepare("UPDATE settings SET api_base_url = ? WHERE id = 1").run(apiBaseUrl);
  const key = parseMasterKey("22".repeat(32));
  const now = new Date().toISOString();
  const inserted = db.prepare(`
    INSERT INTO profiles (
      employee_id, employee_code, full_name, login_name, encrypted_password,
      image_folder, schedule_time, enabled, created_at, updated_at
    ) VALUES (7, 'NV007', 'Test Employee', 'employee', ?, ?, '17:40', 1, ?, ?)
  `).run(encryptSecret("password", key), directory, now, now);
  return {
    db,
    runner: createRunner({ db, masterKey: key }),
    profileId: Number(inserted.lastInsertRowid),
  };
}

describe("replay runner integration", () => {
  it("logs in, checks the day, retries a transient POST, and records history", async () => {
    const flask = await fakeFlask({ failFirstPost: true });
    const { db, runner, profileId } = await runnerFixture(flask.apiBaseUrl);

    const result = await runner.enqueue(profileId, "manual");

    expect(result.status).toBe("success");
    expect(flask.mobilePosts()).toBe(2);
    const history = db.prepare("SELECT * FROM run_history WHERE id = ?").get(result.historyId);
    expect(history.status).toBe("success");
    expect(history.check_count).toBe(1);
    expect(history.image_path).toMatch(/face\.jpg$/);
  });

  it("does not upload an image unless there is exactly one check", async () => {
    const flask = await fakeFlask({ checkCount: 2 });
    const { runner, profileId } = await runnerFixture(flask.apiBaseUrl);

    const result = await runner.enqueue(profileId, "manual");

    expect(result.status).toBe("skipped");
    expect(result.checkCount).toBe(2);
    expect(flask.mobilePosts()).toBe(0);
  });

  it("discards an old scheduled callback after the profile time changes", async () => {
    const flask = await fakeFlask();
    const { db, runner, profileId } = await runnerFixture(flask.apiBaseUrl);

    const result = await runner.enqueue(profileId, "scheduled", {
      expectedScheduleTime: "18:30",
    });

    expect(result).toEqual({ status: "skipped", message: "stale schedule was replaced" });
    expect(flask.mobilePosts()).toBe(0);
    expect(db.prepare("SELECT COUNT(*) AS total FROM run_history").get().total).toBe(0);
  });
});
