import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLogSink } from "@/lib/log";
import { resetRateLimits } from "@/lib/rate-limit";
import { buildSignaturePayload } from "@/lib/payments/myfatoorah/signature";
import { FakeSupabase } from "./fake-supabase";
import { BOOKING_ID, SECRET, booking, paymentEvent } from "./fixtures";

vi.mock("server-only", () => ({}));

const db = new FakeSupabase();
vi.mock("@/lib/supabase/service", () => ({
  isServiceClientConfigured: () => true,
  createServiceClient: () => db.asClient(),
}));

setLogSink(() => {});

const ENV = { PAYMENTS_MYFATOORAH_ENABLED: "1", MYFATOORAH_API_KEY: "sk_test", MYFATOORAH_WEBHOOK_SECRET: SECRET };

function post(body: string, signature?: string) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (signature !== undefined) headers["MyFatoorah-Signature"] = signature;
  return new Request("https://example.test/api/payments/myfatoorah/webhook", { method: "POST", headers, body });
}
const sign = (body: Record<string, unknown>) => createHmac("sha256", SECRET).update(buildSignaturePayload(body)!).digest("base64");

async function loadRoute() {
  vi.resetModules();
  // The route pulls a fresh logger module after the reset; silence that one too.
  (await import("@/lib/log")).setLogSink(() => {});
  return import("@/app/api/payments/myfatoorah/webhook/route");
}

describe("POST /api/payments/myfatoorah/webhook", () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of Object.keys(ENV)) saved[k] = process.env[k];
    Object.assign(process.env, ENV);
    db.tables.photo_bookings = [booking()];
    db.tables.photo_payment_events = [];
    db.tables.photo_payment_attempts = [];
    db.calls = [];
    resetRateLimits();
  });
  afterEach(() => {
    for (const k of Object.keys(ENV)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("answers 404 when the feature flag is off, even with valid secrets", async () => {
    process.env.PAYMENTS_MYFATOORAH_ENABLED = "0";
    const { POST } = await loadRoute();
    const res = await POST(post(JSON.stringify(paymentEvent()), sign(paymentEvent())));
    expect(res.status).toBe(404);
    expect(db.tables.photo_payment_events).toHaveLength(0);
  });

  it("answers 404 when a secret is missing", async () => {
    process.env.MYFATOORAH_WEBHOOK_SECRET = "";
    const { POST } = await loadRoute();
    expect((await POST(post("{}"))).status).toBe(404);
  });

  it("rejects an oversized body with 413 before parsing or storing anything", async () => {
    const { POST } = await loadRoute();
    const big = "x".repeat(64 * 1024 + 1);
    expect((await POST(post(big, "sig"))).status).toBe(413);
    expect(db.tables.photo_payment_events).toHaveLength(0);
  });

  it("answers 400 for malformed JSON and non-object bodies", async () => {
    const { POST } = await loadRoute();
    expect((await POST(post("{not json", "x"))).status).toBe(400);
    expect((await POST(post("[1,2]", "x"))).status).toBe(400);
    expect(db.tables.photo_payment_events).toHaveLength(0);
  });

  it("answers 401 for a bad signature and records the delivery as invalid", async () => {
    const { POST } = await loadRoute();
    const res = await POST(post(JSON.stringify(paymentEvent()), "bm90LXRoZS1zaWduYXR1cmU="));
    expect(res.status).toBe(401);
    expect(db.tables.photo_payment_events[0]).toMatchObject({ signature_valid: false, processing_result: "invalid_signature" });
    expect(db.tables.photo_bookings[0].status).toBe("pending");
  });

  it("answers 200 and marks the booking paid for a correctly signed event; the redelivery is a 200 duplicate", async () => {
    const { POST } = await loadRoute();
    const body = paymentEvent();
    const first = await POST(post(JSON.stringify(body), sign(body)));
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ ok: true, result: "processed" });
    expect(db.tables.photo_bookings[0]).toMatchObject({ id: BOOKING_ID, status: "paid" });
    expect(db.tables.photo_athletes).toHaveLength(0);

    const second = await POST(post(JSON.stringify(body), sign(body)));
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ ok: true, result: "duplicate" });
    expect(db.tables.photo_payment_events[0].attempts).toBe(2);
  });

  it("answers 200 (not an error) for an ignored transition so MyFatoorah stops retrying", async () => {
    db.tables.photo_bookings = [booking({ status: "cancelled" })];
    const { POST } = await loadRoute();
    const body = paymentEvent();
    const res = await POST(post(JSON.stringify(body), sign(body)));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, result: "ignored_transition" });
    expect(db.tables.photo_bookings[0].status).toBe("cancelled");
  });

  it("rate limits at 120 requests per minute", async () => {
    const { POST } = await loadRoute();
    let last = 0;
    for (let i = 0; i < 121; i++) last = (await POST(post("{not json", "x"))).status;
    expect(last).toBe(429);
  });
});
