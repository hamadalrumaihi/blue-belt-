import { beforeEach, describe, expect, it } from "vitest";
import { RULES, rateLimit, rateLimitHeaders, resetRateLimits } from "@/lib/rate-limit";

const T0 = Date.parse("2026-03-14T07:00:00.000Z");
const RULE = { max: 3, windowMs: 60_000 };

beforeEach(() => resetRateLimits());

describe("rateLimit", () => {
  it("allows `max` hits per window, then blocks with a retry-after", () => {
    expect(rateLimit("u1", RULE, T0)).toEqual({ ok: true, remaining: 2, retryAfterSeconds: 0, limit: 3 });
    expect(rateLimit("u1", RULE, T0 + 1_000)).toEqual({ ok: true, remaining: 1, retryAfterSeconds: 0, limit: 3 });
    expect(rateLimit("u1", RULE, T0 + 2_000)).toEqual({ ok: true, remaining: 0, retryAfterSeconds: 0, limit: 3 });
    const blocked = rateLimit("u1", RULE, T0 + 10_000);
    expect(blocked).toEqual({ ok: false, remaining: 0, retryAfterSeconds: 50, limit: 3 });
    // Still blocked just before the oldest hit leaves the window; retry-after never drops below 1 s.
    expect(rateLimit("u1", RULE, T0 + 59_900)).toEqual({ ok: false, remaining: 0, retryAfterSeconds: 1, limit: 3 });
  });

  it("resets as hits slide out of the window", () => {
    for (let i = 0; i < 3; i++) rateLimit("u1", RULE, T0 + i * 1_000);
    expect(rateLimit("u1", RULE, T0 + 59_999).ok).toBe(false);
    // The hit at T0 leaves the window at exactly T0 + windowMs (the cutoff is exclusive).
    expect(rateLimit("u1", RULE, T0 + 60_000)).toMatchObject({ ok: true, remaining: 0 });
    expect(rateLimit("u1", RULE, T0 + 61_000)).toMatchObject({ ok: true, remaining: 0 });
    expect(rateLimit("u1", RULE, T0 + 61_500)).toEqual({ ok: false, remaining: 0, retryAfterSeconds: 1, limit: 3 });
  });

  it("keeps keys independent and resetRateLimits clears everything", () => {
    for (let i = 0; i < 3; i++) rateLimit("u1", RULE, T0);
    expect(rateLimit("u1", RULE, T0).ok).toBe(false);
    expect(rateLimit("u2", RULE, T0)).toMatchObject({ ok: true, remaining: 2 });
    resetRateLimits();
    expect(rateLimit("u1", RULE, T0)).toMatchObject({ ok: true, remaining: 2 });
  });

  it("sweeps stale buckets without affecting live ones", () => {
    rateLimit("old", RULE, T0);
    rateLimit("live", RULE, T0 + 50_000);
    // A sweep runs at most once a minute; after it, "old" is gone and "live" survives.
    expect(rateLimit("live", RULE, T0 + 61_000)).toMatchObject({ ok: true, remaining: 1 });
    expect(rateLimit("old", RULE, T0 + 61_000)).toMatchObject({ ok: true, remaining: 2 });
  });

  it("rateLimitHeaders include retry-after only when blocked", () => {
    expect(rateLimitHeaders({ ok: true, remaining: 4, retryAfterSeconds: 0, limit: 5 })).toEqual({ "x-ratelimit-limit": "5", "x-ratelimit-remaining": "4" });
    expect(rateLimitHeaders({ ok: false, remaining: 0, retryAfterSeconds: 12, limit: 5 })).toEqual({ "x-ratelimit-limit": "5", "x-ratelimit-remaining": "0", "retry-after": "12" });
  });

  it("ships sensible rules", () => {
    expect(RULES.previewPerUser).toEqual({ max: 20, windowMs: 60_000 });
    expect(RULES.watchPerUser.max).toBeGreaterThan(RULES.previewPerUser.max);
    expect(RULES.cron.max).toBeGreaterThan(0);
  });
});
