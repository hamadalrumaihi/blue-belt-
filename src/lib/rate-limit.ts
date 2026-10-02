/**
 * Small in-memory sliding-window limiter for Route Handlers.
 *
 * Scope: one Node process. On Vercel each warm function instance keeps its own
 * window, so the effective limit is "per instance", which is enough to stop a
 * runaway tab or script from hammering the sources through this app. Hard
 * limits on the expensive parts (batch size, per-athlete cooldown, worker
 * concurrency) live elsewhere and do not depend on this module.
 */

export type RateLimitRule = { max: number; windowMs: number };

export type RateLimitDecision = {
  ok: boolean;
  remaining: number;
  /** Seconds until the oldest hit leaves the window (only meaningful when !ok). */
  retryAfterSeconds: number;
  limit: number;
};

const buckets = new Map<string, number[]>();
let lastSweep = 0;

export function rateLimit(key: string, rule: RateLimitRule, now = Date.now()): RateLimitDecision {
  sweep(now, rule.windowMs);
  const cutoff = now - rule.windowMs;
  const hits = (buckets.get(key) ?? []).filter((t) => t > cutoff);
  if (hits.length >= rule.max) {
    buckets.set(key, hits);
    const retryAfterSeconds = Math.max(1, Math.ceil((hits[0] + rule.windowMs - now) / 1000));
    return { ok: false, remaining: 0, retryAfterSeconds, limit: rule.max };
  }
  hits.push(now);
  buckets.set(key, hits);
  return { ok: true, remaining: rule.max - hits.length, retryAfterSeconds: 0, limit: rule.max };
}

function sweep(now: number, windowMs: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, hits] of buckets) {
    const live = hits.filter((t) => t > now - windowMs);
    if (live.length) buckets.set(key, live);
    else buckets.delete(key);
  }
}

/** Test hook. */
export function resetRateLimits(): void {
  buckets.clear();
  lastSweep = 0;
}

export function rateLimitHeaders(d: RateLimitDecision): Record<string, string> {
  const h: Record<string, string> = { "x-ratelimit-limit": String(d.limit), "x-ratelimit-remaining": String(d.remaining) };
  if (!d.ok) h["retry-after"] = String(d.retryAfterSeconds);
  return h;
}

/** Rules for the app's endpoints. */
export const RULES = {
  /** Manual + auto refresh per signed-in user. 60 s auto loop + taps fit comfortably. */
  watchPerUser: { max: 40, windowMs: 60_000 } satisfies RateLimitRule,
  /** Link previews (Test link) per user. */
  previewPerUser: { max: 20, windowMs: 60_000 } satisfies RateLimitRule,
  /** Page imports (hand-over from the photographer's own browser) per user. */
  importPerUser: { max: 20, windowMs: 60_000 } satisfies RateLimitRule,
  /** Unauthenticated hand-over endpoint, per client address. */
  importReceivePerIp: { max: 30, windowMs: 60_000 } satisfies RateLimitRule,
  /** Scheduled refresh endpoint (shared secret, but still bounded). */
  cron: { max: 12, windowMs: 60_000 } satisfies RateLimitRule,
};
