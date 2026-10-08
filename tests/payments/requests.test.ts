import { describe, expect, it, vi } from "vitest";
import { setLogSink } from "@/lib/log";
import { createStagePaymentRequest, cancelStagePaymentRequest, applyProviderResultToRequest, isValidManualPaymentLink, listStageRequests, PAYMENTS_NOT_CONFIGURED_MESSAGE, sendStagePaymentLink, stageRequestBlocker } from "@/lib/payments/requests";
import { hashPayToken } from "@/lib/payments/pay-token";
import { FakeSupabase } from "./fake-supabase";
import { BOOKING_ID, OWNER, booking } from "./fixtures";

vi.mock("server-only", () => ({}));

setLogSink(() => {});

const NOW = new Date("2026-10-08T10:00:00.000Z");
const SITE = "https://site.test";
const actor = { userId: OWNER, kind: "owner" as const };

/** A QAR 1000 booking whose agreement is signed: deposit 500 pending, balance 500 not due. */
const signed = () => booking({ amount_qr: 1000, deposit_qr: 500, balance_qr: 500, deposit_state: "pending", balance_state: "not_due", requires_contract: true, contract_state: "signed", booking_status: "awaiting_payment", provider_invoice_id: null, payment_url: null, status: "pending" });

function setup(row = signed()) {
  const db = new FakeSupabase();
  db.seed("photo_bookings", [row]);
  const supabase = db.asClient();
  const create = (overrides: Partial<Parameters<typeof createStagePaymentRequest>[1]> = {}) => createStagePaymentRequest(supabase, { booking: row, stage: "deposit", actor, paymentsEnabled: true, siteUrl: SITE, now: NOW, ...overrides });
  return { db, supabase, row, create };
}

const audits = (db: FakeSupabase) => db.tables.photo_audit_log.map((a) => a.action);

describe("stageRequestBlocker", () => {
  it("refuses the deposit before the agreement is signed, and the balance before delivery", () => {
    expect(stageRequestBlocker({ ...signed(), contract_state: "sent" }, "deposit")).toBe("contract_unsigned");
    expect(stageRequestBlocker({ ...signed(), contract_state: "required" }, "deposit")).toBe("contract_unsigned");
    expect(stageRequestBlocker(signed(), "deposit")).toBeNull();
    // No agreement required at all: the deposit may be requested.
    expect(stageRequestBlocker({ ...signed(), requires_contract: false, contract_state: "not_required" }, "deposit")).toBeNull();
    expect(stageRequestBlocker({ ...signed(), deposit_state: "paid" }, "deposit")).toBe("deposit_paid");
    expect(stageRequestBlocker({ ...signed(), deposit_qr: 0, amount_qr: 0 }, "deposit")).toBe("no_amount");
    expect(stageRequestBlocker({ ...signed(), booking_status: "cancelled" }, "deposit")).toBe("cancelled");
    expect(stageRequestBlocker(signed(), "balance")).toBe("balance_not_due");
    expect(stageRequestBlocker({ ...signed(), balance_state: "due", booking_status: "delivered" }, "balance")).toBeNull();
    expect(stageRequestBlocker({ ...signed(), balance_state: "paid" }, "balance")).toBe("balance_paid");
    expect(stageRequestBlocker({ ...signed(), balance_state: "waived" }, "balance")).toBe("balance_not_required");
  });
});

describe("createStagePaymentRequest", () => {
  it("creates a WEBSITE deposit request for the booking's own 50% (QAR 1000 -> 500), with our pay link and the token hash on the row", async () => {
    const { db, create } = setup();
    const out = await create();
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error("unreachable");
    expect(out.created).toBe(true);
    expect(out.regenerated).toBe(false);
    expect(out.payUrl).toMatch(/^https:\/\/site\.test\/pay\/bbp_[A-Za-z0-9]{40}$/);
    const token = out.payUrl.split("/pay/")[1];
    expect(out.request).toMatchObject({ owner_id: OWNER, booking_id: BOOKING_ID, stage: "deposit", amount_qr: 500, currency: "QAR", provider: "WEBSITE", status: "pending", generation: 1, payment_url: out.payUrl, pay_token_hash: hashPayToken(token) });
    expect(db.tables.photo_booking_payment_requests).toHaveLength(1);
    expect(audits(db)).toEqual(["payment_request.created"]);
    // Creating never messages anyone.
    expect(db.tables.photo_notification_deliveries).toHaveLength(0);
  });

  it("refuses before the agreement is signed, with a clear owner-facing reason and no row", async () => {
    const { db, create } = setup({ ...signed(), contract_state: "sent" });
    const out = await create();
    expect(out).toMatchObject({ ok: false, code: "contract_unsigned", error: expect.stringMatching(/agreement has not been signed/i) });
    expect(db.tables.photo_booking_payment_requests ?? []).toHaveLength(0);
  });

  it("is idempotent: a second call returns the SAME pending link and creates no new row", async () => {
    const { db, create } = setup();
    const first = await create();
    const second = await create();
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error("unreachable");
    expect(second.created).toBe(false);
    expect(second.payUrl).toBe(first.payUrl);
    expect(second.request.id).toBe(first.request.id);
    expect(db.tables.photo_booking_payment_requests).toHaveLength(1);
    expect(audits(db)).toEqual(["payment_request.created"]);
  });

  it("the amount comes only from the booking row: a browser-supplied amount is ignored", async () => {
    const { create } = setup();
    // The service signature has no amount parameter; smuggling one in changes nothing.
    const out = await create({ ...({ amount: 1, amount_qr: 1, amountQr: 1 } as object) });
    expect(out.ok && out.request.amount_qr).toBe(500);
  });

  it("refuses a new deposit request once the deposit is paid (from the booking or a paid request)", async () => {
    const paidBooking = setup({ ...signed(), deposit_state: "paid", deposit_paid_at: NOW.toISOString() });
    expect(await paidBooking.create()).toMatchObject({ ok: false, code: "deposit_paid" });
    const { db, create, row } = setup();
    const first = await create();
    if (!first.ok) throw new Error("unreachable");
    await applyProviderResultToRequest(db.asClient(), { request: first.request, status: "paid", invoiceId: "INV-1", providerPaymentId: "PAY-1", now: NOW });
    // Even if the booking column lagged behind, a paid request row blocks a new one.
    const again = await createStagePaymentRequest(db.asClient(), { booking: row, stage: "deposit", actor, paymentsEnabled: true, siteUrl: SITE, now: NOW });
    expect(again).toMatchObject({ ok: false, code: "already_paid" });
    expect(db.tables.photo_booking_payment_requests).toHaveLength(1);
  });

  it("after a failed or cancelled request a new one is created with generation + 1 and audited as regenerated", async () => {
    const { db, create } = setup();
    const first = await create();
    if (!first.ok) throw new Error("unreachable");
    await applyProviderResultToRequest(db.asClient(), { request: first.request, status: "failed", invoiceId: "INV-1", providerPaymentId: "PAY-1", errorCode: "DECLINED", errorMessage: "Insufficient funds", now: NOW });
    expect(db.tables.photo_booking_payment_requests[0]).toMatchObject({ status: "failed", error_code: "DECLINED", failed_at: NOW.toISOString() });
    const second = await create();
    expect(second.ok && second.created && second.regenerated).toBe(true);
    if (!second.ok) throw new Error("unreachable");
    expect(second.request.generation).toBe(2);
    expect(second.payUrl).not.toBe(first.payUrl);
    expect(audits(db)).toEqual(["payment_request.created", "payment_request.created", "payment_request.regenerated"]);

    const cancelled = await cancelStagePaymentRequest(db.asClient(), { request: second.request, actor, reason: "regenerated", now: NOW });
    expect(cancelled).toEqual({ ok: true, changed: true });
    const third = await create();
    expect(third.ok && third.request.generation).toBe(3);
    expect(db.tables.photo_booking_payment_requests.filter((r) => r.status === "pending")).toHaveLength(1);
  });

  it("without MyFatoorah configured it does not fake success: a safe admin blocker, or a pasted MANUAL_LINK", async () => {
    const { db, create } = setup();
    const off = await create({ paymentsEnabled: false });
    expect(off).toEqual({ ok: false, code: "payments_off", error: PAYMENTS_NOT_CONFIGURED_MESSAGE });
    expect(db.tables.photo_booking_payment_requests).toHaveLength(0);

    expect(await create({ paymentsEnabled: false, manualUrl: "http://pay.example/x" })).toMatchObject({ ok: false, code: "invalid_link" });
    expect(await create({ paymentsEnabled: false, manualUrl: "javascript:alert(1)" })).toMatchObject({ ok: false, code: "invalid_link" });
    const manual = await create({ paymentsEnabled: false, manualUrl: "https://portal.example/invoice/123" });
    expect(manual.ok).toBe(true);
    if (!manual.ok) throw new Error("unreachable");
    expect(manual.request).toMatchObject({ provider: "MANUAL_LINK", payment_url: "https://portal.example/invoice/123", pay_token_hash: null, amount_qr: 500, status: "pending" });
    expect(audits(db)).toEqual(["payment_request.created", "payment_request.manual_link"]);
    expect(isValidManualPaymentLink("https://user:pw@portal.example/x")).toBe(false);
  });

  it("the balance cannot be requested before delivery, and can once delivery made it due; delivery itself creates nothing", async () => {
    const { db, row } = setup();
    const early = await createStagePaymentRequest(db.asClient(), { booking: row, stage: "balance", actor, paymentsEnabled: true, siteUrl: SITE, now: NOW });
    expect(early).toMatchObject({ ok: false, code: "balance_not_due", error: "Final balance is not due until delivery." });
    const delivered = { ...row, booking_status: "delivered" as const, balance_state: "due" as const, balance_due_at: NOW.toISOString(), deposit_state: "paid" as const };
    expect(await listStageRequests(db.asClient(), BOOKING_ID)).toHaveLength(0);
    const later = await createStagePaymentRequest(db.asClient(), { booking: delivered, stage: "balance", actor, paymentsEnabled: true, siteUrl: SITE, now: NOW });
    expect(later.ok && later.request).toMatchObject({ stage: "balance", amount_qr: 500, status: "pending" });
    // Nothing was sent by creating it.
    expect(db.tables.photo_notification_deliveries).toHaveLength(0);
  });
});

describe("sendStagePaymentLink", () => {
  it("is the only path that messages the client: vendor-free e-mail with stage words, amount and OUR link, plus the owner's Telegram; stamps sent_at", async () => {
    const { db, create, row } = setup();
    const created = await create();
    if (!created.ok) throw new Error("unreachable");
    const out = await sendStagePaymentLink(db.asClient(), { booking: row, request: created.request, actor, businessName: "Blue Belt Media", portalUrl: `${SITE}/client/bookings/${BOOKING_ID}`, ownerUrl: `${SITE}/bookings/${BOOKING_ID}`, now: NOW });
    expect(out).toEqual({ ok: true, emailQueued: true });
    const mail = db.tables.photo_notification_deliveries.find((d) => d.channel === "email")!;
    const payload = mail.payload as { subject: string; text: string; to: string };
    expect(mail.kind).toBe("PAYMENT_REQUESTED");
    expect(payload.subject).toMatch(/^Complete your online payment/);
    expect(payload.text).toContain("deposit (50%)");
    expect(payload.text).toContain("500 QAR");
    expect(payload.text).toContain(created.payUrl);
    expect(payload.text).toContain("Open your payment link");
    expect(payload.text.toLowerCase()).not.toMatch(/fatoorah|pic-time|pictime/);
    expect(payload.text).not.toContain("—");
    const tg = db.tables.photo_notification_deliveries.find((d) => d.channel !== "email")!;
    expect(tg).toMatchObject({ kind: "BOOKING_PAYMENT_REQUESTED", owner_id: OWNER });
    expect(db.tables.photo_booking_payment_requests[0].sent_at).toBe(NOW.toISOString());
    expect(audits(db)).toContain("payment_request.sent");
  });

  it("refuses to send anything but a pending request", async () => {
    const { db, create, row } = setup();
    const created = await create();
    if (!created.ok) throw new Error("unreachable");
    await applyProviderResultToRequest(db.asClient(), { request: created.request, status: "cancelled", invoiceId: null, providerPaymentId: null, now: NOW });
    const req = db.tables.photo_booking_payment_requests[0] as unknown as typeof created.request;
    expect(await sendStagePaymentLink(db.asClient(), { booking: row, request: req, actor, businessName: "x", portalUrl: SITE, ownerUrl: SITE, now: NOW })).toMatchObject({ ok: false });
    expect(db.tables.photo_notification_deliveries).toHaveLength(0);
  });
});

describe("applyProviderResultToRequest", () => {
  it("paid never regresses to failed or cancelled; a duplicate verdict changes nothing", async () => {
    const { db, create } = setup();
    const created = await create();
    if (!created.ok) throw new Error("unreachable");
    const client = db.asClient();
    expect(await applyProviderResultToRequest(client, { request: created.request, status: "paid", invoiceId: "INV", providerPaymentId: "P1", now: NOW })).toEqual({ changed: true });
    const paid = db.tables.photo_booking_payment_requests[0] as unknown as typeof created.request;
    expect(paid).toMatchObject({ status: "paid", paid_at: NOW.toISOString(), provider_invoice_id: "INV", provider_payment_id: "P1" });
    expect(await applyProviderResultToRequest(client, { request: paid, status: "failed", invoiceId: "INV", providerPaymentId: "P2", now: NOW })).toEqual({ changed: false });
    expect(await applyProviderResultToRequest(client, { request: paid, status: "cancelled", invoiceId: "INV", providerPaymentId: null, now: NOW })).toEqual({ changed: false });
    expect(await applyProviderResultToRequest(client, { request: paid, status: "paid", invoiceId: "INV", providerPaymentId: "P1", now: NOW })).toEqual({ changed: false });
    expect(db.tables.photo_booking_payment_requests[0].status).toBe("paid");
  });
});
