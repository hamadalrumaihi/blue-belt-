import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLogSink } from "@/lib/log";
import { resetRateLimits } from "@/lib/rate-limit";
import { FakeSupabase } from "./fake-supabase";
import { SECRET, booking, paymentEvent } from "./fixtures";

vi.mock("server-only", () => ({}));
const db = new FakeSupabase();
vi.mock("@/lib/supabase/service", () => ({ isServiceClientConfigured: () => true, createServiceClient: () => db.asClient() }));
const getPaymentStatus = vi.hoisted(() => vi.fn());
const createInvoice = vi.hoisted(() => vi.fn());
vi.mock("@/lib/payments/myfatoorah/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/payments/myfatoorah/client")>("@/lib/payments/myfatoorah/client");
  return { ...actual, createMyFatoorahClient: () => ({ name: "MYFATOORAH", createInvoice, getPaymentStatus }) };
});
setLogSink(() => {});

const CRON = "cron-secret-0123456789";
const post = (auth: string | null = `Bearer ${CRON}`) => {
  const headers: Record<string, string> = {};
  if (auth) headers.authorization = auth;
  return new Request("https://example.test/api/cron/payments", { method: "POST", headers, body: "{}" });
};

async function route() {
  vi.resetModules();
  (await import("@/lib/log")).setLogSink(() => {});
  return import("@/app/api/cron/payments/route");
}

describe("POST /api/cron/payments (confirmation job)", () => {
  beforeEach(() => {
    resetRateLimits();
    vi.stubEnv("CRON_SECRET", CRON);
    vi.stubEnv("PAYMENTS_MYFATOORAH_ENABLED", "1");
    vi.stubEnv("MYFATOORAH_API_KEY", "sk_test");
    vi.stubEnv("MYFATOORAH_WEBHOOK_SECRET", SECRET);
    vi.stubEnv("PAYMENTS_RECONCILE_ENABLED", "0");
    vi.stubEnv("PAYMENTS_AUTO_INVOICE_ENABLED", "0");
    db.tables.photo_bookings = [];
    db.tables.photo_payment_events = [];
    db.tables.photo_payment_attempts = [];
    db.tables.photo_notification_deliveries = [];
    db.tables.photo_orders = [];
    getPaymentStatus.mockReset();
    createInvoice.mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("is dark without the payments flag and needs the cron secret", async () => {
    vi.stubEnv("PAYMENTS_MYFATOORAH_ENABLED", "0");
    expect((await (await route()).POST(post())).status).toBe(404);
    vi.stubEnv("PAYMENTS_MYFATOORAH_ENABLED", "1");
    expect((await (await route()).POST(post(null))).status).toBe(401);
  });

  it("replays unmatched verified events and does NOT call the provider unless reconciliation is switched on", async () => {
    db.seed("photo_payment_events", [{ provider: "MYFATOORAH", provider_event_id: "WH-626519", event_type: "PAYMENT_STATUS_CHANGED", payload: paymentEvent(), signature_valid: true, processing_result: "booking_not_found", received_at: "2026-10-02T10:00:00.000Z" }]);
    db.seed("photo_bookings", [booking({ created_at: "2026-10-01T00:00:00.000Z" })]);
    const res = await (await route()).POST(post());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, replay: { scanned: 1, applied: 1 }, reconcile: { enabled: false, scanned: 0 } });
    expect(db.tables.photo_bookings[0].status).toBe("paid");
    expect(getPaymentStatus).not.toHaveBeenCalled();
  });

  it("does NOT auto-invoice orders unless PAYMENTS_AUTO_INVOICE_ENABLED=1", async () => {
    db.seed("photo_orders", [{ id: "o1", owner_id: "owner", amount_qr: 120, currency: "QAR", status: "placed", provider: null, provider_invoice_id: null, payment_url: null, payment_state: "pending", payment_method: "fawran", customer_name: "B", customer_email: "b@x.com", metadata: {}, external_ref: "o1", received_at: "2026-10-02T10:00:00.000Z" }]);
    const body = await (await (await route()).POST(post())).json();
    expect(body.autoInvoice).toMatchObject({ enabled: false });
    expect(createInvoice).not.toHaveBeenCalled();
  });

  it("with PAYMENTS_AUTO_INVOICE_ENABLED=1 it invoices eligible unpaid offline orders", async () => {
    vi.stubEnv("PAYMENTS_AUTO_INVOICE_ENABLED", "1");
    db.seed("photo_orders", [{ id: "o1", owner_id: "owner", amount_qr: 120, currency: "QAR", status: "placed", provider: null, provider_invoice_id: null, payment_url: null, payment_state: "pending", payment_method: "fawran", customer_name: "B", customer_email: "b@x.com", metadata: {}, external_ref: "o1", received_at: "2026-10-02T10:00:00.000Z" }]);
    createInvoice.mockResolvedValue({ ok: true, data: { invoiceId: "INV-A", paymentUrl: "https://pay.test/INV-A", customerReference: "o1", raw: {} } });
    const body = await (await (await route()).POST(post())).json();
    expect(body.autoInvoice).toMatchObject({ enabled: true, scanned: 1, invoiced: 1, failed: 0 });
    expect(createInvoice).toHaveBeenCalledTimes(1);
    expect(db.tables.photo_orders[0].provider_invoice_id).toBe("INV-A");
  });

  it("with PAYMENTS_RECONCILE_ENABLED=1 it asks the provider about old pending bookings", async () => {
    vi.stubEnv("PAYMENTS_RECONCILE_ENABLED", "1");
    db.seed("photo_bookings", [booking({ created_at: "2026-10-01T00:00:00.000Z" })]);
    getPaymentStatus.mockResolvedValue({ ok: true, data: { invoiceId: "6409988", invoiceStatus: "Pending", invoiceReference: "r", customerReference: "c", invoiceValue: 350, transactions: [], raw: {} } });
    const body = await (await (await route()).POST(post())).json();
    expect(body.reconcile).toMatchObject({ enabled: true, scanned: 1, changed: 0 });
    expect(getPaymentStatus).toHaveBeenCalledTimes(1);
    expect(db.tables.photo_bookings[0].status).toBe("pending");
  });
});
