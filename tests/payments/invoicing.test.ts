import { describe, expect, it, vi } from "vitest";
import { createLogger, setLogSink } from "@/lib/log";
import type { CreateInvoiceInput, CreateInvoiceOutput, PaymentProvider, PaymentStatusOutput, ProviderResult } from "@/lib/payments/myfatoorah/client";
import { autoInvoiceOrders, createInvoiceForOrder, createStandaloneInvoice, eligibleForAutoInvoice, INVOICE_CLAIM_TTL_MS, invoiceInputForOrder, MAX_AUTO_INVOICE_ATTEMPTS, type InvoiceDeps } from "@/lib/payments/invoicing";
import type { PhotoOrderRow } from "@/lib/supabase/database.types";
import { FakeSupabase } from "./fake-supabase";
import { OWNER } from "./fixtures";

vi.mock("server-only", () => ({}));
setLogSink(() => {});

const ORDER_ID = "33333333-3333-4333-8333-333333333333";

function order(overrides: Partial<PhotoOrderRow> = {}): PhotoOrderRow {
  return {
    id: ORDER_ID,
    owner_id: OWNER,
    pictime_order_id: "PT-1",
    customer_name: "Buyer One",
    customer_email: "buyer@example.com",
    customer_phone: null,
    gallery_name: "Doha Open",
    amount_qr: 120,
    currency: "QAR",
    status: "placed",
    provider: null,
    provider_invoice_id: null,
    payment_url: null,
    paid_at: null,
    approved_in_pictime_at: null,
    metadata: {},
    source: "pictime",
    external_ref: "PT-1",
    payment_method: "fawran",
    payment_state: "pending",
    payment_reference: null,
    payment_reported_state: null,
    items: [],
    placed_at: null,
    received_at: "2026-10-02T10:00:00.000Z",
    buyer_note: null,
    athlete_name_hint: null,
    raw: {},
    payment_confirmed_at: null,
    payment_confirmed_by: null,
    fulfilled_at: null,
    invoice_claimed_at: null,
    created_at: "2026-10-02T10:00:00.000Z",
    updated_at: "2026-10-02T10:00:00.000Z",
    ...overrides,
  };
}

function fakeProvider(
  createInvoice?: (input: CreateInvoiceInput) => Promise<ProviderResult<CreateInvoiceOutput>>,
  getPaymentStatus?: () => Promise<ProviderResult<PaymentStatusOutput>>,
): PaymentProvider & { calls: CreateInvoiceInput[]; statusCalls: number } {
  const calls: CreateInvoiceInput[] = [];
  const self = {
    name: "MYFATOORAH" as const,
    calls,
    statusCalls: 0,
    createInvoice: async (input: CreateInvoiceInput): Promise<ProviderResult<CreateInvoiceOutput>> => {
      calls.push(input);
      if (createInvoice) return createInvoice(input);
      return { ok: true, data: { invoiceId: "INV-NEW", paymentUrl: "https://pay.test/INV-NEW", customerReference: input.customerReference, raw: {} } };
    },
    getPaymentStatus: async (): Promise<ProviderResult<PaymentStatusOutput>> => {
      self.statusCalls += 1;
      if (getPaymentStatus) return getPaymentStatus();
      return { ok: false, error: { code: "provider", message: "No invoice for this key" } };
    },
  };
  return self;
}

function setup(seedOrders: PhotoOrderRow[] = []) {
  const db = new FakeSupabase();
  if (seedOrders.length) db.seed("photo_orders", seedOrders as unknown as Record<string, unknown>[]);
  let t = Date.parse("2026-10-03T09:00:00.000Z");
  const deps: InvoiceDeps = { supabase: db.asClient(), now: () => new Date((t += 1000)), log: createLogger({ test: true }) };
  return { db, deps };
}

describe("eligibleForAutoInvoice", () => {
  it("is true for an unpaid offline order with an amount and no invoice", () => {
    expect(eligibleForAutoInvoice(order())).toBe(true);
    expect(eligibleForAutoInvoice(order({ payment_method: "bank_transfer" }))).toBe(true);
    expect(eligibleForAutoInvoice(order({ payment_method: "cash" }))).toBe(true);
  });
  it("is false for a card order (already paid in Pic-Time)", () => {
    expect(eligibleForAutoInvoice(order({ payment_method: "card" }))).toBe(false);
  });
  it("is false when already invoiced, paid, refunded, cancelled, or zero amount", () => {
    expect(eligibleForAutoInvoice(order({ provider_invoice_id: "X" }))).toBe(false);
    expect(eligibleForAutoInvoice(order({ payment_state: "paid" }))).toBe(false);
    expect(eligibleForAutoInvoice(order({ payment_state: "refunded" }))).toBe(false);
    expect(eligibleForAutoInvoice(order({ status: "cancelled" }))).toBe(false);
    expect(eligibleForAutoInvoice(order({ amount_qr: 0 }))).toBe(false);
  });
  it("stops auto-invoicing an order after repeated provider failures", () => {
    expect(eligibleForAutoInvoice(order({ metadata: { invoice_attempts: MAX_AUTO_INVOICE_ATTEMPTS - 1 } }))).toBe(true);
    expect(eligibleForAutoInvoice(order({ metadata: { invoice_attempts: MAX_AUTO_INVOICE_ATTEMPTS } }))).toBe(false);
  });
});

describe("invoiceInputForOrder", () => {
  it("carries the order id as the customerReference", () => {
    const input = invoiceInputForOrder(order({ external_ref: "PT-9" }));
    expect(input).toMatchObject({ amount: 120, customerName: "Buyer One", customerReference: ORDER_ID, customerEmail: "buyer@example.com", displayCurrencyIso: "QAR", userDefinedField: "PT-9" });
  });
});

describe("createInvoiceForOrder", () => {
  it("creates an invoice and writes the invoice id + payment url back on the order", async () => {
    const { db, deps } = setup([order()]);
    const provider = fakeProvider();
    const result = await createInvoiceForOrder(order(), provider, deps);
    expect(result).toMatchObject({ ok: true, orderId: ORDER_ID, invoiceId: "INV-NEW", paymentUrl: "https://pay.test/INV-NEW" });
    expect(provider.calls[0].customerReference).toBe(ORDER_ID);
    const saved = db.tables.photo_orders.find((o) => o.id === ORDER_ID)!;
    expect(saved).toMatchObject({ provider: "MYFATOORAH", provider_invoice_id: "INV-NEW", payment_url: "https://pay.test/INV-NEW" });
    expect((saved.metadata as { invoice?: { invoice_id?: string } }).invoice?.invoice_id).toBe("INV-NEW");
  });

  it("is a no-op success when the order already has an invoice (no provider call)", async () => {
    const existing = order({ provider_invoice_id: "INV-OLD", payment_url: "https://pay.test/INV-OLD", provider: "MYFATOORAH" });
    const { deps } = setup([existing]);
    const provider = fakeProvider();
    const result = await createInvoiceForOrder(existing, provider, deps);
    expect(result).toEqual({ ok: true, orderId: ORDER_ID, invoiceId: "INV-OLD", paymentUrl: "https://pay.test/INV-OLD", alreadyInvoiced: true });
    expect(provider.calls).toHaveLength(0);
  });

  it("never creates two invoices when two callers race for the same order", async () => {
    const { db, deps } = setup([order()]);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const provider = fakeProvider(async (input) => {
      await gate;
      return { ok: true, data: { invoiceId: "INV-ONE", paymentUrl: "https://pay.test/INV-ONE", customerReference: input.customerReference, raw: {} } };
    });
    // Both read the same unclaimed order; only one may reach the provider.
    const first = createInvoiceForOrder(order(), provider, deps);
    const second = await createInvoiceForOrder(order(), provider, deps);
    release();
    expect(await first).toMatchObject({ ok: true, invoiceId: "INV-ONE" });
    expect(second).toMatchObject({ ok: false, reason: "in_progress" });
    expect(provider.calls).toHaveLength(1);
    expect(db.tables.photo_orders[0]).toMatchObject({ provider_invoice_id: "INV-ONE", invoice_claimed_at: null });
  });

  it("answers in_progress while another caller's claim is fresh", async () => {
    const claimed = order({ invoice_claimed_at: "2026-10-03T08:59:00.000Z" });
    const { deps } = setup([claimed]);
    const provider = fakeProvider();
    expect(await createInvoiceForOrder(claimed, provider, deps)).toMatchObject({ ok: false, reason: "in_progress" });
    expect(provider.calls).toHaveLength(0);
    expect(provider.statusCalls).toBe(0);
  });

  it("re-links the invoice of a stale claim by CustomerReference instead of creating another", async () => {
    const stale = order({ invoice_claimed_at: new Date(Date.parse("2026-10-03T09:00:00.000Z") - INVOICE_CLAIM_TTL_MS - 60_000).toISOString() });
    const { db, deps } = setup([stale]);
    const provider = fakeProvider(undefined, async () => ({ ok: true, data: { invoiceId: "INV-LOST", invoiceStatus: "Pending", invoiceReference: null, customerReference: ORDER_ID, invoiceValue: 120, transactions: [], raw: {} } }));
    const result = await createInvoiceForOrder(stale, provider, deps);
    expect(result).toMatchObject({ ok: true, invoiceId: "INV-LOST", relinked: true, paymentUrl: null });
    expect(provider.calls).toHaveLength(0);
    expect(db.tables.photo_orders[0]).toMatchObject({ provider_invoice_id: "INV-LOST", invoice_claimed_at: null });
  });

  it("takes over a stale claim and creates the invoice when MyFatoorah has none", async () => {
    const staleAt = new Date(Date.parse("2026-10-03T09:00:00.000Z") - INVOICE_CLAIM_TTL_MS - 60_000).toISOString();
    const stale = order({ invoice_claimed_at: staleAt });
    const { db, deps } = setup([stale]);
    const provider = fakeProvider();
    expect(await createInvoiceForOrder(stale, provider, deps)).toMatchObject({ ok: true, invoiceId: "INV-NEW" });
    expect(provider.statusCalls).toBe(1);
    expect(provider.calls).toHaveLength(1);
    expect(db.tables.photo_orders[0]).toMatchObject({ provider_invoice_id: "INV-NEW", invoice_claimed_at: null });
  });

  it("does not create anything when the stale-claim lookup is inconclusive (network)", async () => {
    const stale = order({ invoice_claimed_at: "2026-10-01T00:00:00.000Z" });
    const { deps } = setup([stale]);
    const provider = fakeProvider(undefined, async () => ({ ok: false, error: { code: "timeout", message: "slow" } }));
    expect(await createInvoiceForOrder(stale, provider, deps)).toMatchObject({ ok: false, reason: "provider_error", detail: "relink_timeout" });
    expect(provider.calls).toHaveLength(0);
  });

  it("logs an orphan instead of overwriting when another invoice landed first", async () => {
    const { db, deps } = setup([order()]);
    const provider = fakeProvider(async (input) => {
      // Something else records an invoice while SendPayment is in flight.
      Object.assign(db.tables.photo_orders[0], { provider_invoice_id: "INV-OTHER" });
      return { ok: true, data: { invoiceId: "INV-LATE", paymentUrl: "https://pay.test/INV-LATE", customerReference: input.customerReference, raw: {} } };
    });
    expect(await createInvoiceForOrder(order(), provider, deps)).toMatchObject({ ok: false, reason: "provider_error", detail: "orphan" });
    expect(db.tables.photo_orders[0].provider_invoice_id).toBe("INV-OTHER");
  });

  it("refuses a paid, cancelled or zero-amount order", async () => {
    const { deps } = setup();
    const provider = fakeProvider();
    expect(await createInvoiceForOrder(order({ payment_state: "paid" }), provider, deps)).toMatchObject({ ok: false, reason: "already_paid" });
    expect(await createInvoiceForOrder(order({ status: "cancelled" }), provider, deps)).toMatchObject({ ok: false, reason: "cancelled" });
    expect(await createInvoiceForOrder(order({ amount_qr: 0 }), provider, deps)).toMatchObject({ ok: false, reason: "no_amount" });
    expect(provider.calls).toHaveLength(0);
  });

  it("reports a provider error, releases the claim and counts the attempt", async () => {
    const { db, deps } = setup([order()]);
    const provider = fakeProvider(async () => ({ ok: false, error: { code: "provider", message: "declined" } }));
    const result = await createInvoiceForOrder(order(), provider, deps);
    expect(result).toMatchObject({ ok: false, reason: "provider_error" });
    const saved = db.tables.photo_orders.find((o) => o.id === ORDER_ID)!;
    expect(saved.provider_invoice_id ?? null).toBeNull();
    expect(saved.invoice_claimed_at).toBeNull();
    expect(saved.metadata).toMatchObject({ invoice_attempts: 1, invoice_last_error: "provider" });
  });
});

describe("autoInvoiceOrders", () => {
  it("invoices only the eligible unpaid offline orders", async () => {
    const eligible = order({ id: "a1", external_ref: "a1", payment_method: "fawran", payment_state: "pending" });
    const card = order({ id: "a2", external_ref: "a2", payment_method: "card", payment_state: "pending" });
    const paid = order({ id: "a3", external_ref: "a3", payment_method: "fawran", payment_state: "paid" });
    const invoiced = order({ id: "a4", external_ref: "a4", payment_method: "fawran", provider_invoice_id: "INV-X" });
    const { db, deps } = setup([eligible, card, paid, invoiced]);
    const provider = fakeProvider();
    const out = await autoInvoiceOrders(provider, deps, { limit: 25 });
    expect(out.invoiced).toBe(1);
    expect(provider.calls.map((c) => c.customerReference)).toEqual(["a1"]);
    expect(db.tables.photo_orders.find((o) => o.id === "a1")!.provider_invoice_id).toBe("INV-NEW");
    expect(db.tables.photo_orders.find((o) => o.id === "a2")!.provider_invoice_id ?? null).toBeNull();
  });
});

describe("createStandaloneInvoice", () => {
  it("inserts a booking and invoices it with the booking id as the reference", async () => {
    const { db, deps } = setup();
    const provider = fakeProvider();
    const result = await createStandaloneInvoice(
      { ownerId: OWNER, customerName: "Direct Buyer", customerEmail: "d@example.com", customerPhone: "+97400000001", packageName: "Event photos", amountQr: 200 },
      provider,
      deps,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(provider.calls[0].customerReference).toBe(result.bookingId);
    const b = db.tables.photo_bookings.find((x) => x.id === result.bookingId)!;
    expect(b).toMatchObject({ owner_id: OWNER, provider: "MYFATOORAH", provider_invoice_id: "INV-NEW", payment_url: "https://pay.test/INV-NEW", status: "pending", amount_qr: 200 });
  });

  it("refuses a zero amount", async () => {
    const { deps } = setup();
    const provider = fakeProvider();
    const result = await createStandaloneInvoice({ ownerId: OWNER, customerName: "X", customerEmail: "x@x.com", customerPhone: "", packageName: "P", amountQr: 0 }, provider, deps);
    expect(result).toMatchObject({ ok: false, reason: "no_amount" });
    expect(provider.calls).toHaveLength(0);
  });
});
