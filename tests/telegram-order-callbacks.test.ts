import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLogger, setLogSink } from "@/lib/log";
import { callbackSecret, signCallback } from "@/lib/notifications/telegram/callbacks";
import { authorizeOrderCallback, cardFor, isAuthorizedUser, performOrderAction, type CallbackDeps } from "@/lib/notifications/telegram/order-callbacks";
import { resetRateLimits } from "@/lib/rate-limit";
import type { PhotoOrderRow } from "@/lib/supabase/database.types";
import { ORDER_ID, ORDER_OWNER, orderRow } from "./helpers/order-row";
import { FakeSupabase } from "./payments/fake-supabase";

vi.mock("server-only", () => ({}));
setLogSink(() => {});

const SECRET = callbackSecret("123:token");
const NOW = new Date("2026-10-11T10:00:00.000Z");
const OWNER_USER = 7001;
const STRANGER = 7002;
const PRIVATE_CHAT = OWNER_USER;
const GROUP_CHAT = -100123;
const OTHER_OWNER = "99999999-9999-4999-8999-999999999999";

type Row = Record<string, unknown>;

function setup(opts: { orders?: PhotoOrderRow[]; links?: Row[] } = {}) {
  const db = new FakeSupabase();
  db.seed("photo_orders", (opts.orders ?? [orderRow()]) as unknown as Row[]);
  db.seed("photo_telegram_links", opts.links ?? [{ id: "l1", owner_id: ORDER_OWNER, chat_id: GROUP_CHAT, user_id: OWNER_USER, chat_type: "supergroup", enabled: true, updated_at: NOW.toISOString() }]);
  db.seed("photo_studio", [{ owner_id: ORDER_OWNER, business_name: "BBM", settings: {} }]);
  const createInvoice = vi.fn(async () => ({ ok: true as const, data: { invoiceId: "INV-T", paymentUrl: "https://pay.test/INV-T", customerReference: ORDER_ID, raw: {} } }));
  const deps: CallbackDeps = { supabase: db.asClient(), secret: SECRET, siteUrl: "https://site.test", provider: { name: "MYFATOORAH", createInvoice, getPaymentStatus: vi.fn() } as never, log: createLogger({ test: true }), now: () => NOW };
  return { db, deps, createInvoice };
}

const press = (action: "send" | "check" | "resend" | "done" | "refresh", from: number, chat: number, chatType = chat < 0 ? "supergroup" : "private", orderId = ORDER_ID) => ({ data: signCallback({ action, orderId, now: NOW }, SECRET), chatId: chat, chatType, fromId: from, now: NOW });

describe("authorizeOrderCallback", () => {
  beforeEach(() => resetRateLimits());

  it("accepts the linked user in the linked group and resolves the order server-side", async () => {
    const { deps } = setup();
    const auth = await authorizeOrderCallback(press("send", OWNER_USER, GROUP_CHAT), deps);
    expect(auth.ok).toBe(true);
    if (auth.ok) {
      expect(auth.action).toBe("send");
      expect(auth.order.id).toBe(ORDER_ID);
      expect(auth.actor).toEqual({ kind: "telegram", userId: ORDER_OWNER, telegramUserId: OWNER_USER });
    }
  });

  it("refuses another group member, even on a perfectly signed button", async () => {
    const { deps } = setup();
    const auth = await authorizeOrderCallback(press("send", STRANGER, GROUP_CHAT), deps);
    expect(auth).toMatchObject({ ok: false, reason: "not_authorized" });
    if (!auth.ok) expect(auth.answer).toMatch(/person who linked this chat/);
  });

  it("a group linked before user ids were recorded has no authorised presser until re-linked", async () => {
    const { deps } = setup({ links: [{ id: "l1", owner_id: ORDER_OWNER, chat_id: GROUP_CHAT, user_id: null, chat_type: null, enabled: true, updated_at: NOW.toISOString() }] });
    expect(await authorizeOrderCallback(press("check", OWNER_USER, GROUP_CHAT), deps)).toMatchObject({ ok: false, reason: "not_authorized" });
    expect(isAuthorizedUser({ user_id: null, chat_id: GROUP_CHAT, enabled: true }, { fromId: OWNER_USER, chatId: GROUP_CHAT, chatType: "supergroup" })).toBe(false);
  });

  it("a private chat linked before user ids were recorded still works for its own user only", async () => {
    const { deps } = setup({ links: [{ id: "l1", owner_id: ORDER_OWNER, chat_id: PRIVATE_CHAT, user_id: null, chat_type: null, enabled: true, updated_at: NOW.toISOString() }] });
    expect((await authorizeOrderCallback(press("check", OWNER_USER, PRIVATE_CHAT), deps)).ok).toBe(true);
    // A forwarded button pressed from a different private chat / user.
    expect(await authorizeOrderCallback(press("check", STRANGER, STRANGER), deps)).toMatchObject({ ok: false, reason: "not_linked" });
    expect(isAuthorizedUser({ user_id: null, chat_id: PRIVATE_CHAT, enabled: true }, { fromId: STRANGER, chatId: PRIVATE_CHAT, chatType: "private" })).toBe(false);
  });

  it("rejects forged, expired and foreign-order buttons without touching the database", async () => {
    const { deps, db } = setup();
    const before = db.calls.length;
    expect(await authorizeOrderCallback({ data: "o|send|AAAAAAAAAAAAAAAAAAAAAA|zzzz|bogus", chatId: GROUP_CHAT, chatType: "supergroup", fromId: OWNER_USER, now: NOW }, deps)).toMatchObject({ ok: false, reason: "invalid" });
    expect(await authorizeOrderCallback({ ...press("send", OWNER_USER, GROUP_CHAT), now: new Date(NOW.getTime() + 31 * 24 * 3600_000) }, deps)).toMatchObject({ ok: false, reason: "expired" });
    expect(db.calls.length).toBe(before);
    // A valid button for an order that belongs to another owner.
    const foreign = "77777777-7777-4777-8777-777777777777";
    db.seed("photo_orders", [orderRow({ id: foreign, owner_id: OTHER_OWNER, external_ref: "X" }) as unknown as Row]);
    expect(await authorizeOrderCallback(press("send", OWNER_USER, GROUP_CHAT, "supergroup", foreign), deps)).toMatchObject({ ok: false, reason: "not_found" });
  });

  it("rate-limits a user hammering the buttons", async () => {
    const { deps } = setup();
    let refused = false;
    for (let i = 0; i < 25; i += 1) {
      const r = await authorizeOrderCallback(press("refresh", OWNER_USER, GROUP_CHAT), deps);
      if (!r.ok && r.reason === "rate_limited") refused = true;
    }
    expect(refused).toBe(true);
  });
});

describe("performOrderAction — stale buttons and state-aware cards", () => {
  beforeEach(() => resetRateLimits());

  it("Send invoice runs the shared service once; a second press on the same card is a no-op with an honest answer", async () => {
    const { deps, db, createInvoice } = setup();
    const auth = await authorizeOrderCallback(press("send", OWNER_USER, GROUP_CHAT), deps);
    if (!auth.ok) throw new Error("expected ok");
    const first = await performOrderAction(auth, deps);
    expect(first.answer).toMatch(/queued/i);
    expect(createInvoice).toHaveBeenCalledTimes(1);
    expect(db.tables.photo_notification_deliveries.filter((d) => d.channel === "email")).toHaveLength(1);
    const again = await authorizeOrderCallback(press("send", OWNER_USER, GROUP_CHAT), deps);
    if (!again.ok) throw new Error("expected ok");
    const second = await performOrderAction(again, deps);
    expect(second.answer).toMatch(/already created/);
    expect(createInvoice).toHaveBeenCalledTimes(1);
    expect(db.tables.photo_notification_deliveries.filter((d) => d.channel === "email")).toHaveLength(1);
    // The refreshed card no longer offers Send invoice.
    expect(JSON.stringify(second.card.buttons)).not.toContain("Send invoice");
    expect(JSON.stringify(second.card.buttons)).toContain("Check payment");
  });

  it("Send invoice on an order paid meanwhile is refused and the card becomes the paid card with Done only", async () => {
    const { deps } = setup({ orders: [orderRow({ payment_state: "paid", paid_at: NOW.toISOString() })] });
    const auth = await authorizeOrderCallback(press("send", OWNER_USER, GROUP_CHAT), deps);
    if (!auth.ok) throw new Error("expected ok");
    const out = await performOrderAction(auth, deps);
    expect(out.answer).toMatch(/already paid/);
    const buttons = JSON.stringify(out.card.buttons);
    expect(buttons).toContain("Done");
    expect(buttons).not.toContain("Send invoice");
    expect(buttons).not.toContain("Check payment");
  });

  it("cancelled orders offer no financial action at all", async () => {
    const { deps } = setup({ orders: [orderRow({ status: "cancelled" })] });
    const auth = await authorizeOrderCallback(press("resend", OWNER_USER, GROUP_CHAT), deps);
    if (!auth.ok) throw new Error("expected ok");
    const out = await performOrderAction(auth, deps);
    expect(out.answer).toMatch(/cancelled/);
    const buttons = JSON.stringify(out.card.buttons);
    expect(buttons).not.toMatch(/Send invoice|Check payment|Resend|Retry|Done/);
    expect(buttons).toContain("View order");
  });

  it("Done records fulfilment only (no gallery call) and is idempotent", async () => {
    const { deps, db } = setup({ orders: [orderRow({ payment_state: "paid", paid_at: NOW.toISOString() })] });
    const auth = await authorizeOrderCallback(press("done", OWNER_USER, GROUP_CHAT), deps);
    if (!auth.ok) throw new Error("expected ok");
    expect((await performOrderAction(auth, deps)).answer).toMatch(/Marked done/);
    expect(db.tables.photo_orders[0]).toMatchObject({ status: "fulfilled" });
    const again = await authorizeOrderCallback(press("done", OWNER_USER, GROUP_CHAT), deps);
    if (!again.ok) throw new Error("expected ok");
    expect((await performOrderAction(again, deps)).answer).toMatch(/Already marked done/);
    expect(db.tables.photo_notification_deliveries.filter((d) => d.kind === "ORDER_FULFILLED")).toHaveLength(1);
  });

  it("cardFor picks paid / exception / invoice cards from the order's state", () => {
    expect(JSON.stringify(cardFor(orderRow({ payment_state: "paid" }), "https://s").buttons)).toContain("Done");
    expect(cardFor(orderRow({ invoice_exception: "no_email" }), "https://s").text).toMatch(/Needs attention/);
    expect(JSON.stringify(cardFor(orderRow({ provider_invoice_id: "I", payment_url: "https://s/pay/order/x", pay_token_hash: "h" }), "https://s").buttons)).toContain("Check payment");
  });
});
