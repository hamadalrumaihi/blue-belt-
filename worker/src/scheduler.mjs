import { config } from "./config.mjs";

/**
 * Optional refresh loop. The worker is an always-on process, so it is the
 * natural place to tick the app's cron endpoint every N seconds: the app then
 * refreshes every active athlete of today's events (through this worker)
 * while the photographer's phone is locked. Disabled unless SCHEDULE_SECONDS,
 * APP_URL and CRON_SECRET are all set.
 */
export function startScheduler() {
  const { seconds, appUrl, cronSecret } = config.schedule;
  if (!seconds) return;
  const interval = Math.max(30, seconds) * 1000;
  let running = false;

  async function tick() {
    if (running) return;
    running = true;
    const started = Date.now();
    try {
      const res = await fetch(`${appUrl}/api/cron/refresh`, {
        method: "POST",
        headers: { authorization: `Bearer ${cronSecret}`, "content-type": "application/json" },
        body: "{}",
        signal: AbortSignal.timeout(Math.max(interval - 1000, 20_000)),
      });
      const body = await res.json().catch(() => ({}));
      console.log(`[schedule] ${res.status} ${JSON.stringify(body).slice(0, 200)} ${Date.now() - started}ms`);
    } catch (err) {
      console.error(`[schedule] failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      running = false;
    }
  }

  console.log(`[schedule] every ${interval / 1000}s -> ${appUrl}/api/cron/refresh`);
  setTimeout(tick, 5_000);
  setInterval(tick, interval);
}
