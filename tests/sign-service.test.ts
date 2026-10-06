import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: vi.fn(), isServiceClientConfigured: () => false }));

import { bodyHash } from "@/lib/documents/hash";
import { declineDocument, loadSigningDocument, signDocument } from "@/lib/documents/sign-service";
import { createSigningToken } from "@/lib/documents/tokens";
import { FakeSupabase } from "./payments/fake-supabase";

const OWNER = "owner-1";
const DOC = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BOOKING = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NOW = new Date("2026-10-06T09:00:00.000Z");
const BODY = "DRAFT TEMPLATE — review with a lawyer.\n\nI agree to things.";

function seed(overrides: Record<string, unknown> = {}) {
  const db = new FakeSupabase();
  const { token, hash } = createSigningToken();
  db.seed("photo_documents", [{ id: DOC, owner_id: OWNER, title: "Event agreement", kind: "event_agreement", body: BODY, body_hash: bodyHash(BODY), status: "sent", access_token_hash: hash, booking_id: BOOKING, client_id: null, sent_at: "2026-10-05T09:00:00.000Z", viewed_at: null, signed_at: null, declined_at: null, expires_at: "2026-10-20T00:00:00.000Z", signer_name: null, signer_email: null, signer_phone: null, signature_evidence: null, ...overrides }]);
  db.seed("photo_bookings", [{ id: BOOKING, owner_id: OWNER, athlete_name: "Yousef", customer_name: "Parent", customer_email: "parent@example.com", customer_phone: "+97450000000", public_ref: "BB-7K3PQ2", amount_qr: 500, amount_paid_qr: 0, manual_paid_at: null, status: "pending", booking_status: "awaiting_contract", quoted_at: null, confirmed_at: null, delivered_at: null, completed_at: null, cancelled_at: null, contract_document_id: null }]);
  return { db, token, supabase: db.asClient() };
}

const SIGN = { signerName: "Sara Khan", signerEmail: "sara@example.com", signerPhone: "+974 5000 0000", agreed: true as const, ip: "10.1.2.3", userAgent: "Mozilla/5.0 (iPhone)", now: NOW };

beforeEach(() => {
  vi.useRealTimers();
});

describe("loadSigningDocument", () => {
  it("marks a sent document viewed exactly once and returns safe fields with the booking contact as prefill", async () => {
    const { db, token, supabase } = seed();
    const first = await loadSigningDocument(token, { supabase, now: NOW });
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error("unreachable");
    expect(first.notice).toBeNull();
    expect(first.doc.status).toBe("viewed");
    expect(first.doc.prefill).toEqual({ name: "Parent", email: "parent@example.com", phone: "+97450000000" });
    expect(first.studioName).toBe("Blue Belt Media");
    expect("access_token_hash" in first.doc).toBe(false);
    expect("owner_id" in first.doc).toBe(false);
    const row = db.tables.photo_documents[0];
    expect(row.status).toBe("viewed");
    expect(row.viewed_at).toBe(NOW.toISOString());
    expect(db.tables.photo_audit_log.filter((a) => a.action === "document.viewed")).toHaveLength(1);

    const later = new Date("2026-10-06T10:00:00.000Z");
    const second = await loadSigningDocument(token, { supabase, now: later });
    expect(second.ok && second.notice).toBeNull();
    expect(row.viewed_at).toBe(NOW.toISOString());
    expect(db.tables.photo_audit_log.filter((a) => a.action === "document.viewed")).toHaveLength(1);
  });

  it("rejects malformed and unknown tokens, drafts, and reports signed / declined / expired", async () => {
    const { token, supabase } = seed();
    expect(await loadSigningDocument("nope", { supabase, now: NOW })).toEqual({ ok: false, error: "not_found" });
    expect(await loadSigningDocument(createSigningToken().token, { supabase, now: NOW })).toEqual({ ok: false, error: "not_found" });

    const draft = seed({ status: "draft" });
    expect(await loadSigningDocument(draft.token, { supabase: draft.supabase, now: NOW })).toEqual({ ok: false, error: "not_found" });

    const signed = seed({ status: "signed", signer_name: "X", signed_at: NOW.toISOString() });
    const s = await loadSigningDocument(signed.token, { supabase: signed.supabase, now: NOW });
    expect(s.ok && s.notice).toBe("already_signed");

    const declined = seed({ status: "declined" });
    const d = await loadSigningDocument(declined.token, { supabase: declined.supabase, now: NOW });
    expect(d.ok && d.notice).toBe("declined");

    const expired = await loadSigningDocument(token, { supabase, now: new Date("2026-11-01T00:00:00.000Z") });
    expect(expired.ok && expired.notice).toBe("expired");
  });
});

describe("signDocument", () => {
  it("signs once, stores evidence, audits as client, notifies, and moves the booking to awaiting_payment when money is due", async () => {
    const { db, token, supabase } = seed();
    const res = await signDocument(token, SIGN, { supabase });
    expect(res).toEqual({ ok: true, documentId: DOC, signedAt: NOW.toISOString() });

    const row = db.tables.photo_documents[0];
    expect(row.status).toBe("signed");
    expect(row.signer_name).toBe("Sara Khan");
    expect(row.signer_email).toBe("sara@example.com");
    expect(row.signed_at).toBe(NOW.toISOString());
    expect(row.signature_evidence).toMatchObject({ method: "typed_name", typed_name: "Sara Khan", ip: "10.1.2.3", user_agent: "Mozilla/5.0 (iPhone)", body_hash: bodyHash(BODY), signed_at: NOW.toISOString() });
    expect(String((row.signature_evidence as Record<string, unknown>).token_hash_prefix)).toHaveLength(8);

    const audit = db.tables.photo_audit_log.find((a) => a.action === "document.signed");
    expect(audit).toMatchObject({ owner_id: OWNER, actor_kind: "client", actor_id: null, entity: "document", entity_id: DOC });

    const booking = db.tables.photo_bookings[0];
    expect(booking.booking_status).toBe("awaiting_payment");
    expect(booking.contract_document_id).toBe(DOC);
    expect(booking.status).toBe("pending");

    const deliveries = db.tables.photo_notification_deliveries;
    expect(deliveries.find((d) => d.channel === "telegram" && d.alert_key === `document:${DOC}:signed`)).toMatchObject({ kind: "CONTRACT_SIGNED", owner_id: OWNER });
    const mail = deliveries.find((d) => d.channel === "email" && d.alert_key === `email:document:${DOC}:signed`);
    expect(mail).toMatchObject({ kind: "CONTRACT_SIGNED" });
    // The copy goes to the address the studio has on file, not the typed one.
    expect((mail?.payload as { to: string }).to).toBe("parent@example.com");

    expect(db.tables.photo_athletes).toHaveLength(0);
    expect(db.calls.some((c) => c.table === "photo_athletes")).toBe(false);

    // A second signature (double tap, second device) is refused and changes nothing.
    const again = await signDocument(token, { ...SIGN, signerName: "Someone Else" }, { supabase });
    expect(again).toEqual({ ok: false, error: "already_signed" });
    expect(row.signer_name).toBe("Sara Khan");
    expect(db.tables.photo_audit_log.filter((a) => a.action === "document.signed")).toHaveLength(1);
  });

  it("confirms the booking straight away when nothing is owed", async () => {
    const { db, token, supabase } = seed();
    db.tables.photo_bookings[0].amount_qr = 0;
    expect((await signDocument(token, SIGN, { supabase })).ok).toBe(true);
    expect(db.tables.photo_bookings[0].booking_status).toBe("confirmed");
    expect(db.tables.photo_bookings[0].confirmed_at).toBe(NOW.toISOString());
  });

  it("confirms when the booking was already paid by the provider", async () => {
    const { db, token, supabase } = seed();
    db.tables.photo_bookings[0].status = "paid";
    expect((await signDocument(token, SIGN, { supabase })).ok).toBe(true);
    expect(db.tables.photo_bookings[0].booking_status).toBe("confirmed");
  });

  it("leaves a booking alone when it is not waiting for the contract", async () => {
    const { db, token, supabase } = seed();
    db.tables.photo_bookings[0].booking_status = "confirmed";
    expect((await signDocument(token, SIGN, { supabase })).ok).toBe(true);
    expect(db.tables.photo_bookings[0].booking_status).toBe("confirmed");
  });

  it("refuses an expired link", async () => {
    const { db, token, supabase } = seed();
    expect(await signDocument(token, { ...SIGN, now: new Date("2026-12-01T00:00:00.000Z") }, { supabase })).toEqual({ ok: false, error: "expired" });
    expect(db.tables.photo_documents[0].status).toBe("sent");
  });

  it("refuses when the body no longer matches its hash", async () => {
    const { db, token, supabase } = seed({ body_hash: bodyHash("something else") });
    expect(await signDocument(token, SIGN, { supabase })).toEqual({ ok: false, error: "hash_mismatch" });
    expect(db.tables.photo_documents[0].status).toBe("sent");
    expect(db.tables.photo_audit_log ?? []).toHaveLength(0);
  });

  it("validates the signer before touching the database", async () => {
    const { db, token, supabase } = seed();
    expect(await signDocument(token, { ...SIGN, signerName: "__" }, { supabase })).toEqual({ ok: false, error: "invalid_name" });
    expect(await signDocument(token, { ...SIGN, agreed: false as unknown as true }, { supabase })).toEqual({ ok: false, error: "not_agreed" });
    expect(await signDocument(token, { ...SIGN, signerEmail: "not-an-email" }, { supabase })).toEqual({ ok: false, error: "invalid_email" });
    expect(await signDocument("bbs_bad", SIGN, { supabase })).toEqual({ ok: false, error: "not_found" });
    expect(db.calls).toHaveLength(0);
  });
});

describe("declineDocument", () => {
  it("closes the document, records the reason and tells the owner", async () => {
    const { db, token, supabase } = seed();
    expect(await declineDocument(token, "  The date is wrong  ", { supabase, now: NOW })).toEqual({ ok: true, documentId: DOC });
    const row = db.tables.photo_documents[0];
    expect(row.status).toBe("declined");
    expect(row.declined_at).toBe(NOW.toISOString());
    expect(row.signature_evidence).toMatchObject({ method: "declined", reason: "The date is wrong" });
    expect(db.tables.photo_notification_deliveries.find((d) => d.alert_key === `document:${DOC}:declined`)).toMatchObject({ kind: "CONTRACT_DECLINED" });
    expect(db.tables.photo_bookings[0].booking_status).toBe("awaiting_contract");
    expect(await signDocument(token, SIGN, { supabase })).toEqual({ ok: false, error: "declined" });
    expect(await declineDocument(token, null, { supabase, now: NOW })).toEqual({ ok: false, error: "declined" });
  });
});
