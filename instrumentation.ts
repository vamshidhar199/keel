export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { runMigrations } = await import("./lib/migrate");
    await runMigrations();

    const { reapStuckJobs } = await import("./lib/queue/drain");
    await reapStuckJobs();

    const { schedulerTick } = await import("./lib/sync");

    // Run once on startup to catch up if cron missed anything during downtime.
    // The recurring schedule is driven by Railway Cron hitting POST /api/queue/drain.
    void schedulerTick();
  }
}
