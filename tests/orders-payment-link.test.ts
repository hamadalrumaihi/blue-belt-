import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLogger, setLogSink } from "@/lib/log";
import { INVOICE_JOB_LEASE_MS, INVOICE_JOB_MAX_ATTEMPTS, onOrderEmailFailed, onOrderEmailSent, orderInvoiceQueueStats, processOrderInvoice, requestOrderInvoice, resendOrderInvoiceEmail, runOrderInvoiceJobs, sendOrderInvoiceNow, type OrderServiceDeps } from "@/lib/orders/payment-link";
import type { PaymentProvider } from "@/lib/payments/myfatoorah/client";
import type { PhotoNotificationDeliveryRow, PhotoOrderRow } from "@/lib/supabase/database.types";
import { ORDER_ID, ORDER_OWNER, orderRow } from "./helpers/order-row";
import { FakeSupabase } from "./payments/fake-supabase";

vi.mock("server-only", () => ({}));
setLogSink(() => {});

const SITE = "https://site.test";
const T0 = Date.parse("2026-10-11T10:00:00.000Z");

type Row = Record<string, unknown>;

function setup(seed: PhotoOrderRow[] = [orderRow({ invoice_requested_at: "2026-10-11T09:59:00.000Z", invoice_requested_by: "auto" })], provider: PaymentProvider | null = fakeProvider()) {
  const db = new FakeSupabase();
  db.seed("photo_orders", seed as unknown as Row[]);
  db.seed("photo_studio", [{ owner_id: ORDER_OWNER, business_name: "BBM", settings: { orderInvoicing: { mode: "auto", autoSince: "2026-10-01T00:00:00.000Z" } } }]);
  let t = T0;
  const clock = { now: () => new Date(t), advance: (ms: number) => (t += ms) };
  const deps: OrderServiceDeps = { supabase: db.asClient(), provider, now: clock.now, log: createLogger({ test: true }), siteUrl: SITE };
  return { db, deps, clock };
}

function fakeProvider(over: Partial<{ createInvoice: PaymentProvider["createInvoice"]; getPaymentStatus: PaymentProvider["getPaymentStatus"] }> = {}): PaymentProvider {
  let n = 0;
  return {
    name: "MYFATOORAH",
    createInvoice: over.createInvoice ?? vi.fn(async () => ({ ok: true as const, data: { invoiceId: `INV-${++n}`, paymentUrl: `https://pay.test/INV-${n}`, customerReference: ORDER_ID, raw: {} } })),
    getPaymentStatus: over.getPaymentStatus ?? vi.fn(async () => ({ ok: false as const, error: { code: "not_used", message: "not used" } })),
  } as unknown as PaymentProvider;
}

const theOrder = (db: FakeSupabase) => db.tables.photo_orders.find((o) => o.id === ORDER_ID)!;
const emails = (db: FakeSupabase) => db.tables.photo_notification_deliveries.filter((d) => d.channel === "email");
const telegrams = (db: FakeSupabase) => db.tables.photo_notification_deliveries.filter((d) => d.channel === "telegram");

describe("processOrderInvoice — one link, one invoice, one e-mail", () => {
  let db: FakeSupabase;
  let deps: OrderServiceDeps;
  let clock: { now: () => Date; advance: (ms: number) => number };
  beforeEach(() => ({ db, deps, clock } = setup()));

  it("mints the private link once, creates one provider invoice, queues one e-mail and one owner card, then completes", async () => {
    const out = await processOrderInvoice(deps, ORDER_ID);
    expect(out.kind).toBe("queued");
    const o = theOrder(db);
    expect(String(o.payment_url)).toMatch(new RegExp(`^${SITE}/pay/order/bbo_[A-Za-z0-9]{40}$`));
    expect(o.pay_token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(o).toMatchObject({ provider_invoice_id: "INV-1", invoice_email_state: "queued", invoice_email_count: 1, invoice_exception: null, invoice_job_leased_until: null });
    expect(o.invoice_completed_at).toBeTruthy();
    expect(deps.provider!.createInvoice).toHaveBeenCalledTimes(1);
    // The provider gets our page as the return URL, never the other way round.
    const input = (deps.provider!.createInvoice as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>;
    expect(input).toMatchObject({ amount: 120, displayCurrencyIso: "QAR", customerReference: ORDER_ID, callbackUrl: `${o.payment_url}?result=callback`, errorUrl: `${o.payment_url}?result=error` });
    expect(emails(db)).toHaveLength(1);
    expect(emails(db)[0]).toMatchObject({ kind: "ORDER_PAYMENT_LINK", alert_key: `email:order:${ORDER_ID}:payment-link:1`, status: "pending" });
    const payload = emails(db)[0].payload as Record<string, unknown>;
    expect(payload).toMatchObject({ to: "buyer@example.com", orderId: ORDER_ID, sendCount: 1 });
    expect(String(payload.html)).toContain(String(o.payment_url));
    expect(String(payload.html)).not.toMatch(/myfatoorah|INV-1/i);
    expect(telegrams(db)).toHaveLength(1);
    expect(telegrams(db)[0]).toMatchObject({ kind: "ORDER_INVOICE", alert_key: `order:${ORDER_ID}:invoice:1` });
    const tg = telegrams(db)[0].payload as Record<string, unknown>;
    expect(tg.order_id).toBe(ORDER_ID);
    expect(JSON.stringify(tg.buttons)).toContain("Check payment");
    expect(JSON.stringify(tg.buttons)).not.toContain("Send invoice");
    expect(tg.supersedes).toEqual([`order:pictime:PT-1`]);

    // Running it again (cron tick, intake kick, a second button press) does nothing new.
    expect((await processOrderInvoice(deps, ORDER_ID)).kind).toBe("skipped");
    expect(await runOrderInvoiceJobs(deps)).toMatchObject({ scanned: 0 });
    expect(deps.provider!.createInvoice).toHaveBeenCalledTimes(1);
    expect(emails(db)).toHaveLength(1);
    expect(telegrams(db)).toHaveLength(1);
  });

  it("repeated Send invoice presses are idempotent, and a resend never creates a second invoice", async () => {
    const actor = { kind: "telegram" as const, userId: ORDER_OWNER, telegramUserId: 42 };
    const first = await sendOrderInvoiceNow(deps, ORDER_ID, actor);
    expect(first.ok).toBe(true);
    const second = await sendOrderInvoiceNow(deps, ORDER_ID, actor);
    expect(second).toMatchObject({ ok: true, message: expect.stringMatching(/already created/) });
    expect(deps.provider!.createInvoice).toHaveBeenCalledTimes(1);
    expect(emails(db)).toHaveLength(1);

    // The e-mail went out; now the owner asks for a resend.
    await onOrderEmailSent(deps.supabase, emails(db)[0] as unknown as PhotoNotificationDeliveryRow, clock.now(), SITE);
    expect(theOrder(db).invoice_email_state).toBe("sent");
    const third = await sendOrderInvoiceNow(deps, ORDER_ID, actor);
    expect(third).toMatchObject({ ok: true, message: expect.stringMatching(/Resend e-mail/) });
    const resend = await resendOrderInvoiceEmail(deps, ORDER_ID, actor);
    expect(resend).toMatchObject({ ok: true, message: expect.stringMatching(/E-mail 2 queued/) });
    expect(deps.provider!.createInvoice).toHaveBeenCalledTimes(1);
    expect(emails(db)).toHaveLength(2);
    expect(emails(db)[1]).toMatchObject({ alert_key: `email:order:${ORDER_ID}:payment-link:2` });
    expect(theOrder(db)).toMatchObject({ invoice_email_count: 2, invoice_email_state: "queued", provider_invoice_id: "INV-1" });
    // The resend edits the previous Telegram card rather than adding another.
    const cards = telegrams(db).filter((d) => d.kind === "ORDER_INVOICE");
    expect(cards.map((c) => c.alert_key)).toEqual([`order:${ORDER_ID}:invoice:1`, `order:${ORDER_ID}:invoice-sent:1`, `order:${ORDER_ID}:invoice:2`]);
    expect((cards[2].payload as Record<string, unknown>).edit_of).toBe(`order:${ORDER_ID}:invoice:1`);
    // A third resend queues count 3; the alert key makes each count exactly one row.
    const fourth = await resendOrderInvoiceEmail(deps, ORDER_ID, actor);
    expect(fourth.ok).toBe(true);
    expect(emails(db)).toHaveLength(3);
    expect(new Set(emails(db).map((e) => e.alert_key)).size).toBe(3);
  });

  it("the lease stops two runners working the same order; a dead runner's lease expires", async () => {
    const o = theOrder(db);
    o.invoice_job_leased_until = new Date(T0 + INVOICE_JOB_LEASE_MS - 1000).toISOString();
    expect(await processOrderInvoice(deps, ORDER_ID)).toMatchObject({ kind: "skipped", reason: "in_progress" });
    expect(deps.provider!.createInvoice).not.toHaveBeenCalled();
    clock.advance(INVOICE_JOB_LEASE_MS);
    expect((await processOrderInvoice(deps, ORDER_ID)).kind).toBe("queued");
    expect(deps.provider!.createInvoice).toHaveBeenCalledTimes(1);
  });

  it("an uncertain provider answer is retried with backoff and ends in the exception queue after the attempt budget, never a duplicate invoice", async () => {
    const createInvoice = vi.fn(async () => ({ ok: false as const, error: { code: "network" as const, message: "socket hang up" } }));
    ({ db, deps, clock } = setup(undefined, fakeProvider({ createInvoice: createInvoice as unknown as PaymentProvider["createInvoice"] })));
    for (let attempt = 1; attempt < INVOICE_JOB_MAX_ATTEMPTS; attempt += 1) {
      const out = await processOrderInvoice(deps, ORDER_ID);
      expect(out.kind).toBe("retry_later");
      const o = theOrder(db);
      expect(o).toMatchObject({ invoice_job_attempts: attempt, invoice_job_leased_until: null, invoice_exception: null });
      expect(o.invoice_completed_at ?? null).toBeNull();
      expect(String(o.invoice_next_attempt_at) > clock.now().toISOString()).toBe(true);
      // Not due yet: the runner leaves it alone.
      expect(await runOrderInvoiceJobs(deps)).toMatchObject({ scanned: 0 });
      clock.advance(3 * 60 * 60_000);
    }
    const last = await processOrderInvoice(deps, ORDER_ID);
    expect(last).toMatchObject({ kind: "exception", reason: "provider_failed" });
    expect(theOrder(db)).toMatchObject({ invoice_exception: "provider_failed", invoice_email_state: "exception", invoice_job_attempts: INVOICE_JOB_MAX_ATTEMPTS });
    expect(theOrder(db).invoice_completed_at).toBeTruthy();
    // The link was minted on the first attempt and kept; no e-mail ever went out.
    expect(theOrder(db).pay_token_hash).toBeTruthy();
    expect(emails(db)).toHaveLength(0);
    const exception = telegrams(db).find((d) => d.kind === "ORDER_EXCEPTION")!;
    expect(exception.alert_key).toBe(`order:${ORDER_ID}:exception:provider_failed:${INVOICE_JOB_MAX_ATTEMPTS}`);
    expect(telegrams(db).filter((d) => d.kind === "ORDER_EXCEPTION")).toHaveLength(1);
    expect(JSON.stringify((exception.payload as Record<string, unknown>).buttons)).toContain("Send invoice");
    expect(await orderInvoiceQueueStats(deps.supabase)).toMatchObject({ waiting: 0, exceptions: 1 });

    // The owner presses Send invoice: the job is re-opened with a fresh budget and succeeds now that the provider answers.
    createInvoice.mockResolvedValue({ ok: true, data: { invoiceId: "INV-OK", paymentUrl: "https://pay.test/INV-OK", customerReference: ORDER_ID, raw: {} } } as never);
    const retried = await sendOrderInvoiceNow(deps, ORDER_ID, { kind: "owner", userId: ORDER_OWNER });
    expect(retried.ok).toBe(true);
    expect(theOrder(db)).toMatchObject({ provider_invoice_id: "INV-OK", invoice_exception: null, invoice_email_state: "queued", invoice_job_attempts: 0 });
    expect(emails(db)).toHaveLength(1);
  });

  it("with the owner's payment-link e-mails switched off, the link and invoice exist but the order is an exception (no silent send)", async () => {
    db.seed("photo_client_notification_prefs", [{ owner_id: ORDER_OWNER, kind: "ORDER_PAYMENT_LINK", enabled: false }]);
    const out = await processOrderInvoice(deps, ORDER_ID);
    expect(out).toMatchObject({ kind: "exception", reason: "email_disabled" });
    expect(theOrder(db)).toMatchObject({ provider_invoice_id: "INV-1", invoice_exception: "email_disabled" });
    expect(emails(db)).toHaveLength(0);
  });

  it("no e-mail address: the order is an exception before any provider call, and the card says so", async () => {
    ({ db, deps } = setup([orderRow({ customer_email: null, invoice_requested_at: "2026-10-11T09:59:00.000Z" })]));
    const out = await processOrderInvoice(deps, ORDER_ID);
    expect(out).toMatchObject({ kind: "exception", reason: "no_email" });
    // The link and the invoice exist (the owner can share the link by hand), but nothing was e-mailed.
    expect(theOrder(db).pay_token_hash).toBeTruthy();
    expect(emails(db)).toHaveLength(0);
    expect(String((telegrams(db)[0].payload as Record<string, unknown>).text)).toMatch(/no e-mail address/);
  });

  it("without a provider configured the job is an exception, not a crash", async () => {
    ({ db, deps } = setup(undefined, null));
    expect(await processOrderInvoice(deps, ORDER_ID)).toMatchObject({ kind: "exception", reason: "payments_off" });
  });

  it("a blocker that appears after the request (paid by hand meanwhile) completes the job without billing", async () => {
    theOrder(db).payment_state = "paid";
    expect(await processOrderInvoice(deps, ORDER_ID)).toMatchObject({ kind: "skipped", reason: "paid" });
    expect(theOrder(db).invoice_completed_at).toBeTruthy();
    expect(deps.provider!.createInvoice).not.toHaveBeenCalled();
    expect(emails(db)).toHaveLength(0);
  });
});

describe("requestOrderInvoice / runner scope", () => {
  it("stamps the request once; automatic re-requests are no-ops; the historical paid order is refused outright", async () => {
    const { db, deps } = setup([orderRow({ id: ORDER_ID }), orderRow({ id: "55555555-5555-4555-8555-555555555555", external_ref: "OLD-240", amount_qr: 240, payment_state: "paid" })]);
    const first = await requestOrderInvoice(deps, theOrder(db) as unknown as PhotoOrderRow, { kind: "auto" });
    expect(first).toEqual({ ok: true, queued: true, retried: false });
    expect(theOrder(db)).toMatchObject({ invoice_requested_by: "auto" });
    expect(await requestOrderInvoice(deps, theOrder(db) as unknown as PhotoOrderRow, { kind: "auto" })).toEqual({ ok: true, queued: false, retried: false });
    const paid = db.tables.photo_orders[1] as unknown as PhotoOrderRow;
    expect(await requestOrderInvoice(deps, paid, { kind: "owner", userId: ORDER_OWNER })).toMatchObject({ ok: false, code: "paid" });
    expect(await sendOrderInvoiceNow(deps, paid.id, { kind: "owner", userId: ORDER_OWNER })).toMatchObject({ ok: false, error: /already paid/ });
    // The runner only ever touches requested rows.
    const summary = await runOrderInvoiceJobs(deps);
    expect(summary).toMatchObject({ scanned: 1, queued: 1 });
    expect(db.tables.photo_orders[1].invoice_requested_at ?? null).toBeNull();
  });

  it("runOrderInvoiceJobs honours the limit, the order filter and the time budget", async () => {
    const ids = ["66666666-6666-4666-8666-666666666661", "66666666-6666-4666-8666-666666666662", "66666666-6666-4666-8666-666666666663"];
    const { db, deps } = setup(ids.map((id, i) => orderRow({ id, external_ref: id, invoice_requested_at: `2026-10-11T09:5${i}:00.000Z` })));
    expect(await runOrderInvoiceJobs(deps, { limit: 2 })).toMatchObject({ scanned: 2, queued: 2 });
    expect(db.tables.photo_orders.filter((o) => o.invoice_completed_at).map((o) => o.id)).toEqual(ids.slice(0, 2));
    expect(await runOrderInvoiceJobs(deps, { orderId: ids[2] })).toMatchObject({ scanned: 1, queued: 1 });
    const { deps: tight } = setup(ids.map((id) => orderRow({ id, external_ref: id, invoice_requested_at: "2026-10-11T09:50:00.000Z" })));
    expect(await runOrderInvoiceJobs(tight, { budgetMs: 0 })).toMatchObject({ scanned: 0, budgetHit: true });
  });
});

describe("e-mail outcome hooks", () => {
  it("sent → order says sent and the card is edited; failed → order says failed and the owner gets a retry card", async () => {
    const { db, deps, clock } = setup();
    await processOrderInvoice(deps, ORDER_ID);
    const email = emails(db)[0] as unknown as PhotoNotificationDeliveryRow;
    await onOrderEmailSent(deps.supabase, email, clock.now(), SITE);
    expect(theOrder(db).invoice_email_state).toBe("sent");
    const sentCard = telegrams(db).find((d) => d.alert_key === `order:${ORDER_ID}:invoice-sent:1`)!;
    expect((sentCard.payload as Record<string, unknown>).edit_of).toBe(`order:${ORDER_ID}:invoice:1`);
    // A second "sent" for the same row changes nothing more.
    await onOrderEmailSent(deps.supabase, email, clock.now(), SITE);
    expect(telegrams(db).filter((d) => d.alert_key === `order:${ORDER_ID}:invoice-sent:1`)).toHaveLength(1);

    const again = setup();
    const secondRun = await processOrderInvoice(again.deps, ORDER_ID);
    expect(secondRun.kind, JSON.stringify(secondRun)).toBe("queued");
    expect(emails(again.db), JSON.stringify(again.db.tables.photo_notification_deliveries)).toHaveLength(1);
    await onOrderEmailFailed(again.deps.supabase, { ...(emails(again.db)[0] as unknown as PhotoNotificationDeliveryRow), last_error: "resend 500" }, again.clock.now(), SITE);
    expect(theOrder(again.db).invoice_email_state).toBe("failed");
    const failedCard = telegrams(again.db).find((d) => d.alert_key === `order:${ORDER_ID}:invoice-failed:1`)!;
    expect(failedCard.kind).toBe("ORDER_EXCEPTION");
    expect(JSON.stringify((failedCard.payload as Record<string, unknown>).buttons)).toContain("Retry e-mail");
    // Unrelated e-mails (a booking confirmation) are ignored by the hooks.
    await onOrderEmailSent(again.deps.supabase, { ...(emails(again.db)[0] as unknown as PhotoNotificationDeliveryRow), kind: "BOOKING_CONFIRMED" }, again.clock.now(), SITE);
    expect(theOrder(again.db).invoice_email_state).toBe("failed");
  });
});
