import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/service", () => ({ isServiceClientConfigured: vi.fn(() => true), createServiceClient: vi.fn() }));
vi.mock("@/lib/capture/credential-store", () => ({ findCredentialByToken: vi.fn(), touchCredential: vi.fn(async () => undefined), recordHeartbeat: vi.fn() }));
const runJobs = vi.hoisted(() => vi.fn(async (...args: unknown[]) => ({ args: args.length, scanned: 1, queued: 1, exceptions: 0, retried: 0, skipped: 0, budgetHit: false })));
vi.mock("@/lib/orders/payment-link", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/orders/payment-link")>()), runOrderInvoiceJobs: runJobs }));

import { POST } from "@/app/api/orders/intake/route";
import { findCredentialByToken } from "@/lib/capture/credential-store";
import { generateCaptureToken } from "@/lib/capture/credentials";
import { resetRateLimits } from "@/lib/rate-limit";
import type { PhotoCaptureCredentialRow } from "@/lib/supabase/database.types";
import { createServiceClient } from "@/lib/supabase/service";

const findMock = vi.mocked(findCredentialByToken);
const serviceMock = vi.mocked(createServiceClient);
const OWNER = "11111111-1111-4111-8111-111111111111";
const { token: TOKEN } = generateCaptureToken("orders");
const fixture = (name: string) => readFileSync(fileURLToPath(new URL(`./fixtures/orders/${name}.json`, import.meta.url)), "utf8");

function credential(kind: "orders" | "capture" = "orders"): PhotoCaptureCredentialRow {
  return { id: "cred-1", owner_id: OWNER, name: "Zapier", kind, token_hash: "h", token_prefix: "bbmo_xxxxxxxx", scope_source_keys: null, scope_event_id: null, expires_at: "2099-01-01T00:00:00.000Z", revoked_at: null, last_used_at: null, use_count: 0, last_heartbeat_at: null, agent_version: null, agent_status: {}, created_at: "2026-03-01T00:00:00.000Z", updated_at: "2026-03-01T00:00:00.000Z" };
}

type Studio = { business_name: string; settings: Record<string, unknown> } | null;

/** Service client stand-in: photo_record_order remembers (owner, source, ref); photo_studio holds the owner's invoicing mode. */
function fakeService(opts: { clients?: Array<{ id: string; name: string; email: string | null; phone: string | null }> | "fail"; studio?: Studio } = {}) {
  const clients = opts.clients ?? [];
  const orders = new Map<string, { id: string; row: Record<string, unknown>; delivery: unknown }>();
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const rpc = async (name: string, args: Record<string, unknown>) => {
    rpcCalls.push({ name, args });
    const order = args.p_order as Record<string, unknown>;
    const key = `${args.p_owner_id}|${order.source}|${order.external_ref}`;
    const existing = orders.get(key);
    if (existing) return { data: { ok: true, replayed: true, order_id: existing.id }, error: null };
    const id = String(order.id);
    orders.set(key, { id, row: order, delivery: args.p_delivery });
    return { data: { ok: true, replayed: false, order_id: id }, error: null };
  };
  const from = (table: string) => {
    if (table === "photo_studio") {
      const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: opts.studio ?? null, error: null }) };
      return chain;
    }
    if (table !== "photo_athletes") throw new Error(`no access to ${table} expected`);
    const result = clients === "fail" ? { data: null, error: { message: "boom" } } : { data: clients, error: null };
    const chain = { select: () => chain, eq: () => chain, limit: async () => result };
    return chain;
  };
  return { client: { rpc, from }, orders, rpcCalls };
}

function post(body: string, auth: string | null = `Bearer ${TOKEN}`) {
  const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": "203.0.113.9" };
  if (auth) headers.authorization = auth;
  return POST(new Request("http://localhost/api/orders/intake", { method: "POST", body, headers }));
}

const payloadOf = (fake: ReturnType<typeof fakeService>, i = 0) => (fake.rpcCalls[i].args.p_delivery as Record<string, unknown>).payload as Record<string, unknown>;
const orderOf = (fake: ReturnType<typeof fakeService>, i = 0) => fake.rpcCalls[i].args.p_order as Record<string, unknown>;

let fake: ReturnType<typeof fakeService>;
beforeEach(() => {
  resetRateLimits();
  vi.stubEnv("ORDERS_INTAKE_ENABLED", "1");
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://app.test");
  fake = fakeService();
  serviceMock.mockReturnValue(fake.client as never);
  findMock.mockReset();
  findMock.mockResolvedValue({ ok: true, credential: credential() });
  runJobs.mockClear();
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/orders/intake", () => {
  it("is 404 while the feature flag is off, and needs an ORDERS credential", async () => {
    vi.stubEnv("ORDERS_INTAKE_ENABLED", "0");
    expect((await post(fixture("pictime-card-paid"))).status).toBe(404);
    vi.stubEnv("ORDERS_INTAKE_ENABLED", "1");
    const missing = await post(fixture("pictime-card-paid"), null);
    expect(missing.status).toBe(401);
    expect((await missing.json()).error).toContain("bbmo_");
    findMock.mockResolvedValueOnce({ ok: true, credential: credential("capture") });
    const wrong = await post(fixture("pictime-card-paid"));
    expect(wrong.status).toBe(403);
    expect(await wrong.json()).toMatchObject({ code: "WRONG_CREDENTIAL_KIND" });
    expect(fake.rpcCalls).toHaveLength(0);
  });

  it("records a card order as the credential's owner, atomically with an [Orders] card; a Zap retry is a 200 replay", async () => {
    const res = await post(fixture("pictime-card-paid"));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, replayed: false, externalRef: "PT-2026-000123", payment: { method: "card", state: "paid" }, invoice: { plan: "skip", reason: "paid", queued: false } });
    const call = fake.rpcCalls[0];
    expect(call.name).toBe("photo_record_order");
    expect(call.args.p_owner_id).toBe(OWNER);
    const order = orderOf(fake);
    expect(order).toMatchObject({ source: "pictime", external_ref: "PT-2026-000123", customer_name: "Fatima Al-Kuwari", amount: 370, currency: "QAR", status: "placed", payment_method: "card", payment_state: "paid", invoice_requested_at: null });
    expect(String(order.id)).toMatch(/^[0-9a-f-]{36}$/);
    const delivery = call.args.p_delivery as Record<string, unknown>;
    expect(delivery).toMatchObject({ channel: "telegram", alert_key: "order:pictime:PT-2026-000123", kind: "ORDER_PLACED" });
    const payload = payloadOf(fake);
    expect(payload.category).toBe("orders");
    expect(String(payload.text)).toContain("New photo order — Fatima Al-Kuwari");
    expect(String(payload.text)).toContain("Payment: Paid (card, reported by Pic-Time)");
    expect(String(payload.text)).toContain("Invoice: not needed, already paid.");
    expect(payload.order_id).toBe(order.id);
    // Settled in the gallery: only "View order", never Send invoice.
    expect(JSON.stringify(payload.buttons)).not.toContain("Send invoice");
    expect(runJobs).not.toHaveBeenCalled();

    const again = await post(fixture("pictime-card-paid"));
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ ok: true, orderId: order.id, replayed: true });
    expect(fake.orders.size).toBe(1);
  });

  it("review mode (default): an offline order is placed / payment pending with a Send invoice button and no queued job", async () => {
    const res = await post(fixture("pictime-photographer-approved"));
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ payment: { method: "photographer", state: "pending" }, invoice: { plan: "review", reason: "mode", queued: false } });
    expect(orderOf(fake)).toMatchObject({ payment_method: "photographer", payment_state: "pending", payment_reported_state: "paid", provider: null, invoice_requested_at: null, invoice_exception: null });
    const payload = payloadOf(fake);
    expect(String(payload.text)).toContain("to be paid to you directly, not yet confirmed");
    expect(String(payload.text)).toContain("waiting for you");
    expect(JSON.stringify(payload.buttons)).toContain("Send invoice");
    expect(JSON.stringify(payload.buttons)).toContain("https://app.test/orders/");
    expect(runJobs).not.toHaveBeenCalled();
  });

  it("a Fawran order without an e-mail is stored as payment pending (whatever Pic-Time said) and parked as an exception", async () => {
    const res = await post(fixture("pictime-fawran-pending"));
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ payment: { method: "fawran", state: "pending" }, invoice: { plan: "exception", reason: "no_email" } });
    expect(orderOf(fake)).toMatchObject({ payment_method: "fawran", payment_state: "pending", payment_reported_state: "paid", invoice_exception: "no_email" });
    expect(String(payloadOf(fake).text)).toContain("Fawran payment not yet confirmed");
  });

  it("automatic mode: an eligible new order has its invoice job queued in the same transaction and kicked once", async () => {
    vi.stubEnv("PAYMENTS_MYFATOORAH_ENABLED", "1");
    vi.stubEnv("MYFATOORAH_API_KEY", "k");
    vi.stubEnv("MYFATOORAH_WEBHOOK_SECRET", "s");
    vi.stubEnv("PAYMENTS_AUTO_INVOICE_ENABLED", "1");
    fake = fakeService({ studio: { business_name: "BBM", settings: { orderInvoicing: { mode: "auto", autoSince: "2026-01-01T00:00:00.000Z" } } } });
    serviceMock.mockReturnValue(fake.client as never);
    const res = await post(fixture("pictime-photographer-approved"));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.invoice).toMatchObject({ plan: "auto", queued: true, kicked: true, outcome: "queued" });
    expect(orderOf(fake)).toMatchObject({ invoice_requested_at: expect.any(String), invoice_requested_by: "auto", payment_method: "photographer", payment_state: "pending" });
    expect(String(payloadOf(fake).text)).toContain("queued automatically");
    expect(runJobs).toHaveBeenCalledTimes(1);
    expect(runJobs.mock.calls[0][1]).toMatchObject({ orderId: body.orderId, limit: 1 });
    // The replay neither re-queues nor re-kicks.
    const again = await post(fixture("pictime-photographer-approved"));
    expect((await again.json()).invoice).toMatchObject({ queued: false, kicked: false });
    expect(runJobs).toHaveBeenCalledTimes(1);
  });

  it("automatic mode never bills an order that arrived before the activation time", async () => {
    vi.stubEnv("PAYMENTS_MYFATOORAH_ENABLED", "1");
    vi.stubEnv("MYFATOORAH_API_KEY", "k");
    vi.stubEnv("MYFATOORAH_WEBHOOK_SECRET", "s");
    vi.stubEnv("PAYMENTS_AUTO_INVOICE_ENABLED", "1");
    fake = fakeService({ studio: { business_name: "BBM", settings: { orderInvoicing: { mode: "auto", autoSince: "2099-01-01T00:00:00.000Z" } } } });
    serviceMock.mockReturnValue(fake.client as never);
    const body = await (await post(fixture("pictime-photographer-approved"))).json();
    expect(body.invoice).toMatchObject({ plan: "review", reason: "historical", queued: false });
    expect(orderOf(fake).invoice_requested_at).toBeNull();
    expect(runJobs).not.toHaveBeenCalled();
  });

  it("an order without an e-mail address lands in the exception queue instead of being billed", async () => {
    fake = fakeService({ studio: { business_name: "BBM", settings: { orderInvoicing: { mode: "auto", autoSince: "2026-01-01T00:00:00.000Z" } } } });
    serviceMock.mockReturnValue(fake.client as never);
    const payload = JSON.parse(fixture("pictime-photographer-approved")) as Record<string, unknown>;
    delete payload.buyerEmail;
    const body = await (await post(JSON.stringify(payload))).json();
    expect(body.invoice).toMatchObject({ plan: "exception", reason: "no_email", queued: false });
    expect(orderOf(fake)).toMatchObject({ invoice_exception: "no_email", invoice_requested_at: null });
    expect(String(payloadOf(fake).text)).toContain("needs attention");
  });

  it("refuses malformed JSON, invalid orders and a body owner override", async () => {
    expect((await post("{nope")).status).toBe(400);
    const bad = await post(fixture("pictime-invalid-no-amount"));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ code: "INVALID_ORDER" });
    const spoof = JSON.parse(fixture("pictime-card-paid")) as Record<string, unknown>;
    spoof.ownerId = "someone-else";
    spoof.owner_id = "someone-else";
    await post(JSON.stringify(spoof));
    expect(fake.rpcCalls.at(-1)?.args.p_owner_id).toBe(OWNER);
  });

  it("keeps the client match as information only and survives a failed client lookup", async () => {
    const body = { ...(JSON.parse(fixture("pictime-fawran-pending")) as Record<string, unknown>), buyerEmail: "khalid@example.com" };
    fake = fakeService({ clients: [{ id: "ath-1", name: "Known Client", email: null, phone: "0097455550101" }] });
    serviceMock.mockReturnValue(fake.client as never);
    await post(JSON.stringify(body));
    expect(orderOf(fake).metadata).toMatchObject({ client_check: "done", client_match: { athleteId: "ath-1", by: "phone" } });
    // Existing clients still get a payment link when money is outstanding.
    expect(JSON.stringify(payloadOf(fake).buttons)).toContain("Send invoice");

    fake = fakeService({ clients: "fail" });
    serviceMock.mockReturnValue(fake.client as never);
    const res = await post(JSON.stringify({ ...body, externalRef: "PT-OTHER-1" }));
    expect(res.status).toBe(201);
    expect(orderOf(fake).metadata).toMatchObject({ client_check: "failed" });
  });
});
