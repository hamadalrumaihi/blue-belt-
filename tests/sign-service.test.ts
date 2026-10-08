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
const GUARDIAN_DOC = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const BOOKING = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NOW = new Date("2026-10-06T09:00:00.000Z");
const BODY = "DRAFT TEMPLATE: review with a lawyer.\n\nI agree to things.";

type Row = Record<string, unknown>;

function docRow(overrides: Row = {}): Row {
  return { id: DOC, owner_id: OWNER, title: "Event agreement", kind: "event_agreement", body: BODY, body_hash: bodyHash(BODY), status: "sent", booking_id: BOOKING, client_id: null, sent_at: "2026-10-05T09:00:00.000Z", viewed_at: null, signed_at: null, declined_at: null, voided_at: null, expires_at: "2026-10-20T00:00:00.000Z", signer_name: null, signer_email: null, signer_phone: null, signature_evidence: null, provider: "internal", provider_envelope_id: DOC, provider_status: "sent", provider_error: null, signer_role: "client", required_for_confirmation: true, document_version: "event_agreement@1", created_at: "2026-10-05T08:00:00.000Z", ...overrides };
}

function bookingRow(overrides: Row = {}): Row {
  return { id: BOOKING, owner_id: OWNER, athlete_name: "Yousef", customer_name: "Parent", customer_email: "parent@example.com", customer_phone: "+97450000000", public_ref: "BB-7K3PQ2", amount_qr: 500, amount_paid_qr: 0, manual_paid_at: null, status: "pending", booking_status: "awaiting_contract", quoted_at: null, confirmed_at: null, delivered_at: null, completed_at: null, cancelled_at: null, contract_document_id: null, requires_contract: true, requires_guardian_release: false, subject_is_minor: false, guardian: null, contract_state: "sent", deposit_state: "pending", deposit_qr: 250, balance_qr: 250, balance_state: "not_due", ...overrides };
}

function seed(docOverrides: Row = {}, bookingOverrides: Row = {}) {
  const db = new FakeSupabase();
  const { token, hash } = createSigningToken();
  db.seed("photo_documents", [docRow({ access_token_hash: hash, ...docOverrides })]);
  db.seed("photo_bookings", [bookingRow(bookingOverrides)]);
  return { db, token, supabase: db.asClient() };
}

const SIGN = { signerName: "Sara Khan", signerEmail: "sara@example.com", signerPhone: "+974 5000 0000", agreed: true as const, ip: "10.1.2.3", userAgent: "Mozilla/5.0 (iPhone)", now: NOW };

beforeEach(() => {
  vi.useRealTimers();
});

describe("loadSigningDocument", () => {
  it("marks a sent document viewed exactly once (audit contract.viewed) and returns safe fields with the booking contact as prefill", async () => {
    const { db, token, supabase } = seed();
    const first = await loadSigningDocument(token, { supabase, now: NOW });
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error("unreachable");
    expect(first.notice).toBeNull();
    expect(first.doc.status).toBe("viewed");
    expect(first.doc.prefill).toEqual({ name: "Parent", email: "parent@example.com", phone: "+97450000000" });
    expect(first.doc.signer).toEqual({ role: "client", athleteName: "Yousef", guardianName: null });
    expect(first.studioName).toBe("Blue Belt Media");
    expect("access_token_hash" in first.doc).toBe(false);
    expect("owner_id" in first.doc).toBe(false);
    const row = db.tables.photo_documents[0];
    expect(row.status).toBe("viewed");
    expect(row.viewed_at).toBe(NOW.toISOString());
    expect(db.tables.photo_audit_log.filter((a) => a.action === "contract.viewed")).toHaveLength(1);
    expect(db.tables.photo_audit_log[0]).toMatchObject({ actor_kind: "client", actor_id: null });

    const later = new Date("2026-10-06T10:00:00.000Z");
    const second = await loadSigningDocument(token, { supabase, now: later });
    expect(second.ok && second.notice).toBeNull();
    expect(row.viewed_at).toBe(NOW.toISOString());
    expect(db.tables.photo_audit_log.filter((a) => a.action === "contract.viewed")).toHaveLength(1);
  });

  it("prefills a guardian release from the guardian on the booking and says who signs", async () => {
    const { token, supabase } = seed({ signer_role: "guardian", kind: "guardian_release" }, { subject_is_minor: true, requires_guardian_release: true, guardian: { name: "Sara Khan", email: "sara@example.com", phone: "+97455555555" } });
    const view = await loadSigningDocument(token, { supabase, now: NOW });
    if (!view.ok) throw new Error("unreachable");
    expect(view.doc.prefill).toEqual({ name: "Sara Khan", email: "sara@example.com", phone: "+97455555555" });
    expect(view.doc.signer).toEqual({ role: "guardian", athleteName: "Yousef", guardianName: "Sara Khan" });
  });

  it("rejects malformed and unknown tokens, drafts, and reports signed / declined / voided / expired", async () => {
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

    const voided = seed({ status: "void" });
    const v = await loadSigningDocument(voided.token, { supabase: voided.supabase, now: NOW });
    expect(v.ok && v.notice).toBe("voided");

    const expired = await loadSigningDocument(token, { supabase, now: new Date("2026-11-01T00:00:00.000Z") });
    expect(expired.ok && expired.notice).toBe("expired");
  });
});

describe("signDocument", () => {
  it("signs once, stores evidence, audits contract.signed as client, notifies, and moves the booking to awaiting the deposit (never straight to confirmed)", async () => {
    const { db, token, supabase } = seed();
    const res = await signDocument(token, SIGN, { supabase });
    expect(res).toEqual({ ok: true, documentId: DOC, signedAt: NOW.toISOString(), contractState: "signed" });

    const row = db.tables.photo_documents[0];
    expect(row.status).toBe("signed");
    expect(row.signer_name).toBe("Sara Khan");
    expect(row.signer_email).toBe("sara@example.com");
    expect(row.signed_at).toBe(NOW.toISOString());
    expect(row.provider_status).toBe("signed");
    expect(row.signature_evidence).toMatchObject({ method: "typed_name", typed_name: "Sara Khan", signer_role: "client", ip: "10.1.2.3", user_agent: "Mozilla/5.0 (iPhone)", body_hash: bodyHash(BODY), signed_at: NOW.toISOString() });
    expect(String((row.signature_evidence as Record<string, unknown>).token_hash_prefix)).toHaveLength(8);

    const audit = db.tables.photo_audit_log.find((a) => a.action === "contract.signed");
    expect(audit).toMatchObject({ owner_id: OWNER, actor_kind: "client", actor_id: null, entity: "document", entity_id: DOC });
    expect(db.tables.photo_audit_log.some((a) => a.action === "document.signed")).toBe(false);

    const booking = db.tables.photo_bookings[0];
    expect(booking.contract_state).toBe("signed");
    expect(booking.contract_document_id).toBe(DOC);
    // The deposit is still pending, so the gates stop at awaiting_payment.
    expect(booking.booking_status).toBe("awaiting_payment");
    expect(booking.confirmed_at).toBeNull();
    expect(booking.status).toBe("pending");
    expect(booking.deposit_state).toBe("pending");

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
    expect(db.tables.photo_audit_log.filter((a) => a.action === "contract.signed")).toHaveLength(1);
  });

  it("lets the gates confirm the booking when the deposit was already paid", async () => {
    const { db, token, supabase } = seed({}, { deposit_state: "paid", deposit_paid_at: "2026-10-05T10:00:00.000Z" });
    expect((await signDocument(token, SIGN, { supabase })).ok).toBe(true);
    expect(db.tables.photo_bookings[0].contract_state).toBe("signed");
    expect(db.tables.photo_bookings[0].booking_status).toBe("confirmed");
    expect(db.tables.photo_bookings[0].confirmed_at).toBe(NOW.toISOString());
  });

  it("confirms through the gates when no deposit is required", async () => {
    const { db, token, supabase } = seed({}, { amount_qr: 0, deposit_qr: 0, balance_qr: 0, deposit_state: "not_required" });
    expect((await signDocument(token, SIGN, { supabase })).ok).toBe(true);
    expect(db.tables.photo_bookings[0].booking_status).toBe("confirmed");
  });

  it("does not confirm when the price is not set yet", async () => {
    const { db, token, supabase } = seed({}, { amount_qr: 0, deposit_qr: 0, balance_qr: 0, booking_status: "inquiry" });
    expect((await signDocument(token, SIGN, { supabase })).ok).toBe(true);
    expect(db.tables.photo_bookings[0].contract_state).toBe("signed");
    expect(db.tables.photo_bookings[0].booking_status).toBe("inquiry");
  });

  it("leaves a booking's lifecycle alone when it is already confirmed", async () => {
    const { db, token, supabase } = seed({}, { booking_status: "confirmed", confirmed_at: "2026-10-01T00:00:00.000Z" });
    expect((await signDocument(token, SIGN, { supabase })).ok).toBe(true);
    expect(db.tables.photo_bookings[0].booking_status).toBe("confirmed");
    expect(db.tables.photo_bookings[0].confirmed_at).toBe("2026-10-01T00:00:00.000Z");
  });

  it("refuses an expired link", async () => {
    const { db, token, supabase } = seed();
    expect(await signDocument(token, { ...SIGN, now: new Date("2026-12-01T00:00:00.000Z") }, { supabase })).toEqual({ ok: false, error: "expired" });
    expect(db.tables.photo_documents[0].status).toBe("sent");
  });

  it("refuses a voided document", async () => {
    const { token, supabase } = seed({ status: "void", voided_at: NOW.toISOString() });
    expect(await signDocument(token, SIGN, { supabase })).toEqual({ ok: false, error: "voided" });
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

describe("a minor's booking", () => {
  function seedMinor() {
    const db = new FakeSupabase();
    const client = createSigningToken();
    const guardian = createSigningToken();
    db.seed("photo_documents", [
      docRow({ access_token_hash: client.hash }),
      docRow({ id: GUARDIAN_DOC, title: "Guardian release", kind: "guardian_release", signer_role: "guardian", access_token_hash: guardian.hash, provider_envelope_id: GUARDIAN_DOC, created_at: "2026-10-05T08:30:00.000Z" }),
    ]);
    db.seed("photo_bookings", [bookingRow({ subject_is_minor: true, requires_guardian_release: true, guardian: { name: "Sara Khan", email: "sara@example.com", phone: null } })]);
    return { db, clientToken: client.token, guardianToken: guardian.token, supabase: db.asClient() };
  }

  it("is not contract-signed after the client agreement alone; the guardian release signed by the guardian completes it", async () => {
    const { db, clientToken, guardianToken, supabase } = seedMinor();
    const first = await signDocument(clientToken, { ...SIGN, signerName: "Parent Person" }, { supabase });
    expect(first.ok && first.contractState).toBe("sent");
    const booking = db.tables.photo_bookings[0];
    expect(booking.contract_state).toBe("sent");
    expect(booking.booking_status).toBe("awaiting_contract");

    // The athlete cannot sign the guardian release, and neither can a stranger.
    expect(await signDocument(guardianToken, { ...SIGN, signerName: "Yousef" }, { supabase })).toEqual({ ok: false, error: "minor_cannot_sign" });
    expect(await signDocument(guardianToken, { ...SIGN, signerName: "Random Person" }, { supabase })).toEqual({ ok: false, error: "guardian_name_mismatch" });
    expect(db.tables.photo_documents[1].status).toBe("sent");
    expect(booking.contract_state).toBe("sent");

    const second = await signDocument(guardianToken, { ...SIGN, signerName: "Sara Khan" }, { supabase });
    expect(second.ok && second.contractState).toBe("signed");
    expect(db.tables.photo_documents[1]).toMatchObject({ status: "signed", signer_name: "Sara Khan" });
    expect(booking.contract_state).toBe("signed");
    expect(booking.booking_status).toBe("awaiting_payment");
    expect(booking.confirmed_at).toBeNull();
    // The guardian's copy goes to the guardian's e-mail, not the booking contact's.
    const mail = db.tables.photo_notification_deliveries.find((d) => d.channel === "email" && d.alert_key === `email:document:${GUARDIAN_DOC}:signed`);
    expect((mail?.payload as { to: string }).to).toBe("sara@example.com");
  });

  it("accepts a guardian name that matches loosely (extra middle name) when a guardian is on file", async () => {
    const { db, guardianToken, supabase } = seedMinor();
    expect((await signDocument(guardianToken, { ...SIGN, signerName: "Sara A. Khan" }, { supabase })).ok).toBe(true);
    expect(db.tables.photo_documents[1].status).toBe("signed");
  });
});

describe("declineDocument", () => {
  it("closes the document, records the reason, audits contract.declined, tells the owner and marks the booking declined", async () => {
    const { db, token, supabase } = seed();
    expect(await declineDocument(token, "  The date is wrong  ", { supabase, now: NOW })).toEqual({ ok: true, documentId: DOC });
    const row = db.tables.photo_documents[0];
    expect(row.status).toBe("declined");
    expect(row.declined_at).toBe(NOW.toISOString());
    expect(row.signature_evidence).toMatchObject({ method: "declined", reason: "The date is wrong" });
    expect(db.tables.photo_audit_log.find((a) => a.action === "contract.declined")).toMatchObject({ actor_kind: "client", data: { reason: "The date is wrong" } });
    expect(db.tables.photo_notification_deliveries.find((d) => d.alert_key === `document:${DOC}:declined`)).toMatchObject({ kind: "CONTRACT_DECLINED" });
    expect(db.tables.photo_bookings[0].contract_state).toBe("declined");
    expect(db.tables.photo_bookings[0].booking_status).toBe("awaiting_contract");
    expect(await signDocument(token, SIGN, { supabase })).toEqual({ ok: false, error: "declined" });
    expect(await declineDocument(token, null, { supabase, now: NOW })).toEqual({ ok: false, error: "declined" });
  });
});
