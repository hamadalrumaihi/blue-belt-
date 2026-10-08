import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLogSink } from "@/lib/log";
import { resetRateLimits } from "@/lib/rate-limit";
import { bodyHash } from "@/lib/documents/hash";
import { FakeSupabase } from "./payments/fake-supabase";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

const db = new FakeSupabase();
vi.mock("@/lib/supabase/service", () => ({
  isServiceClientConfigured: () => true,
  createServiceClient: () => db.asClient(),
}));

setLogSink(() => {});

const SECRET = "webhook-secret";
const OWNER = "owner-1";
const DOC = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BOOKING = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ENVELOPE = "mock_abcdefghijklmnop";
const BODY = "Agreement text";
const ENV = { ESIGN_PROVIDER: "mock", ESIGN_WEBHOOK_SECRET: SECRET };

function post(body: string, signature?: string, extra: Record<string, string> = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", ...extra };
  if (signature !== undefined) headers["x-esign-signature"] = signature;
  return new Request("https://example.test/api/esign/webhook", { method: "POST", headers, body });
}
const sign = (body: string, secret = SECRET) => createHmac("sha256", secret).update(body).digest("base64");
const event = (over: Record<string, unknown> = {}) => JSON.stringify({ events: [{ id: "evt-1", envelopeId: ENVELOPE, type: "signed", occurredAt: "2026-10-06T09:00:00.000Z", completedDocumentRef: "ref/completed", certificateRef: "ref/cert", ...over }] });

async function loadRoute() {
  vi.resetModules();
  (await import("@/lib/log")).setLogSink(() => {});
  return import("@/app/api/esign/webhook/route");
}

describe("POST /api/esign/webhook", () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of Object.keys(ENV)) saved[k] = process.env[k];
    Object.assign(process.env, ENV);
    delete process.env.VERCEL_ENV;
    for (const t of Object.keys(db.tables)) db.tables[t] = [];
    db.tables.photo_esign_events = [];
    db.tables.photo_audit_log = [];
    db.seed("photo_documents", [{ id: DOC, owner_id: OWNER, title: "Event agreement", kind: "event_agreement", body: BODY, body_hash: bodyHash(BODY), status: "sent", booking_id: BOOKING, client_id: null, access_token_hash: null, sent_at: "2026-10-05T09:00:00.000Z", viewed_at: null, signed_at: null, declined_at: null, voided_at: null, expires_at: "2026-10-20T00:00:00.000Z", signer_name: null, signer_email: null, signer_phone: null, signature_evidence: null, provider: "mock", provider_envelope_id: ENVELOPE, provider_status: "sent", provider_error: null, signer_role: "client", required_for_confirmation: true, created_at: "2026-10-05T08:00:00.000Z" }]);
    db.seed("photo_bookings", [{ id: BOOKING, owner_id: OWNER, athlete_name: "Yousef", customer_name: "Parent", customer_email: "parent@example.com", customer_phone: null, public_ref: "BB-1", amount_qr: 1000, status: "pending", booking_status: "awaiting_contract", confirmed_at: null, contract_document_id: DOC, requires_contract: true, requires_guardian_release: false, subject_is_minor: false, guardian: null, contract_state: "sent", deposit_state: "pending", balance_state: "not_due" }]);
    db.calls = [];
    resetRateLimits();
  });
  afterEach(() => {
    for (const k of Object.keys(ENV)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("answers 404 when the internal provider is selected or no secret is set", async () => {
    process.env.ESIGN_PROVIDER = "internal";
    let { POST } = await loadRoute();
    expect((await POST(post(event(), sign(event())))).status).toBe(404);
    process.env.ESIGN_PROVIDER = "mock";
    delete process.env.ESIGN_WEBHOOK_SECRET;
    ({ POST } = await loadRoute());
    expect((await POST(post(event(), sign(event())))).status).toBe(404);
    expect(db.tables.photo_esign_events).toHaveLength(0);
    expect(db.tables.photo_documents[0].status).toBe("sent");
  });

  it("rejects a missing or invalid signature with 401 and records nothing", async () => {
    const { POST } = await loadRoute();
    expect((await POST(post(event()))).status).toBe(401);
    expect((await POST(post(event(), sign(event(), "wrong")))).status).toBe(401);
    expect((await POST(post(event(), "garbage"))).status).toBe(401);
    // A body tampered after signing fails too.
    expect((await POST(post(event({ type: "declined" }), sign(event())))).status).toBe(401);
    expect(db.tables.photo_esign_events).toHaveLength(0);
    expect(db.tables.photo_documents[0].status).toBe("sent");
    expect(db.tables.photo_audit_log).toHaveLength(0);
  });

  it("answers 400 for a verified body that is not a usable payload", async () => {
    const { POST } = await loadRoute();
    const body = JSON.stringify({ nope: true });
    const res = await POST(post(body, sign(body)));
    expect(res.status).toBe(400);
    expect(db.tables.photo_esign_events).toHaveLength(0);
  });

  it("applies a valid signed event: document signed, audit as system, booking contract_state signed, gates recomputed", async () => {
    const { POST } = await loadRoute();
    const res = await POST(post(event(), sign(event())));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, outcomes: [{ eventId: "evt-1", result: "applied", documentId: DOC }] });
    const doc = db.tables.photo_documents[0];
    expect(doc).toMatchObject({ status: "signed", provider_status: "signed", completed_document_ref: "ref/completed", certificate_ref: "ref/cert", signed_at: "2026-10-06T09:00:00.000Z", provider_error: null });
    expect(db.tables.photo_audit_log.find((a) => a.action === "contract.signed")).toMatchObject({ actor_kind: "system", actor_id: null, data: { eventId: "evt-1", envelopeId: ENVELOPE, provider: "mock" } });
    const booking = db.tables.photo_bookings[0];
    expect(booking.contract_state).toBe("signed");
    expect(booking.booking_status).toBe("awaiting_payment");
    expect(booking.confirmed_at).toBeNull();
    expect(db.tables.photo_esign_events).toHaveLength(1);
    expect(db.tables.photo_esign_events[0]).toMatchObject({ provider: "mock", event_id: "evt-1", envelope_id: ENVELOPE, event_type: "signed", result: "applied" });
    expect(db.tables.photo_esign_events[0].processed_at).toBeTruthy();
    expect(db.tables.photo_notification_deliveries.find((d) => d.channel === "telegram")).toMatchObject({ kind: "CONTRACT_SIGNED" });
  });

  it("treats a redelivered event as a no-op 200", async () => {
    const { POST } = await loadRoute();
    expect((await POST(post(event(), sign(event())))).status).toBe(200);
    const second = await POST(post(event(), sign(event())));
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ ok: true, outcomes: [{ eventId: "evt-1", result: "duplicate" }] });
    expect(db.tables.photo_esign_events).toHaveLength(1);
    expect(db.tables.photo_audit_log.filter((a) => a.action === "contract.signed")).toHaveLength(1);
    expect(db.tables.photo_notification_deliveries.filter((d) => d.channel === "telegram")).toHaveLength(1);
  });

  it("ignores an event for an unknown envelope and never trusts ids from the query string", async () => {
    const { POST } = await loadRoute();
    const body = event({ id: "evt-2", envelopeId: "mock_zzzzzzzzzzzzzzzz" });
    const req = new Request(`https://example.test/api/esign/webhook?envelopeId=${ENVELOPE}`, { method: "POST", headers: { "content-type": "application/json", "x-esign-signature": sign(body) }, body });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ outcomes: [{ eventId: "evt-2", result: "no_document" }] });
    expect(db.tables.photo_documents[0].status).toBe("sent");
    expect(db.tables.photo_esign_events[0]).toMatchObject({ event_id: "evt-2", result: "no_document" });
  });

  it("records a declined event with its reason and leaves a later stale event ignored", async () => {
    const { POST } = await loadRoute();
    const declined = event({ id: "evt-3", type: "declined", reason: "Wrong date" });
    expect((await POST(post(declined, sign(declined)))).status).toBe(200);
    expect(db.tables.photo_documents[0]).toMatchObject({ status: "declined", signature_evidence: { method: "declined", reason: "Wrong date" } });
    expect(db.tables.photo_bookings[0].contract_state).toBe("declined");
    const viewed = event({ id: "evt-4", type: "viewed" });
    const res = await POST(post(viewed, sign(viewed)));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ outcomes: [{ eventId: "evt-4", result: "ignored" }] });
    expect(db.tables.photo_documents[0].status).toBe("declined");
  });

  it("refuses an oversized body", async () => {
    const { POST } = await loadRoute();
    const res = await POST(post("{}", sign("{}"), { "content-length": String(300 * 1024) }));
    expect(res.status).toBe(413);
  });
});
