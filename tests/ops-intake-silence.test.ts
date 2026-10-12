import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { assessIntakeSilence, DEFAULT_SILENCE_HOURS, runIntakeSilenceCheck, silenceThresholdHours, type OrdersCredential } from "@/lib/ops/intake-silence";

const NOW = new Date("2026-10-12T10:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const daysAhead = (d: number) => new Date(NOW.getTime() + d * 86_400_000).toISOString();

function cred(over: Partial<OrdersCredential> = {}): OrdersCredential {
  return { id: "c1", owner_id: "o1", last_used_at: hoursAgo(2), created_at: hoursAgo(24 * 30), expires_at: daysAhead(300), revoked_at: null, ...over };
}

function fakeSupabase(rows: OrdersCredential[], queued = true) {
  const upserts: Array<{ row: Record<string, unknown>; opts: unknown }> = [];
  const filters: unknown[] = [];
  const supabase = {
    from: (table: string) => {
      if (table === "photo_capture_credentials") {
        return { select: () => ({ eq: (col: string, val: string) => { filters.push([col, val]); return { limit: async () => ({ data: rows, error: null }) }; } }) };
      }
      return { upsert: (row: Record<string, unknown>, opts: unknown) => { upserts.push({ row, opts }); return { select: async () => ({ data: queued ? [{ id: "d1" }] : [], error: null }) }; } };
    },
  } as unknown as Parameters<typeof runIntakeSilenceCheck>[0]["supabase"];
  return { supabase, upserts, filters };
}

describe("silenceThresholdHours", () => {
  it("defaults to 7 days, accepts 0 (off) and clamps nonsense", () => {
    expect(silenceThresholdHours({})).toBe(DEFAULT_SILENCE_HOURS);
    expect(silenceThresholdHours({ ORDERS_INTAKE_SILENCE_HOURS: "48" })).toBe(48);
    expect(silenceThresholdHours({ ORDERS_INTAKE_SILENCE_HOURS: "0" })).toBe(0);
    expect(silenceThresholdHours({ ORDERS_INTAKE_SILENCE_HOURS: "-3" })).toBe(DEFAULT_SILENCE_HOURS);
    expect(silenceThresholdHours({ ORDERS_INTAKE_SILENCE_HOURS: "abc" })).toBe(DEFAULT_SILENCE_HOURS);
    expect(silenceThresholdHours({ ORDERS_INTAKE_SILENCE_HOURS: "99999" })).toBe(24 * 90);
  });
});

describe("assessIntakeSilence", () => {
  it("is quiet while orders keep arriving", () => {
    expect(assessIntakeSilence([cred()], NOW, 168)).toEqual([]);
  });

  it("alerts once per silence: the key is the last use, so repeated ticks dedupe and a later order re-arms it", () => {
    const first = assessIntakeSilence([cred({ last_used_at: hoursAgo(200) })], NOW, 168);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ ownerId: "o1", condition: "silent", alertKey: `ops:orders-intake:silent:${hoursAgo(200)}`, title: "No Pic-Time order received for 8 days" });
    const laterTick = assessIntakeSilence([cred({ last_used_at: hoursAgo(200) })], new Date(NOW.getTime() + 15 * 60_000), 168);
    expect(laterTick[0].alertKey).toBe(first[0].alertKey);
    const afterNewOrder = assessIntakeSilence([cred({ last_used_at: hoursAgo(170) })], NOW, 168);
    expect(afterNewOrder[0].alertKey).not.toBe(first[0].alertKey);
  });

  it("uses the newest use across all of an owner's credentials (rotation does not look like silence)", () => {
    const out = assessIntakeSilence([cred({ id: "old", last_used_at: hoursAgo(500), revoked_at: hoursAgo(10) }), cred({ id: "new", last_used_at: hoursAgo(3), created_at: hoursAgo(10) })], NOW, 168);
    expect(out).toEqual([]);
  });

  it("flags an active credential that was never used once it is older than the threshold", () => {
    expect(assessIntakeSilence([cred({ last_used_at: null, created_at: hoursAgo(100) })], NOW, 168)).toEqual([]);
    const out = assessIntakeSilence([cred({ last_used_at: null, created_at: hoursAgo(200) })], NOW, 168);
    expect(out).toMatchObject([{ condition: "never_used", alertKey: "ops:orders-intake:silent:never:c1" }]);
  });

  it("raises no_credential (not silence) when every credential is revoked or expired", () => {
    const out = assessIntakeSilence([cred({ id: "a", revoked_at: hoursAgo(1) }), cred({ id: "b", expires_at: hoursAgo(1), created_at: hoursAgo(10) })], NOW, 168);
    expect(out).toMatchObject([{ condition: "no_credential", alertKey: "ops:orders-intake:no-credential:b" }]);
  });

  it("warns before the active credential lapses, keyed by credential", () => {
    const out = assessIntakeSilence([cred({ expires_at: daysAhead(3) })], NOW, 168);
    expect(out).toMatchObject([{ condition: "expiring", alertKey: "ops:orders-intake:expiring:c1", title: "Order intake credential expires in 3 days" }]);
    expect(assessIntakeSilence([cred({ expires_at: daysAhead(3) }), cred({ id: "c2", expires_at: daysAhead(200) })], NOW, 168)).toEqual([]);
  });

  it("threshold 0 turns the silence alert off but keeps credential alerts", () => {
    expect(assessIntakeSilence([cred({ last_used_at: hoursAgo(5000) })], NOW, 0)).toEqual([]);
    expect(assessIntakeSilence([cred({ revoked_at: hoursAgo(1) })], NOW, 0)).toHaveLength(1);
  });

  it("keeps owners apart and never puts buyer data or tokens in the message", () => {
    const out = assessIntakeSilence([cred({ owner_id: "o1", last_used_at: hoursAgo(300) }), cred({ owner_id: "o2", id: "c9" })], NOW, 168);
    expect(out.map((a) => a.ownerId)).toEqual(["o1"]);
    expect(JSON.stringify(out)).not.toMatch(/bbmo_|@/);
  });
});

describe("runIntakeSilenceCheck", () => {

  it("reads orders credentials only and queues one idempotent [System] row per alert", async () => {
    const { supabase, upserts, filters } = fakeSupabase([cred({ last_used_at: hoursAgo(200) })]);
    const out = await runIntakeSilenceCheck({ supabase, now: NOW, site: "https://app.test", thresholdHours: 168 });
    expect(filters).toEqual([["kind", "orders"]]);
    expect(out).toEqual({ owners: 1, alerts: 1, queued: 1, conditions: { silent: 1 } });
    expect(upserts[0].row).toMatchObject({ owner_id: "o1", channel: "telegram", kind: "INTEGRATION_FAILED", category: "system", alert_key: `ops:orders-intake:silent:${hoursAgo(200)}` });
    expect(JSON.stringify(upserts[0].row)).toContain("Open: https://app.test/settings");
    expect(upserts[0].opts).toMatchObject({ onConflict: "owner_id,channel,alert_key", ignoreDuplicates: true });
  });

  it("counts a duplicate (already alerted) as not queued", async () => {
    const { supabase } = fakeSupabase([cred({ last_used_at: hoursAgo(200) })], false);
    expect(await runIntakeSilenceCheck({ supabase, now: NOW, site: "https://app.test", thresholdHours: 168 })).toMatchObject({ alerts: 1, queued: 0 });
  });
});

vi.mock("@/lib/supabase/service", () => ({ isServiceClientConfigured: vi.fn(() => true), createServiceClient: vi.fn(() => ({})) }));
vi.mock("@/lib/jobs/heartbeat", () => ({ JOB_NAMES: { ops: "ops" }, recordJobHeartbeat: vi.fn(async () => {}) }));

describe("POST /api/cron/ops-health", () => {
  const SECRET = "cron-secret-0123456789";
  beforeEach(async () => {
    (await import("@/lib/rate-limit")).resetRateLimits();
    vi.stubEnv("CRON_SECRET", SECRET);
    vi.stubEnv("ORDERS_INTAKE_ENABLED", "1");
  });
  afterEach(() => vi.unstubAllEnvs());

  async function post(auth: string | null = `Bearer ${SECRET}`) {
    const { POST } = await import("@/app/api/cron/ops-health/route");
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (auth) headers.authorization = auth;
    return POST(new Request("http://localhost/api/cron/ops-health", { method: "POST", body: "{}", headers }));
  }

  it("requires the cron secret", async () => {
    expect((await post(null)).status).toBe(401);
    expect((await post("Bearer wrong")).status).toBe(401);
  });

  it("is a no-op while the intake is switched off", async () => {
    vi.stubEnv("ORDERS_INTAKE_ENABLED", "0");
    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, intake: { enabled: false } });
  });

  it("runs the check with the configured threshold and reports counts only", async () => {
    vi.stubEnv("ORDERS_INTAKE_SILENCE_HOURS", "48");
    const service = await import("@/lib/supabase/service");
    const { supabase } = fakeSupabase([cred({ last_used_at: hoursAgo(60) })]);
    vi.mocked(service.createServiceClient).mockReturnValue(supabase as never);
    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, intake: { enabled: true, thresholdHours: 48, owners: 1, alerts: 1, queued: 1 } });
  });

  it("answers 500 without details when the credentials cannot be read", async () => {
    const service = await import("@/lib/supabase/service");
    vi.mocked(service.createServiceClient).mockReturnValue({ from: () => ({ select: () => ({ eq: () => ({ limit: async () => ({ data: null, error: { message: "db down" } }) }) }) }) } as never);
    const res = await post();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, code: "CHECK_FAILED", checkedAt: expect.any(String) });
  });
});
