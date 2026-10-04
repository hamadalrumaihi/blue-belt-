/**
 * Pure scheduling for the capture loop. One job per source identity; a job is
 * due when its interval has passed since its last START. Missed intervals
 * are never caught up: the next due time is computed from "now", so a laptop
 * that slept for an hour captures once, not sixty times.
 */

export function createSchedule(intervalMs) {
  const jobs = new Map(); // sourceKey -> { job, lastStartedAt, lastOutcome }
  return {
    /** Replace the job set from the server; known jobs keep their timing. */
    setJobs(list) {
      const keep = new Set();
      for (const job of list) {
        keep.add(job.sourceKey);
        const existing = jobs.get(job.sourceKey);
        if (existing) existing.job = job;
        else jobs.set(job.sourceKey, { job, lastStartedAt: null, lastOutcome: null });
      }
      for (const key of [...jobs.keys()]) if (!keep.has(key)) jobs.delete(key);
    },
    /** Jobs never run or whose interval has elapsed, never-run first then oldest first. */
    due(now) {
      return [...jobs.values()]
        .filter((e) => e.lastStartedAt === null || now - e.lastStartedAt >= intervalMs)
        .sort((a, b) => (a.lastStartedAt ?? -1) - (b.lastStartedAt ?? -1))
        .map((e) => e.job);
    },
    markStarted(sourceKey, now) {
      const e = jobs.get(sourceKey);
      if (e) e.lastStartedAt = now;
    },
    markOutcome(sourceKey, outcome) {
      const e = jobs.get(sourceKey);
      if (e) e.lastOutcome = outcome;
    },
    size() {
      return jobs.size;
    },
    snapshot() {
      return [...jobs.values()].map((e) => ({ sourceKey: e.job.sourceKey, lastStartedAt: e.lastStartedAt, lastOutcome: e.lastOutcome }));
    },
  };
}

/** Exponential backoff with full jitter, bounded; `retryAfterMs` (server hint) is a floor. */
export function backoffMs(attempt, { baseMs = 2_000, maxMs = 5 * 60_000, retryAfterMs = 0, random = Math.random } = {}) {
  const exp = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
  const jittered = Math.round(exp * (0.5 + random() * 0.5));
  return Math.max(jittered, retryAfterMs);
}

/** Parses a Retry-After header (seconds or HTTP date) into milliseconds from `now`. */
export function retryAfterMs(header, now = Date.now()) {
  if (!header) return 0;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(header);
  return Number.isFinite(at) ? Math.max(0, at - now) : 0;
}

/**
 * What to do with an upload response. Terminal outcomes delete the spooled
 * capture (the server has a durable verdict); retryable ones keep it.
 *   2xx                      applied / replayed
 *   400, 403, 404, 409, 422  the server refused this capture for good (stale, out of scope, no clients…)
 *   401 CREDENTIAL_EXPIRED / CREDENTIAL_REVOKED  stop the agent
 *   429, 5xx, network        retry with backoff
 */
export function classifyUpload(status, body) {
  if (status >= 200 && status < 300) return { kind: "applied" };
  if (status === 401) {
    const code = body && typeof body.code === "string" ? body.code : "UNAUTHORIZED";
    return code === "CREDENTIAL_EXPIRED" || code === "CREDENTIAL_REVOKED" ? { kind: "stop", code } : { kind: "retry", code };
  }
  if (status === 429 || status >= 500 || status === 0) return { kind: "retry", code: body?.code ?? `HTTP_${status}` };
  if ([400, 403, 404, 409, 413, 422].includes(status)) return { kind: "refused", code: body?.code ?? `HTTP_${status}` };
  return { kind: "retry", code: body?.code ?? `HTTP_${status}` };
}
