import { config } from "./config.mjs";
import { log } from "./log.mjs";

/**
 * Optional refresh loop. The worker is an always-on process, so it is the
 * natural place to tick the app's cron endpoint every N seconds: the app then
 * refreshes every active athlete of today's events (through this worker)
 * while the photographer's phone is locked. Disabled unless SCHEDULE_SECONDS,
 * APP_URL and CRON_SECRET are all set.
 *
 * The cron endpoint processes one page per call and reports `remaining` and
 * a `cursor`; a tick follows the cursor until nothing remains (bounded).
 */
const MAX_PAGES_PER_TICK = 10;

export function startScheduler(deps = {}) {
  const { seconds, appUrl, cronSecret } = config.schedule;
  if (!seconds) return null;
  const interval = Math.max(30, seconds) * 1000;
  const fetchImpl = deps.fetch ?? fetch;
  let running = false;

  async function tick() {
    if (running) return;
    running = true;
    const started = Date.now();
    let cursor = null;
    let pages = 0;
    const totals = { processed: 0, failed: 0, skipped: 0, changes: 0, remaining: 0 };
    try {
      do {
        const res = await fetchImpl(`${appUrl}/api/cron/refresh`, {
          method: "POST",
          headers: { authorization: `Bearer ${cronSecret}`, "content-type": "application/json" },
          body: JSON.stringify(cursor ? { cursor } : {}),
          signal: AbortSignal.timeout(Math.max(interval - 1000, 20_000)),
        });
        const body = await res.json().catch(() => ({}));
        pages += 1;
        if (!res.ok) {
          log.warn("schedule.tick_failed", { status: res.status, code: body.code, pages, elapsedMs: Date.now() - started });
          break;
        }
        for (const k of ["processed", "failed", "skipped", "changes"]) totals[k] += Number(body[k] ?? 0);
        totals.remaining = Number(body.remaining ?? 0);
        cursor = totals.remaining > 0 && body.cursor ? body.cursor : null;
      } while (cursor && pages < MAX_PAGES_PER_TICK);
      log.info("schedule.tick", { ...totals, pages, elapsedMs: Date.now() - started });
    } catch (err) {
      log.error("schedule.error", { error: err instanceof Error ? err.message : String(err), pages, elapsedMs: Date.now() - started });
    } finally {
      running = false;
    }
  }

  log.info("schedule.enabled", { everySeconds: interval / 1000, target: `${appUrl}/api/cron/refresh` });
  const first = setTimeout(tick, 5_000);
  const timer = setInterval(tick, interval);
  return { tick, stop: () => { clearTimeout(first); clearInterval(timer); } };
}
