import { describe, expect, it, vi } from "vitest";
import { createLogger, setLogSink } from "@/lib/log";
import { processWebhook, requestTransition, type WebhookDeps } from "@/lib/payments/myfatoorah/webhook";
import { createStagePaymentRequest } from "@/lib/payments/requests";
import type { PhotoBookingPaymentRequestRow, PhotoBookingRow } from "@/lib/supabase/database.types";
import { FakeSupabase } from "./fake-supabase";
import { BOOKING_ID, OWNER, booking, paymentEvent } from "./fixtures";

vi.mock("server-only", () => ({}));

setLogSink(() => {});

const SITE = "https://site.test";
const actor = { userId: OWNER, kind: "owner" as const };
const DEPOSIT_INVOICE = "7001";
const BALANCE_INVOICE = "7002";

/** QAR 1000, agreement signed, deposit 500 pending: the state right after "Create payment link". */
const signed = (overrides: Partial<PhotoBookingRow> = {}) =>
  booking({ amount_qr: 1000, deposit_qr: 500, balance_qr: 500, deposit_state: "pending", balance_state: "not_due", requires_contract: true, contract_state: "signed", booking_status: "awaiting_payment", provider_invoice_id: null, payment_url: null, status: "pending", ...overrides });

/** Seeds a booking plus a pending request for `stage` whose checkout attempt created `invoiceId`. */
async function setup(row: PhotoBookingRow, stage: "deposit" | "balance", invoiceId: string) {
  const db = new FakeSupabase();
  db.seed("photo_bookings", [row]);
  db.seed("photo_studio", [{ owner_id: OWNER, business_name: "Blue Belt Media" }]);
  const supabase = db.asClient();
  const created = await createStagePaymentRequest(supabase, { booking: row, stage, actor, paymentsEnabled: true, siteUrl: SITE, now: new Date("2026-10-08T09:00:00.000Z") });
  if (!created.ok) throw new Error(created.error);
  // The pay page links the provider invoice to the request (and mirrors it on the booking).
  await supabase.from("photo_booking_payment_requests").update({ provider_invoice_id: invoiceId, provider_reference: BOOKING_ID }).eq("id", created.request.id);
  await supabase.from("photo_bookings").update({ provider_invoice_id: invoiceId }).eq("id", BOOKING_ID);
  let t = Date.parse("2026-10-08T10:00:00.000Z");
  const deps: WebhookDeps = { supabase, now: () => new Date((t += 1000)), log: createLogger({ test: true }) };
  const bookingRow = () => db.tables.photo_bookings.find((b) => b.id === BOOKING_ID)! as unknown as PhotoBookingRow;
  const requestRow = () => db.tables.photo_booking_payment_requests.find((r) => r.id === created.request.id)! as unknown as PhotoBookingPaymentRequestRow;
  return { db, deps, bookingRow, requestRow, request: created.request };
}

/** A PAYMENT_STATUS_CHANGED SUCCESS for our invoice: CustomerReference echoed as the booking id, amount as given. */
function success(invoiceId: string, amount: string, overrides: Parameters<typeof paymentEvent>[0] = {}) {
  const ev = paymentEvent({ invoiceId, reference: `WH-${invoiceId}-${amount}-${overrides.transactionStatus ?? "S"}`, paymentId: overrides.paymentId ?? `PAY-${invoiceId}-${overrides.transactionStatus ?? "S"}`, ...overrides });
  ev.Data.Invoice.ExternalIdentifier = BOOKING_ID;
  ev.Data.Amount.ValueInBaseCurrency = amount;
  ev.Data.Amount.ValueInDisplayCurrency = amount;
  return ev;
}

const emails = (db: FakeSupabase) => db.tables.photo_notification_deliveries.filter((d) => d.channel === "email").map((d) => d.alert_key);
const audits = (db: FakeSupabase) => db.tables.photo_audit_log.map((a) => a.action);

describe("deposit webhook", () => {
  it("marks the request and the deposit paid, confirms through the gates (contract signed), and leaves the balance alone", async () => {
    const { db, deps, bookingRow, requestRow } = await setup(signed(), "deposit", DEPOSIT_INVOICE);
    const out = await processWebhook({ body: success(DEPOSIT_INVOICE, "500"), signatureValid: true }, deps);
    expect(out).toMatchObject({ result: "processed", status: "paid", bookingId: BOOKING_ID });
    expect(requestRow()).toMatchObject({ status: "paid", provider_invoice_id: DEPOSIT_INVOICE, provider_payment_id: `PAY-${DEPOSIT_INVOICE}-S` });
    expect(requestRow().paid_at).toBeTruthy();
    const b = bookingRow();
    expect(b).toMatchObject({ status: "paid", deposit_state: "paid", balance_state: "not_due", balance_paid_at: null, booking_status: "confirmed" });
    expect(b.deposit_paid_at).toBeTruthy();
    expect(b.confirmed_at).toBeTruthy();
    expect(audits(db)).toEqual(expect.arrayContaining(["deposit.paid", "booking.status"]));
    expect(audits(db)).not.toContain("balance.paid");
    expect(db.tables.photo_payment_records).toEqual([expect.objectContaining({ kind: "provider", amount_qr: 500, note: "deposit (50%)" })]);
    expect(emails(db).sort()).toEqual([`email:booking:${BOOKING_ID}:confirmed`, `email:booking:${BOOKING_ID}:paid:deposit`]);
    const paidMail = db.tables.photo_notification_deliveries.find((d) => d.alert_key === `email:booking:${BOOKING_ID}:paid:deposit`)!.payload as { subject: string; text: string };
    expect(paidMail.subject).toMatch(/^Your payment was received/);
    expect(paidMail.text.toLowerCase()).not.toMatch(/fatoorah/);
    expect(db.tables.photo_notification_deliveries.some((d) => d.kind === "BOOKING_PAID")).toBe(true);
    expect(db.tables.photo_athletes).toHaveLength(0);
  });

  it("does NOT confirm when the agreement is still unsigned: deposit paid, booking waits for the contract", async () => {
    const { db, deps, bookingRow } = await setup(signed(), "deposit", DEPOSIT_INVOICE);
    // The agreement was voided and re-issued after the link went out; the money still arrives.
    await deps.supabase.from("photo_bookings").update({ contract_state: "sent", booking_status: "awaiting_contract" }).eq("id", BOOKING_ID);
    await processWebhook({ body: success(DEPOSIT_INVOICE, "500"), signatureValid: true }, deps);
    expect(bookingRow()).toMatchObject({ deposit_state: "paid", booking_status: "awaiting_contract" });
    expect(bookingRow().confirmed_at).toBeNull();
    expect(emails(db)).toEqual([`email:booking:${BOOKING_ID}:paid:deposit`]);
  });

  it("a wrong amount never marks anything paid: mismatch recorded on the request, owner alerted, deposit still pending", async () => {
    const { db, deps, bookingRow, requestRow } = await setup(signed(), "deposit", DEPOSIT_INVOICE);
    const out = await processWebhook({ body: success(DEPOSIT_INVOICE, "1000"), signatureValid: true }, deps);
    expect(out).toMatchObject({ result: "amount_mismatch", detail: expect.stringMatching(/amount 1000 expected 500/) });
    expect(requestRow()).toMatchObject({ status: "pending", error_code: "mismatch" });
    expect(bookingRow()).toMatchObject({ status: "pending", deposit_state: "pending", booking_status: "awaiting_payment" });
    expect(bookingRow().metadata).toMatchObject({ payment_mismatch: { expected: 500, stage: "deposit", invoice_id: DEPOSIT_INVOICE } });
    expect(db.tables.photo_notification_deliveries.filter((d) => d.kind === "INTEGRATION_FAILED")).toHaveLength(1);
    expect(db.tables.photo_payment_records).toHaveLength(0);
    expect(emails(db)).toEqual([]);
  });

  it("a wrong provider reference never marks anything paid", async () => {
    const { deps, bookingRow, requestRow } = await setup(signed(), "deposit", DEPOSIT_INVOICE);
    const ev = success(DEPOSIT_INVOICE, "500");
    ev.Data.Invoice.ExternalIdentifier = "33333333-3333-4333-8333-333333333333";
    const out = await processWebhook({ body: ev, signatureValid: true }, deps);
    expect(out).toMatchObject({ result: "amount_mismatch", detail: expect.stringMatching(/^reference /) });
    expect(requestRow().status).toBe("pending");
    expect(bookingRow().deposit_state).toBe("pending");
    // An invoice that belongs to no request and no booking is simply not found.
    expect(await processWebhook({ body: success("999999", "500"), signatureValid: true }, deps)).toMatchObject({ result: "booking_not_found" });
    expect(bookingRow().deposit_state).toBe("pending");
  });

  it("duplicate webhooks are harmless, and a late FAILED never regresses a paid request", async () => {
    const { db, deps, bookingRow, requestRow } = await setup(signed(), "deposit", DEPOSIT_INVOICE);
    const ev = success(DEPOSIT_INVOICE, "500");
    await processWebhook({ body: ev, signatureValid: true }, deps);
    const paidAt = requestRow().paid_at;
    expect(await processWebhook({ body: ev, signatureValid: true }, deps)).toMatchObject({ result: "duplicate" });
    expect(await processWebhook({ body: success(DEPOSIT_INVOICE, "500", { reference: "WH-second-success", paymentId: "PAY-other" }), signatureValid: true }, deps)).toMatchObject({ result: "unchanged" });
    const late = await processWebhook({ body: success(DEPOSIT_INVOICE, "500", { transactionStatus: "FAILED" }), signatureValid: true }, deps);
    expect(late).toMatchObject({ result: "ignored_transition", detail: "request:paid->failed" });
    expect(requestRow()).toMatchObject({ status: "paid", paid_at: paidAt });
    expect(bookingRow()).toMatchObject({ status: "paid", deposit_state: "paid", booking_status: "confirmed" });
    expect(db.tables.photo_payment_records).toHaveLength(1);
    expect(emails(db)).toHaveLength(2);
  });

  it("FAILED marks the request failed (never paid) and keeps the deposit pending; a retry under the same invoice succeeds afterwards", async () => {
    const { deps, bookingRow, requestRow } = await setup(signed(), "deposit", DEPOSIT_INVOICE);
    expect(await processWebhook({ body: success(DEPOSIT_INVOICE, "500", { transactionStatus: "FAILED" }), signatureValid: true }, deps)).toMatchObject({ result: "processed", status: "failed" });
    expect(requestRow()).toMatchObject({ status: "failed" });
    expect(bookingRow()).toMatchObject({ status: "failed", deposit_state: "pending", booking_status: "awaiting_payment" });
    expect(await processWebhook({ body: success(DEPOSIT_INVOICE, "500"), signatureValid: true }, deps)).toMatchObject({ result: "processed", status: "paid" });
    expect(requestRow().status).toBe("paid");
    expect(bookingRow()).toMatchObject({ deposit_state: "paid", booking_status: "confirmed" });
  });

  it("requestTransition table", () => {
    expect(requestTransition("pending", "paid")).toBe("ok");
    expect(requestTransition("failed", "paid")).toBe("ok");
    expect(requestTransition("paid", "paid")).toBe("same");
    expect(requestTransition("paid", "failed")).toBe("illegal");
    expect(requestTransition("cancelled", "paid")).toBe("illegal");
    expect(requestTransition("expired", "paid")).toBe("illegal");
    expect(requestTransition("paid", "refunded")).toBe("ok");
    expect(requestTransition("pending", "refunded")).toBe("illegal");
  });
});

describe("balance webhook", () => {
  const delivered = (overrides: Partial<PhotoBookingRow> = {}) =>
    signed({ deposit_state: "paid", deposit_paid_at: "2026-10-01T00:00:00.000Z", status: "paid", paid_at: "2026-10-01T00:00:00.000Z", booking_status: "delivered", confirmed_at: "2026-10-01T00:00:00.000Z", coverage_done_at: "2026-10-05T00:00:00.000Z", delivered_at: "2026-10-07T00:00:00.000Z", gallery_delivered_at: "2026-10-07T00:00:00.000Z", balance_state: "due", balance_due_at: "2026-10-07T00:00:00.000Z", ...overrides });

  it("marks the balance paid only, keeps the deposit columns, and completes the delivered booking", async () => {
    const { db, deps, bookingRow, requestRow } = await setup(delivered(), "balance", BALANCE_INVOICE);
    const out = await processWebhook({ body: success(BALANCE_INVOICE, "500"), signatureValid: true }, deps);
    expect(out).toMatchObject({ result: "processed", status: "paid" });
    expect(requestRow()).toMatchObject({ status: "paid", stage: "balance" });
    const b = bookingRow();
    expect(b).toMatchObject({ balance_state: "paid", deposit_state: "paid", deposit_paid_at: "2026-10-01T00:00:00.000Z", booking_status: "completed", status: "paid" });
    expect(b.balance_paid_at).toBeTruthy();
    expect(b.completed_at).toBeTruthy();
    expect(audits(db)).toEqual(expect.arrayContaining(["balance.paid", "booking.completed"]));
    expect(audits(db)).not.toContain("deposit.paid");
    expect(emails(db)).toEqual([`email:booking:${BOOKING_ID}:paid:balance`]);
    const mail = db.tables.photo_notification_deliveries.find((d) => d.alert_key === `email:booking:${BOOKING_ID}:paid:balance`)!.payload as { text: string };
    expect(mail.text).toContain("remaining balance (50%)");
    expect(mail.text).toContain("fully paid");
  });

  it("the second stage is accepted even though the booking's provider status is already paid from the deposit", async () => {
    const { deps, bookingRow } = await setup(delivered(), "balance", BALANCE_INVOICE);
    expect(bookingRow().status).toBe("paid");
    expect(await processWebhook({ body: success(BALANCE_INVOICE, "500"), signatureValid: true }, deps)).toMatchObject({ result: "processed" });
    expect(bookingRow().balance_state).toBe("paid");
  });

  it("a balance success for the deposit amount is a mismatch (the expected charge is the request amount, not the total)", async () => {
    const { deps, bookingRow } = await setup(delivered({ balance_qr: 300, amount_qr: 800 }), "balance", BALANCE_INVOICE);
    expect(await processWebhook({ body: success(BALANCE_INVOICE, "800"), signatureValid: true }, deps)).toMatchObject({ result: "amount_mismatch", detail: expect.stringMatching(/expected 300/) });
    expect(bookingRow().balance_state).toBe("due");
    expect(await processWebhook({ body: success(BALANCE_INVOICE, "300", { reference: "WH-right" }), signatureValid: true }, deps)).toMatchObject({ result: "processed" });
    expect(bookingRow()).toMatchObject({ balance_state: "paid", booking_status: "completed" });
  });
});

describe("legacy invoice without a request row", () => {
  it("still goes through the gates: deposit paid, confirmed only because no agreement is required", async () => {
    const db = new FakeSupabase();
    db.seed("photo_bookings", [booking({ booking_status: "awaiting_payment" })]);
    const deps: WebhookDeps = { supabase: db.asClient(), now: () => new Date("2026-10-08T10:00:00.000Z"), log: createLogger({ test: true }) };
    expect(await processWebhook({ body: paymentEvent(), signatureValid: true }, deps)).toMatchObject({ result: "processed", status: "paid" });
    const b = db.tables.photo_bookings[0];
    // 350 covers the whole booking: both stages settle.
    expect(b).toMatchObject({ deposit_state: "paid", balance_state: "paid", booking_status: "confirmed" });

    const gated = new FakeSupabase();
    gated.seed("photo_bookings", [booking({ booking_status: "awaiting_contract", requires_contract: true, contract_state: "sent" })]);
    const deps2: WebhookDeps = { supabase: gated.asClient(), now: () => new Date("2026-10-08T10:00:00.000Z"), log: createLogger({ test: true }) };
    await processWebhook({ body: paymentEvent(), signatureValid: true }, deps2);
    expect(gated.tables.photo_bookings[0]).toMatchObject({ deposit_state: "paid", booking_status: "awaiting_contract" });
  });
});
