import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLogSink } from "@/lib/log";
import { resetRateLimits } from "@/lib/rate-limit";
import { FakeSupabase } from "./payments/fake-supabase";
import { OWNER, booking } from "./payments/fixtures";

vi.mock("server-only", () => ({}));
const db = new FakeSupabase();
vi.mock("@/lib/supabase/service", () => ({ isServiceClientConfigured: () => true, createServiceClient: () => db.asClient() }));
setLogSink(() => {});

import { POST } from "@/app/api/cron/pricing/route";

const CRON = "cron-secret-0123456789";
const BOOKING = "22222222-2222-4222-8222-222222222222";

function post(auth: string | null = `Bearer ${CRON}`) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (auth) headers.authorization = auth;
  return POST(new Request("https://example.test/api/cron/pricing", { method: "POST", headers, body: "{}" }));
}

beforeEach(() => {
  resetRateLimits();
  vi.stubEnv("CRON_SECRET", CRON);
  vi.stubEnv("PRICING_RESEARCH_ENABLED", "");
  vi.stubEnv("PRICING_RESEARCH_API_KEY", "");
  for (const t of ["photo_bookings", "photo_pricing_assessments", "photo_price_references", "photo_services", "photo_events", "photo_leads", "photo_job_heartbeats"]) db.tables[t] = [];
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/cron/pricing", () => {
  it("requires the cron secret", async () => {
    expect((await post(null)).status).toBe(401);
    expect((await post("Bearer nope")).status).toBe(401);
  });

  it("computes queued assessments and reports research as disabled / not configured, never as done", async () => {
    db.seed("photo_bookings", [booking({ id: BOOKING, booking_type: "club", booking_status: "inquiry", details: { athlete_count: 10, wants_photographer: true, hours_on_site: 6 } }) as unknown as Record<string, unknown>]);
    db.seed("photo_pricing_assessments", [{ owner_id: OWNER, booking_id: BOOKING, lead_id: null, version: 1, status: "queued", request_fingerprint: "abc", request_snapshot: {}, created_at: "2026-10-15T08:00:00.000Z" }]);
    db.seed("photo_price_references", [{ id: "r1", owner_id: OWNER, provider: "Old", service_type: "custom", price_from: 1000, price_to: null, currency: "QAR", includes: {}, observed_on: "2024-01-01", checked_on: "2024-01-01", source_type: "provider_site", confidence: "likely", region: "qatar", excluded: false, superseded_by: null, promotion_expires_on: null }]);
    const res = await post();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, processed: { scanned: 1, ready: 1, failed: 0 }, research: { status: "disabled", refreshed: 0 }, stale: { scanned: 1, needsReverification: 1 } });
    expect(db.tables.photo_pricing_assessments[0]).toMatchObject({ status: "ready" });
    expect(db.tables.photo_job_heartbeats[0]).toMatchObject({ name: "pricing", ok: true, summary: { scanned: 1, ready: 1, failed: 0, research: "disabled" } });
    expect(JSON.stringify(db.tables.photo_job_heartbeats[0])).not.toMatch(/recommend|price_from|customer/);

    vi.stubEnv("PRICING_RESEARCH_ENABLED", "1");
    const again = await (await post()).json();
    expect(again.research).toMatchObject({ status: "not_configured", refreshed: 0 });
    expect(again.research.reason).toMatch(/PRICING_RESEARCH_API_KEY/);

    vi.stubEnv("PRICING_RESEARCH_API_KEY", "key");
    const withKey = await (await post()).json();
    expect(withKey.research).toMatchObject({ status: "not_configured", refreshed: 0 });
    expect(withKey.research.reason).toMatch(/adapter/i);
  });

  it("marks a queued assessment failed when its booking is gone, and carries on", async () => {
    db.seed("photo_pricing_assessments", [{ owner_id: OWNER, booking_id: BOOKING, lead_id: null, version: 1, status: "queued", request_fingerprint: "abc", request_snapshot: {}, created_at: "2026-10-15T08:00:00.000Z" }]);
    const body = await (await post()).json();
    expect(body.processed).toMatchObject({ scanned: 1, failed: 1 });
    expect(db.tables.photo_pricing_assessments[0]).toMatchObject({ status: "failed", error: expect.stringMatching(/no longer exists/) });
  });
});
