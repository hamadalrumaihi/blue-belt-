import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/notifications/telegram/bot", () => ({ getBot: vi.fn() }));

import { createLogger, setLogSink } from "@/lib/log";
import { deliveryInsert, runDeliveryBatch, type TelegramTransport } from "@/lib/notifications/delivery-runner";
import { callbackSecret, verifyCallback } from "@/lib/notifications/telegram/callbacks";
import type { Database } from "@/lib/supabase/database.types";

beforeAll(() => setLogSink(() => {}));

type Row = Record<string, unknown>;
const NOW = new Date("2026-10-11T06:00:00.000Z");
const OWNER = "aaaaaaaa-0000-4000-8000-000000000001";
const ORDER = "33333333-3333-4333-8333-333333333333";
const SECRET = callbackSecret("123:token");

/** Same minimal fake as delivery-runner.test.ts, plus select() filters so findMessageId works. */
function fakeSupabase(seed: { deliveries?: Row[]; links?: Row[] }, clock: { now: () => Date }) {
  const tables: Record<string, Row[]> = { photo_notification_deliveries: seed.deliveries ?? [], photo_telegram_links: seed.links ?? [] };
  function from(table: string) {
    const rows = tables[table];
    const filters: Array<(r: Row) => boolean> = [];
    let op: "select" | "update" = "select";
    let payload: Row | null = null;
    let limitN: number | null = null;
    const b: Record<string, unknown> = {
      select: () => b,
      update: (p: Row) => ((op = "update"), (payload = p), b),
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), b),
      not: (c: string, _o: string, v: unknown) => (filters.push((r) => r[c] !== v), b),
      limit: (n: number) => ((limitN = n), b),
      then: (res: (v: unknown) => unknown) => {
        let matched = rows.filter((r) => filters.every((f) => f(r)));
        if (limitN !== null) matched = matched.slice(0, limitN);
        if (op === "update") for (const r of matched) Object.assign(r, payload as Row);
        return Promise.resolve({ data: op === "select" ? matched.map((r) => ({ ...r })) : null, error: null }).then(res);
      },
    };
    return b;
  }
  const rpc = async (name: string, args: Record<string, unknown>) => {
    void name;
    const now = clock.now().getTime();
    const due = tables.photo_notification_deliveries
      .filter((r) => r.channel === args.p_channel && (r.attempts as number) < 3)
      .filter((r) => ["pending", "failed"].includes(r.status as string) && r.next_attempt_at && new Date(r.next_attempt_at as string).getTime() <= now)
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
      .slice(0, args.p_limit as number);
    for (const r of due) Object.assign(r, { status: "sending", attempts: (r.attempts as number) + 1, leased_until: new Date(now + 60_000).toISOString() });
    return { data: due.map((r) => ({ ...r })), error: null };
  };
  return { client: { from, rpc } as unknown as SupabaseClient<Database>, tables };
}

const link = { id: "link-100", owner_id: OWNER, chat_id: 100, enabled: true };
const card = (over: Row) => ({ ...deliveryInsert({ ownerId: OWNER, alertKey: String(over.alert_key ?? "k"), kind: "ORDER_INVOICE", text: "<b>Card</b>", category: "orders", orderId: ORDER, buttons: [[{ text: "Check payment", action: "check" }], [{ text: "View order", url: "https://site.test/orders/x" }]], now: NOW }), id: Math.floor(Math.random() * 1e9), created_at: NOW.toISOString(), leased_until: null, lease_owner: null, ...over });

function recordingTransport(opts: { failEdit?: boolean } = {}) {
  const calls: Array<{ kind: string; chatId: number; messageId?: string; html?: string; markup?: unknown }> = [];
  let n = 500;
  const transport: TelegramTransport = {
    async send(chatId, html, markup) {
      calls.push({ kind: "send", chatId, html, markup });
      return { messageId: String(++n) };
    },
    async editText(chatId, messageId, html, markup) {
      if (opts.failEdit) throw new Error("Bad Request: message can't be edited");
      calls.push({ kind: "edit", chatId, messageId, html, markup });
    },
    async clearButtons(chatId, messageId) {
      calls.push({ kind: "clear", chatId, messageId });
    },
  };
  return { transport, calls };
}

describe("runDeliveryBatch — order cards", () => {
  it("signs the action buttons for the row's order at send time, keeps link buttons, and stores the Telegram message id", async () => {
    const clock = { now: () => NOW };
    const fake = fakeSupabase({ deliveries: [card({ alert_key: `order:${ORDER}:invoice:1` })], links: [link] }, clock);
    const { transport, calls } = recordingTransport();
    const s = await runDeliveryBatch({ supabase: fake.client, now: NOW, log: createLogger(), transport, callbackSigningSecret: SECRET, perChatSpacingMs: 0 });
    expect(s).toMatchObject({ claimed: 1, sent: 1 });
    expect(calls).toHaveLength(1);
    expect(calls[0].html).toBe("<b>[Orders] Card</b>");
    const markup = calls[0].markup as Array<Array<{ text: string; callback_data?: string; url?: string }>>;
    expect(markup).toHaveLength(2);
    expect(verifyCallback(markup[0][0].callback_data, SECRET, NOW)).toMatchObject({ ok: true, payload: { action: "check", orderId: ORDER } });
    expect(markup[1][0]).toEqual({ text: "View order", url: "https://site.test/orders/x" });
    expect(fake.tables.photo_notification_deliveries[0]).toMatchObject({ status: "sent", provider_message_id: "501" });
  });

  it("without a signing secret, action buttons are dropped (links stay) rather than sent unsigned", async () => {
    const clock = { now: () => NOW };
    const fake = fakeSupabase({ deliveries: [card({ alert_key: "a" })], links: [link] }, clock);
    const { transport, calls } = recordingTransport();
    await runDeliveryBatch({ supabase: fake.client, now: NOW, log: createLogger(), transport, callbackSigningSecret: null, perChatSpacingMs: 0 });
    const markup = calls[0].markup as Array<Array<{ text: string; callback_data?: string; url?: string }>> | null;
    expect(JSON.stringify(markup ?? [])).not.toContain("callback_data");
    expect(JSON.stringify(markup ?? [])).toContain("View order");
  });

  it("edits the earlier card when `edit_of` names a sent message, and falls back to a fresh message when the edit fails", async () => {
    const clock = { now: () => NOW };
    const first = card({ alert_key: `order:${ORDER}:invoice:1`, status: "sent", provider_message_id: "777", attempts: 1 });
    const update = card({ alert_key: `order:${ORDER}:invoice-sent:1`, payload: { text: "<b>Sent</b>", category: "orders", order_id: ORDER, buttons: [[{ text: "Check payment", action: "check" }]], edit_of: `order:${ORDER}:invoice:1` } });
    const fake = fakeSupabase({ deliveries: [first, update], links: [link] }, clock);
    const { transport, calls } = recordingTransport();
    const s = await runDeliveryBatch({ supabase: fake.client, now: NOW, log: createLogger(), transport, callbackSigningSecret: SECRET, perChatSpacingMs: 0 });
    expect(s).toMatchObject({ claimed: 1, sent: 1 });
    expect(calls).toEqual([expect.objectContaining({ kind: "edit", chatId: 100, messageId: "777", html: "<b>[Orders] Sent</b>" })]);
    expect(fake.tables.photo_notification_deliveries.find((r) => r.alert_key === `order:${ORDER}:invoice-sent:1`)).toMatchObject({ status: "sent", provider_message_id: "777" });

    const again = fakeSupabase({ deliveries: [{ ...first }, { ...update, id: 42, status: "pending", attempts: 0, next_attempt_at: NOW.toISOString(), leased_until: null }], links: [link] }, clock);
    const broken = recordingTransport({ failEdit: true });
    await runDeliveryBatch({ supabase: again.client, now: NOW, log: createLogger(), transport: broken.transport, callbackSigningSecret: SECRET, perChatSpacingMs: 0 });
    expect(broken.calls.map((c) => c.kind)).toEqual(["send"]);
    expect(again.tables.photo_notification_deliveries.find((r) => r.id === 42)).toMatchObject({ status: "sent", provider_message_id: "501" });
  });

  it("after sending a card that `supersedes` earlier ones, their buttons are cleared (best effort, never failing the row)", async () => {
    const clock = { now: () => NOW };
    const placed = card({ alert_key: `order:pictime:PT-1`, status: "sent", provider_message_id: "600", attempts: 1 });
    const invoice = card({ alert_key: `order:${ORDER}:invoice:1`, status: "sent", provider_message_id: "601", attempts: 1 });
    const paid = card({ alert_key: `order-payment:${ORDER}:paid`, payload: { text: "<b>Paid</b>", category: "orders", order_id: ORDER, buttons: [[{ text: "Done", action: "done" }]], supersedes: [`order:pictime:PT-1`, `order:${ORDER}:invoice:1`, `order:${ORDER}:invoice-sent:1`] } });
    const fake = fakeSupabase({ deliveries: [placed, invoice, paid], links: [link] }, clock);
    const { transport, calls } = recordingTransport();
    const s = await runDeliveryBatch({ supabase: fake.client, now: NOW, log: createLogger(), transport, callbackSigningSecret: SECRET, perChatSpacingMs: 0 });
    expect(s).toMatchObject({ claimed: 1, sent: 1, failed: 0 });
    expect(calls.map((c) => [c.kind, c.messageId ?? null])).toEqual([["send", null], ["clear", "600"], ["clear", "601"]]);
    // A transport without edit support simply sends; nothing else is attempted.
    const plain = fakeSupabase({ deliveries: [{ ...placed }, { ...paid, id: 7, status: "pending", attempts: 0, next_attempt_at: NOW.toISOString(), leased_until: null }], links: [link] }, clock);
    const sendOnly: TelegramTransport = { send: async () => ({ messageId: null }) };
    expect(await runDeliveryBatch({ supabase: plain.client, now: NOW, log: createLogger(), transport: sendOnly, callbackSigningSecret: SECRET, perChatSpacingMs: 0 })).toMatchObject({ sent: 1 });
  });
});
