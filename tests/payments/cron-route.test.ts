import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLogSink } from "@/lib/log";
import { resetRateLimits } from "@/lib/rate-limit";
import { orderRow } from "../helpers/order-row";
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

describe("POST /api/cron/payments (payment job)", () => {
  beforeEach(() => {
    resetRateLimits();
    vi.stubEnv("CRON_SECRET", CRON);
    vi.stubEnv("PAYMENTS_MYFATOORAH_ENABLED", "1");
    vi.stubEnv("MYFATOORAH_API_KEY", "sk_test");
    vi.stubEnv("MYFATOORAH_WEBHOOK_SECRET", SECRET);
    vi.stubEnv("PAYMENTS_RECONCILE_ENABLED", "0");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://site.test");
    for (const t of ["photo_bookings", "photo_payment_events", "photo_payment_attempts", "photo_notification_deliveries", "photo_orders", "photo_job_heartbeats", "photo_audit_log", "photo_studio", "photo_client_notification_prefs"]) db.tables[t] = [];
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

  it("replays unmatched verified events and does NOT call the provider unless reconciliation is switched on; records a heartbeat", async () => {
    db.seed("photo_payment_events", [{ provider: "MYFATOORAH", provider_event_id: "WH-626519", event_type: "PAYMENT_STATUS_CHANGED", payload: paymentEvent(), signature_valid: true, processing_result: "booking_not_found", received_at: "2026-10-02T10:00:00.000Z" }]);
    db.seed("photo_bookings", [booking({ created_at: "2026-10-01T00:00:00.000Z" })]);
    const res = await (await route()).POST(post());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, replay: { scanned: 1, applied: 1 }, reconcile: { enabled: false, scanned: 0 }, ordersReconcile: { enabled: false }, invoiceJobs: { scanned: 0 } });
    expect(db.tables.photo_bookings[0].status).toBe("paid");
    expect(getPaymentStatus).not.toHaveBeenCalled();
    expect(db.tables.photo_job_heartbeats[0]).toMatchObject({ name: "payments", ok: true });
  });

  it("runs only REQUESTED invoice jobs: an unpaid order nobody asked about is never billed", async () => {
    db.seed("photo_orders", [orderRow({ id: "o1", external_ref: "o1" }) as unknown as Record<string, unknown>]);
    const body = await (await (await route()).POST(post())).json();
    expect(body.invoiceJobs).toMatchObject({ scanned: 0, queued: 0 });
    expect(createInvoice).not.toHaveBeenCalled();
    expect(body.queue).toMatchObject({ waiting: 0 });
  });

  it("processes a requested order: link minted, one invoice, one e-mail queued, owner card queued", async () => {
    db.seed("photo_orders", [orderRow({ id: "33333333-3333-4333-8333-333333333333", external_ref: "o2", invoice_requested_at: "2026-10-02T10:01:00.000Z", invoice_requested_by: "auto" }) as unknown as Record<string, unknown>]);
    createInvoice.mockResolvedValue({ ok: true, data: { invoiceId: "INV-A", paymentUrl: "https://pay.test/INV-A", customerReference: "33333333-3333-4333-8333-333333333333", raw: {} } });
    const body = await (await (await route()).POST(post())).json();
    expect(body.invoiceJobs).toMatchObject({ scanned: 1, queued: 1, exceptions: 0 });
    expect(createInvoice).toHaveBeenCalledTimes(1);
    const o = db.tables.photo_orders[0];
    expect(o.provider_invoice_id).toBe("INV-A");
    expect(String(o.payment_url)).toMatch(/^https:\/\/site\.test\/pay\/order\/bbo_[A-Za-z0-9]{40}$/);
    expect(o).toMatchObject({ invoice_email_state: "queued", invoice_email_count: 1 });
    expect(o.invoice_completed_at).toBeTruthy();
    const emails = db.tables.photo_notification_deliveries.filter((d) => d.channel === "email");
    expect(emails).toHaveLength(1);
    expect(emails[0]).toMatchObject({ kind: "ORDER_PAYMENT_LINK" });
    // A second run changes nothing: no second invoice, no second e-mail.
    const again = await (await (await route()).POST(post())).json();
    expect(again.invoiceJobs).toMatchObject({ scanned: 0 });
    expect(createInvoice).toHaveBeenCalledTimes(1);
    expect(db.tables.photo_notification_deliveries.filter((d) => d.channel === "email")).toHaveLength(1);
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
