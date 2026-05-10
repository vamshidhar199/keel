export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { runMigrations } = await import("./lib/migrate");
    await runMigrations();

    const { resetStuckJobs } = await import("./lib/queue");
    await resetStuckJobs();

    const { schedulerTick } = await import("./lib/sync");

    // Run once on startup to catch up if cron missed anything during downtime.
    // The recurring schedule is now driven by Railway Cron hitting
    // POST /api/cron/scheduler-tick (in-process setInterval was unreliable
    // because Railway suspends idle containers).
    void schedulerTick();
  }
}
