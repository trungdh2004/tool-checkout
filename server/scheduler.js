import cron from "node-cron";

const TIME_ZONE = "Asia/Ho_Chi_Minh";

export function cronExpression(scheduleTime) {
  const [hour, minute] = scheduleTime.split(":").map(Number);
  return `0 ${minute} ${hour} * * *`;
}

export function createScheduler({ db, runner, logger = console }) {
  const tasks = new Map();

  function remove(profileId) {
    tasks.get(profileId)?.destroy();
    tasks.delete(profileId);
  }

  function refresh(profileId) {
    remove(profileId);
    const profile = db.prepare(
      "SELECT id, full_name, schedule_time, enabled FROM profiles WHERE id = ? AND deleted_at IS NULL",
    ).get(profileId);
    if (!profile?.enabled) return;

    const task = cron.schedule(
      cronExpression(profile.schedule_time),
      () => {
        runner.enqueue(profile.id, "scheduled", {
          expectedScheduleTime: profile.schedule_time,
        }).catch((error) => {
          logger.error(`scheduled replay failed for ${profile.full_name}:`, error);
        });
      },
      { timezone: TIME_ZONE },
    );
    tasks.set(profile.id, task);
  }

  function start() {
    const profiles = db.prepare(
      "SELECT id FROM profiles WHERE enabled = 1 AND deleted_at IS NULL",
    ).all();
    profiles.forEach(({ id }) => refresh(id));
  }

  function stop() {
    tasks.forEach((task) => task.destroy());
    tasks.clear();
  }

  return { start, stop, refresh, remove };
}
