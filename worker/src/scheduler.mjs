import { config } from "./config.mjs";
import { log } from "./log.mjs";
import { runPictimeIntake } from "./pictime-intake.mjs";

/**
 * Optional loops. The worker is an always-on process, so it is the natural
 * place to tick the app's protected job endpoints:
 *   - /api/cron/refresh every SCHEDULE_SECONDS: refreshes every active athlete
 *     of today's events (through this worker) while phones are locked;
 *   - /api/cron/deliveries every DELIVERY_SECONDS: the independent notification
 *     runner (pre-match reminders + lease-claimed Telegram sends with backoff);
 *   - /api/cron/payments every PAYMENTS_SECONDS: photo-order payment jobs;
 *   - /api/cron/ops-health every OPS_HEALTH_SECONDS: ops self-checks that
 *     queue [System] alerts (silent order intake).
 * Both are disabled unless APP_URL and CRON_SECRET are set; each tick never
 * overlaps itself (a slow tick is skipped, not queued).
 *
 * The refresh endpoint processes one page per call and reports `remaining`
 * and a `cursor`; a tick follows the cursor until nothing remains (bounded).
 */
const MAX_PAGES_PER_TICK = 10;

// A refresh page can run until the endpoint's hard limit (maxDuration = 300s
// on /api/cron/refresh: its 240s budget is only checked between sub-batches, and
// a sub-batch may wait on the browser worker for minutes). The per-request abort
// must exceed that, NOT the tick interval — otherwise a slow page is aborted, the
// cursor is dropped and the sweep re-hits page one forever. The non-overlap
// `running` guard handles cadence; a request may safely span several intervals.
const REFRESH_REQUEST_TIMEOUT_MS = 310_000;

export function startScheduler(deps = {}) {
  const { seconds, appUrl, cronSecret, deliverySeconds, paymentsSeconds, pictimeIntakeSeconds } = config.schedule;
  const { seconds, appUrl, cronSecret, deliverySeconds, paymentsSeconds, opsSeconds } = config.schedule;
  const fetchImpl = deps.fetch ?? fetch;
  const handles = [];

  if (seconds && appUrl && cronSecret) {
    const interval = Math.max(30, seconds) * 1000;
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
            signal: AbortSignal.timeout(REFRESH_REQUEST_TIMEOUT_MS),
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
    handles.push({ name: "refresh", tick, first: setTimeout(tick, 5_000), timer: setInterval(tick, interval) });
  }

  if (deliverySeconds && appUrl && cronSecret) {
    const interval = Math.max(15, deliverySeconds) * 1000;
    let running = false;
    async function tick() {
      if (running) return;
      running = true;
      const started = Date.now();
      try {
        const res = await fetchImpl(`${appUrl}/api/cron/deliveries`, {
          method: "POST",
          headers: { authorization: `Bearer ${cronSecret}`, "content-type": "application/json" },
          body: "{}",
          signal: AbortSignal.timeout(55_000),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) log.warn("deliveries.tick_failed", { status: res.status, code: body.code, elapsedMs: Date.now() - started });
        else if (body.sent || body.failed || body.retried || body.reminders?.planned) log.info("deliveries.tick", { sent: body.sent, retried: body.retried, failed: body.failed, skipped: body.skipped, reminders: body.reminders?.planned ?? 0, elapsedMs: Date.now() - started });
      } catch (err) {
        log.error("deliveries.error", { error: err instanceof Error ? err.message : String(err), elapsedMs: Date.now() - started });
      } finally {
        running = false;
      }
    }
    log.info("deliveries.enabled", { everySeconds: interval / 1000, target: `${appUrl}/api/cron/deliveries` });
    handles.push({ name: "deliveries", tick, first: setTimeout(tick, 10_000), timer: setInterval(tick, interval) });
  }

  if (paymentsSeconds && appUrl && cronSecret) {
    const interval = Math.max(60, paymentsSeconds) * 1000;
    let running = false;
    async function tick() {
      if (running) return;
      running = true;
      const started = Date.now();
      try {
        const res = await fetchImpl(`${appUrl}/api/cron/payments`, { method: "POST", headers: { authorization: `Bearer ${cronSecret}`, "content-type": "application/json" }, body: "{}", signal: AbortSignal.timeout(55_000) });
        const body = await res.json().catch(() => ({}));
        if (res.status === 404) log.info("payments.tick_skipped", { reason: "payments disabled on the app" });
        else if (!res.ok) log.warn("payments.tick_failed", { status: res.status, code: body.code, elapsedMs: Date.now() - started });
        else log.info("payments.tick", { replay: body.replay, reconcile: body.reconcile, elapsedMs: Date.now() - started });
      } catch (err) {
        log.error("payments.error", { error: err instanceof Error ? err.message : String(err), elapsedMs: Date.now() - started });
      } finally {
        running = false;
      }
    }
    log.info("payments.enabled", { everySeconds: interval / 1000, target: `${appUrl}/api/cron/payments` });
    handles.push({ name: "payments", tick, first: setTimeout(tick, 15_000), timer: setInterval(tick, interval) });
  }

  // Pic-Time dashboard intake runs in this process (it needs the worker's own
  // Pic-Time session), off unless both PICTIME_INTAKE_SECONDS and
  // PICTIME_INTAKE_ENABLED=1 are set. Never overlaps itself; the run shares the
  // approval job's session lock.
  if (pictimeIntakeSeconds && process.env.PICTIME_INTAKE_ENABLED === "1") {
    const intakeImpl = deps.runPictimeIntake ?? runPictimeIntake;
    const interval = Math.max(300, pictimeIntakeSeconds) * 1000;
  if (opsSeconds && appUrl && cronSecret) {
    const interval = Math.max(300, opsSeconds) * 1000;
    let running = false;
    async function tick() {
      if (running) return;
      running = true;
      try {
        await intakeImpl();
      } catch (err) {
        log.error("pictime_intake.error", { error: err instanceof Error ? err.name : "error" });
      const started = Date.now();
      try {
        const res = await fetchImpl(`${appUrl}/api/cron/ops-health`, { method: "POST", headers: { authorization: `Bearer ${cronSecret}`, "content-type": "application/json" }, body: "{}", signal: AbortSignal.timeout(30_000) });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) log.warn("ops.tick_failed", { status: res.status, code: body.code, elapsedMs: Date.now() - started });
        else if (body.intake?.queued) log.info("ops.tick", { alerts: body.intake.alerts, queued: body.intake.queued, elapsedMs: Date.now() - started });
      } catch (err) {
        log.error("ops.error", { error: err instanceof Error ? err.message : String(err), elapsedMs: Date.now() - started });
      } finally {
        running = false;
      }
    }
    log.info("pictime_intake.enabled", { everySeconds: interval / 1000, post: process.env.PICTIME_INTAKE_POST === "1" });
    handles.push({ name: "pictime-intake", tick, first: setTimeout(tick, 60_000), timer: setInterval(tick, interval) });
    log.info("ops.enabled", { everySeconds: interval / 1000, target: `${appUrl}/api/cron/ops-health` });
    handles.push({ name: "ops", tick, first: setTimeout(tick, 20_000), timer: setInterval(tick, interval) });
  }

  if (!handles.length) return null;
  return {
    tick: () => handles.find((h) => h.name === "refresh")?.tick(),
    tickDeliveries: () => handles.find((h) => h.name === "deliveries")?.tick(),
    tickPayments: () => handles.find((h) => h.name === "payments")?.tick(),
    tickPictimeIntake: () => handles.find((h) => h.name === "pictime-intake")?.tick(),
    tickOps: () => handles.find((h) => h.name === "ops")?.tick(),
    stop: () => {
      for (const h of handles) {
        clearTimeout(h.first);
        clearInterval(h.timer);
      }
    },
  };
}
