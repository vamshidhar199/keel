export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { runMigrations } = await import("./lib/migrate");
    await runMigrations();

    const { resetStuckJobs } = await import("./lib/queue");
    await resetStuckJobs();

    const { schedulerTick } = await import("./lib/sync");

    // Run immediately on startup, then every 30 minutes.
    void schedulerTick();
    setInterval(() => void schedulerTick(), 30 * 60 * 1000);
  }
}
