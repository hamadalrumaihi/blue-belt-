import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/service", () => ({ isServiceClientConfigured: vi.fn(() => true), createServiceClient: vi.fn() }));
vi.mock("@/lib/capture/credential-store", () => ({ findCredentialByToken: vi.fn(), touchCredential: vi.fn(async () => undefined), recordHeartbeat: vi.fn() }));

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

/** Service client stand-in whose photo_record_order remembers (owner, source, ref). */
function fakeService() {
  const orders = new Map<string, { id: string; row: Record<string, unknown>; delivery: unknown }>();
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const rpc = async (name: string, args: Record<string, unknown>) => {
    rpcCalls.push({ name, args });
    const order = args.p_order as Record<string, unknown>;
    const key = `${args.p_owner_id}|${order.source}|${order.external_ref}`;
    const existing = orders.get(key);
    if (existing) return { data: { ok: true, replayed: true, order_id: existing.id }, error: null };
    const id = `order-${orders.size + 1}`;
    orders.set(key, { id, row: order, delivery: args.p_delivery });
    return { data: { ok: true, replayed: false, order_id: id }, error: null };
  };
  return { client: { rpc, from: () => { throw new Error("no table access expected"); } }, orders, rpcCalls };
}

function post(body: string, auth: string | null = `Bearer ${TOKEN}`) {
  const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": "203.0.113.9" };
  if (auth) headers.authorization = auth;
  return POST(new Request("http://localhost/api/orders/intake", { method: "POST", body, headers }));
}

let fake: ReturnType<typeof fakeService>;
beforeEach(() => {
  resetRateLimits();
  vi.stubEnv("ORDERS_INTAKE_ENABLED", "1");
  fake = fakeService();
  serviceMock.mockReturnValue(fake.client as never);
  findMock.mockReset();
  findMock.mockResolvedValue({ ok: true, credential: credential() });
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/orders/intake", () => {
  it("is 404 while the feature flag is off, and needs an ORDERS credential", async () => {
    vi.stubEnv("ORDERS_INTAKE_ENABLED", "0");
    expect((await post(fixture("pictime-card-paid"))).status).toBe(404);
    vi.stubEnv("ORDERS_INTAKE_ENABLED", "1");
    const missing = await post(fixture("pictime-card-paid"), null);
    expect(missing.status).toBe(401);
    // The 401 must name the orders prefix (bbmo_), not the generic capture one.
    expect((await missing.json()).error).toContain("bbmo_");
    findMock.mockResolvedValueOnce({ ok: true, credential: credential("capture") });
    const wrong = await post(fixture("pictime-card-paid"));
    expect(wrong.status).toBe(403);
    expect(await wrong.json()).toMatchObject({ code: "WRONG_CREDENTIAL_KIND" });
    expect(fake.rpcCalls).toHaveLength(0);
  });

  it("records a card order as the credential's owner, atomically with an [Orders] outbox row; a Zap retry is a 200 replay", async () => {
    const res = await post(fixture("pictime-card-paid"));
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ ok: true, orderId: "order-1", replayed: false, externalRef: "PT-2026-000123", payment: { method: "card", state: "paid" } });
    const call = fake.rpcCalls[0];
    expect(call.name).toBe("photo_record_order");
    expect(call.args.p_owner_id).toBe(OWNER);
    const order = call.args.p_order as Record<string, unknown>;
    expect(order).toMatchObject({ source: "pictime", external_ref: "PT-2026-000123", customer_name: "Fatima Al-Kuwari", customer_email: "fatima@example.com", amount: 370, currency: "QAR", status: "placed", payment_method: "card", payment_state: "paid", athlete_name_hint: "Hamad Al Rumaihi" });
    expect(JSON.stringify(order.raw)).not.toContain("_fixture\":\"SYNTHETIC — shaped after".repeat(2));
    const delivery = call.args.p_delivery as Record<string, unknown>;
    expect(delivery).toMatchObject({ channel: "telegram", alert_key: "order:pictime:PT-2026-000123", kind: "ORDER_PLACED" });
    expect((delivery.payload as Record<string, unknown>).category).toBe("orders");
    expect(String((delivery.payload as Record<string, unknown>).text)).toContain("New order — Fatima Al-Kuwari");

    const again = await post(fixture("pictime-card-paid"));
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ ok: true, orderId: "order-1", replayed: true });
    expect(fake.orders.size).toBe(1);
  });

  it("stores a Fawran order as placed / payment pending even though Pic-Time said paid", async () => {
    const res = await post(fixture("pictime-fawran-pending"));
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ payment: { method: "fawran", state: "pending" } });
    const order = fake.rpcCalls[0].args.p_order as Record<string, unknown>;
    expect(order).toMatchObject({ payment_method: "fawran", payment_state: "pending", payment_reported_state: "paid", provider: null });
    expect(String(((fake.rpcCalls[0].args.p_delivery as Record<string, unknown>).payload as Record<string, unknown>).text)).toContain("Fawran payment not yet confirmed");
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
});
