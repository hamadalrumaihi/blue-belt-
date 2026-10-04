import { randomUUID } from "node:crypto";
import os from "node:os";
import { readConfig, validateConfig } from "./config.mjs";
import { log, say } from "./log.mjs";
import { createSchedule } from "./schedule.mjs";
import { createSession } from "./session.mjs";
import { createSpool } from "./spool.mjs";
import { createUploader } from "./uploader.mjs";

/**
 * Blue Belt Media — capture agent (Windows event laptop).
 *
 * Loop, once a minute (never overlapping):
 *   1. replay the spool (captures the server has not acknowledged yet)
 *   2. refresh the job list from the app every few minutes
 *   3. for each due source: capture the tab → spool → upload → delete on verdict
 *   4. heartbeat
 * A human check in the browser pauses captures until the window shows the
 * page again; an expired or revoked credential stops the agent with a message.
 * Ctrl+C / window close shuts down cleanly; the spool survives restarts.
 */
export async function runAgent(config, deps = {}) {
  const uploader = deps.uploader ?? createUploader({ appUrl: config.appUrl, token: config.token, version: config.version, log });
  const spool = deps.spool ?? createSpool(config.spoolDir, { maxFiles: config.maxSpoolFiles });
  const session = deps.session ?? createSession(config, log);
  const schedule = createSchedule(config.intervalSeconds * 1000);
  const sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const nowFn = deps.now ?? (() => Date.now());

  const state = { phase: "starting", pausedReason: null, pausedKey: null, lastCaptureAt: null, lastError: null, captures: 0, failures: 0, jobsAt: 0, lastHeartbeatAt: 0, stopping: false, stopReason: null, started: nowFn() };
  const stop = (reason) => {
    state.stopping = true;
    state.stopReason = reason;
  };
  // Lets the process's signal handler ask for a clean stop (finish the step, keep the spool).
  deps.registerStop?.((reason) => stop(reason));

  async function replaySpool() {
    for (const capture of spool.list()) {
      if (state.stopping) return;
      const verdict = await uploader.upload(capture);
      if (verdict.kind === "applied" || verdict.kind === "refused") {
        spool.remove(capture.captureId);
        log.info(verdict.kind === "applied" ? "upload.applied" : "upload.refused", { captureId: capture.captureId, code: verdict.code ?? null, replayed: verdict.body?.capture?.replayed ?? false, matched: verdict.body?.matched ?? null });
        if (verdict.kind === "applied") state.lastCaptureAt = new Date(nowFn()).toISOString();
      } else if (verdict.kind === "stop") {
        stop(verdict.code);
        return;
      } else {
        spool.update(capture.captureId, { attempts: verdict.attempt, lastError: verdict.code });
        state.lastError = verdict.code;
        log.warn("upload.retry", { captureId: capture.captureId, attempt: verdict.attempt, code: verdict.code, delayMs: verdict.delayMs });
        // The server (or the network) is unhappy: do not hammer it with the rest of the spool now.
        await sleep(Math.min(verdict.delayMs ?? 2_000, 30_000));
        return;
      }
    }
  }

  async function refreshJobs(force = false) {
    if (!force && nowFn() - state.jobsAt < config.jobsRefreshSeconds * 1000) return;
    const res = await uploader.jobs();
    if (res && res.stop) return stop(res.stop);
    if (!res) return;
    state.jobsAt = nowFn();
    schedule.setJobs(res.jobs);
    log.info("jobs.loaded", { jobs: res.jobs.length, intervalSeconds: res.intervalSeconds });
    if (!res.jobs.length) say("No clients to watch right now (no active event today). The agent keeps checking every few minutes.");
  }

  async function captureDue() {
    const now = nowFn();
    for (const job of schedule.due(now)) {
      if (state.stopping) return;
      if (state.pausedReason) return;
      schedule.markStarted(job.sourceKey, now);
      let result;
      try {
        result = await session.capture(job);
      } catch (err) {
        result = { ok: false, code: "SESSION_ERROR", message: err instanceof Error ? err.message : String(err) };
      }
      if (!result.ok) {
        schedule.markOutcome(job.sourceKey, result.code);
        state.failures += 1;
        if (result.code === "CHALLENGE") {
          state.pausedReason = "human check";
          state.pausedKey = job.sourceKey;
          await session.bringToFront(job.sourceKey);
          say("The site is asking for a human check. Solve it in the browser window; capturing resumes automatically.");
          log.warn("capture.paused", { sourceKey: job.sourceKey, reason: "CHALLENGE" });
          return;
        }
        log.warn("capture.failed", { sourceKey: job.sourceKey, code: result.code, readiness: result.readiness ?? null, message: result.message ?? null });
        continue;
      }
      const capture = { captureId: randomUUID(), url: job.url, finalUrl: result.finalUrl, capturedAt: new Date(now).toISOString(), completeness: result.completeness, readiness: result.readiness, html: result.html, attempts: 0 };
      spool.put(capture); // persist BEFORE any upload
      const verdict = await uploader.upload(capture);
      if (verdict.kind === "applied" || verdict.kind === "refused") {
        spool.remove(capture.captureId);
        schedule.markOutcome(job.sourceKey, verdict.kind === "applied" ? "applied" : verdict.code);
        if (verdict.kind === "applied") {
          state.captures += 1;
          state.lastCaptureAt = new Date(nowFn()).toISOString();
        }
        log.info(verdict.kind === "applied" ? "capture.applied" : "capture.refused", { sourceKey: job.sourceKey, captureId: capture.captureId, code: verdict.code ?? null, matched: verdict.body?.matched ?? null, bytes: capture.html.length });
      } else if (verdict.kind === "stop") {
        return stop(verdict.code);
      } else {
        spool.update(capture.captureId, { attempts: verdict.attempt, lastError: verdict.code });
        state.lastError = verdict.code;
        schedule.markOutcome(job.sourceKey, `queued:${verdict.code}`);
        log.warn("capture.queued", { sourceKey: job.sourceKey, captureId: capture.captureId, code: verdict.code, delayMs: verdict.delayMs });
      }
    }
  }

  async function heartbeat(force = false) {
    if (!force && nowFn() - state.lastHeartbeatAt < config.heartbeatSeconds * 1000) return;
    state.lastHeartbeatAt = nowFn();
    await uploader.heartbeat({
      state: state.pausedReason ? "paused" : state.phase,
      pausedReason: state.pausedReason ?? undefined,
      jobs: schedule.size(),
      spooled: spool.count(),
      lastCaptureAt: state.lastCaptureAt ?? undefined,
      lastError: state.lastError ?? undefined,
      captures: state.captures,
      failures: state.failures,
      uptimeSec: Math.round((nowFn() - state.started) / 1000),
      hostname: os.hostname().slice(0, 60),
    });
  }

  async function tick() {
    if (state.pausedReason && state.pausedKey) {
      if (await session.challengeCleared(state.pausedKey)) {
        say("Human check cleared. Capturing resumes.");
        log.info("capture.resumed", { sourceKey: state.pausedKey });
        state.pausedReason = null;
        state.pausedKey = null;
      }
    }
    await replaySpool();
    if (state.stopping) return;
    await refreshJobs();
    if (state.stopping) return;
    await captureDue();
    if (state.stopping) return;
    await heartbeat();
  }

  state.phase = "running";
  say(`Capture agent started. Jobs come from ${config.appUrl}. Leave this window open during the event; press Ctrl+C to stop.`);
  await refreshJobs(true);

  const tickMs = Math.max(15_000, Math.min(60_000, (config.intervalSeconds * 1000) / 2));
  while (!state.stopping) {
    const startedAt = nowFn();
    try {
      await tick();
    } catch (err) {
      state.lastError = err instanceof Error ? err.message : String(err);
      log.error("tick.failed", { error: state.lastError });
    }
    if (config.once) break;
    if (state.stopping) break;
    const spent = nowFn() - startedAt;
    await sleep(Math.max(1_000, tickMs - spent));
  }

  state.phase = "stopped";
  await heartbeat(true).catch(() => undefined);
  await session.close();
  if (state.stopReason === "CREDENTIAL_EXPIRED") say("The capture credential has expired. Create a new one in Settings → Capture agent, put it in agent.env and start again.");
  else if (state.stopReason === "CREDENTIAL_REVOKED") say("The capture credential was revoked. Nothing more will be sent.");
  else say(`Capture agent stopped${state.stopReason ? ` (${state.stopReason})` : ""}. ${spool.count()} capture(s) still queued will be sent on the next start.`);
  return { ...state, spooled: spool.count() };
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href;
if (isMain) {
  const config = readConfig();
  const problems = validateConfig(config);
  if (problems.length) {
    for (const p of problems) console.error(`Configuration problem: ${p}`);
    console.error("Edit agent.env next to package.json (see agent.env.example) and start again.");
    process.exit(2);
  }
  let wake = null;
  let requestStop = null;
  const run = runAgent(config, {
    registerStop: (fn) => { requestStop = fn; },
    sleep: (ms) => new Promise((resolve) => { const t = setTimeout(resolve, ms); wake = () => { clearTimeout(t); resolve(); }; }),
  });
  const onSignal = (signal) => {
    log.info("agent.shutdown", { signal });
    process.exitCode = 0;
    // Finish the current step, then stop: the spool keeps anything not yet acknowledged.
    requestStop?.(signal);
    wake?.();
  };
  for (const s of ["SIGINT", "SIGTERM", "SIGBREAK"]) process.on(s, () => onSignal(s));
  run.then(() => process.exit(process.exitCode ?? 0)).catch((err) => { log.error("agent.crashed", { error: err instanceof Error ? err.message : String(err) }); process.exit(1); });
}
