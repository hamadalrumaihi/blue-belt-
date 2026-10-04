import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const getBot = vi.hoisted(() => vi.fn(() => ({ api: { sendMessage: vi.fn() } })));
vi.mock("@/lib/notifications/telegram/bot", () => ({ getBot }));

import { createLogger, setLogSink } from "@/lib/log";
import { deliveryInsert, runDeliveryBatch, textOf } from "@/lib/notifications/delivery-runner";
import { withCategory } from "@/lib/notifications/telegram/core";
import type { Database } from "@/lib/supabase/database.types";

beforeAll(() => setLogSink(() => {}));

type Row = Record<string, unknown>;
const NOW = new Date("2026-03-14T06:00:00.000Z");
const OWNER_A = "aaaaaaaa-0000-4000-8000-000000000001";
const OWNER_B = "bbbbbbbb-0000-4000-8000-000000000001";

/**
 * Fake with a real-enough photo_claim_notification_deliveries: due rows for
 * the channel (and owner), attempts < 3, pending/failed with next_attempt_at
 * <= now, or sending with an expired lease; claimed rows get status sending,
 * attempts+1 and a lease. The RPC's `now` is injectable so lease expiry can be tested.
 */
function fakeSupabase(seed: { deliveries?: Row[]; links?: Row[] }, clock: { now: () => Date }) {
  const tables: Record<string, Row[]> = { photo_notification_deliveries: seed.deliveries ?? [], photo_telegram_links: seed.links ?? [] };
  const rpcCalls: unknown[] = [];
  function from(table: string) {
    const rows = tables[table];
    const filters: Array<(r: Row) => boolean> = [];
    let op: "select" | "update" | "upsert" = "select";
    let payload: Row | Row[] | null = null;
    let limitN: number | null = null;
    const b: Record<string, unknown> = {
      select: () => b,
      update: (p: Row) => ((op = "update"), (payload = p), b),
      upsert: (p: Row[]) => ((op = "upsert"), (payload = p), b),
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), b),
      not: (c: string, _o: string, v: unknown) => (filters.push((r) => r[c] !== v), b),
      limit: (n: number) => ((limitN = n), b),
      then: (res: (v: unknown) => unknown) => {
        let matched = rows.filter((r) => filters.every((f) => f(r)));
        if (limitN !== null) matched = matched.slice(0, limitN);
        if (op === "update") for (const r of matched) Object.assign(r, payload as Row);
        if (op === "upsert") for (const r of payload as Row[]) if (!rows.some((x) => x.owner_id === r.owner_id && x.alert_key === r.alert_key)) rows.push({ id: rows.length + 1, ...r });
        return Promise.resolve({ data: op === "select" ? matched : null, error: null }).then(res);
      },
    };
    return b;
  }
  const rpc = async (name: string, args: Record<string, unknown>) => {
    rpcCalls.push({ name, args });
    const now = clock.now().getTime();
    const due = tables.photo_notification_deliveries
      .filter((r) => r.channel === args.p_channel && (!args.p_owner_id || r.owner_id === args.p_owner_id) && (r.attempts as number) < 3)
      .filter((r) => (["pending", "failed"].includes(r.status as string) && r.next_attempt_at && new Date(r.next_attempt_at as string).getTime() <= now) || (r.status === "sending" && r.leased_until && new Date(r.leased_until as string).getTime() < now))
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
      .slice(0, args.p_limit as number);
    for (const r of due) Object.assign(r, { status: "sending", attempts: (r.attempts as number) + 1, leased_until: new Date(now + (args.p_lease_seconds as number) * 1000).toISOString(), lease_owner: args.p_worker });
    return { data: due.map((r) => ({ ...r })), error: null };
  };
  return { client: { from, rpc } as unknown as SupabaseClient<Database>, tables, rpcCalls };
}

const link = (owner: string, chat: number, enabled = true) => ({ id: `link-${chat}`, owner_id: owner, chat_id: chat, enabled });
const delivery = (over: Row) => ({ id: Math.floor(Math.random() * 1e9), owner_id: OWNER_A, channel: "telegram", alert_key: `k-${Math.random()}`, kind: "GO_TO_MAT", payload: { text: "<b>GO TO MAT — Jane</b>\nMat 3" }, status: "pending", attempts: 0, next_attempt_at: NOW.toISOString(), created_at: NOW.toISOString(), leased_until: null, lease_owner: null, category: null, ...over });

describe("runDeliveryBatch", () => {
  it("claims due rows atomically via the RPC, sends with category prefixes, and marks them sent", async () => {
    const clock = { now: () => NOW };
    const fake = fakeSupabase({ deliveries: [delivery({ alert_key: "a" }), delivery({ alert_key: "b", kind: "INCIDENT_CHALLENGE", payload: { text: "<b>Refresh blocked</b>" } }), delivery({ alert_key: "c", kind: "ORDER_PLACED", category: "orders", payload: { text: "<b>New order</b>" } })], links: [link(OWNER_A, 100)] }, clock);
    const sent: string[] = [];
    const summary = await runDeliveryBatch({ supabase: fake.client, now: NOW, log: createLogger(), sendMessage: async (_c, html) => void sent.push(html), perChatSpacingMs: 0, worker: "t" });
    expect(summary).toMatchObject({ claimed: 3, sent: 3, failed: 0, retried: 0, skipped: 0 });
    expect(sent).toEqual(["<b>[Match] GO TO MAT — Jane</b>\nMat 3", "<b>[System] Refresh blocked</b>", "<b>[Orders] New order</b>"]);
    expect(fake.tables.photo_notification_deliveries.every((r) => r.status === "sent" && r.attempts === 1 && r.leased_until === null)).toBe(true);
    expect(fake.rpcCalls[0]).toMatchObject({ name: "photo_claim_notification_deliveries", args: { p_channel: "telegram", p_limit: 20, p_owner_id: null, p_worker: "t" } });
    // A second pass finds nothing due.
    expect((await runDeliveryBatch({ supabase: fake.client, now: NOW, log: createLogger(), sendMessage: async () => {}, perChatSpacingMs: 0 })).claimed).toBe(0);
  });

  it("drains one owner only when asked, and skips rows whose owner has no enabled link", async () => {
    const clock = { now: () => NOW };
    const fake = fakeSupabase({ deliveries: [delivery({ owner_id: OWNER_A }), delivery({ owner_id: OWNER_B })], links: [link(OWNER_A, 100), link(OWNER_B, 200, false)] }, clock);
    const send = vi.fn(async () => {});
    const a = await runDeliveryBatch({ supabase: fake.client, now: NOW, log: createLogger(), sendMessage: send, ownerId: OWNER_A, perChatSpacingMs: 0 });
    expect(a).toMatchObject({ claimed: 1, sent: 1 });
    const b = await runDeliveryBatch({ supabase: fake.client, now: NOW, log: createLogger(), sendMessage: send, perChatSpacingMs: 0 });
    expect(b).toMatchObject({ claimed: 1, skipped: 1, sent: 0 });
    expect(fake.tables.photo_notification_deliveries.find((r) => r.owner_id === OWNER_B)).toMatchObject({ status: "skipped", last_error: "no enabled Telegram link" });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("backs off transient failures, gives up after three attempts, and on a rate limit releases the rest of the claim uncounted", async () => {
    let now = NOW;
    const clock = { now: () => now };
    const fake = fakeSupabase({ deliveries: [delivery({ alert_key: "first", created_at: "2026-03-14T05:59:00.000Z" }), delivery({ alert_key: "second" })], links: [link(OWNER_A, 100)] }, clock);
    const send = vi.fn(async () => { throw { error_code: 429, description: "Too Many Requests", parameters: { retry_after: 5 } }; });
    const s1 = await runDeliveryBatch({ supabase: fake.client, now, log: createLogger(), sendMessage: send, perChatSpacingMs: 0 });
    expect(s1).toMatchObject({ claimed: 2, retried: 1, released: 1, stoppedEarly: true });
    const [first, second] = fake.tables.photo_notification_deliveries;
    expect(first).toMatchObject({ status: "pending", attempts: 1, next_attempt_at: new Date(NOW.getTime() + 30_000).toISOString() });
    expect(second).toMatchObject({ status: "pending", attempts: 0, last_error: "rate limited; released" });
    expect(send).toHaveBeenCalledTimes(1);

    now = new Date(NOW.getTime() + 31_000);
    await runDeliveryBatch({ supabase: fake.client, now, log: createLogger(), sendMessage: send, perChatSpacingMs: 0 });
    expect(first).toMatchObject({ status: "pending", attempts: 2 });
    now = new Date(NOW.getTime() + 200_000);
    await runDeliveryBatch({ supabase: fake.client, now, log: createLogger(), sendMessage: send, perChatSpacingMs: 0 });
    expect(first).toMatchObject({ status: "failed", attempts: 3, next_attempt_at: null });
    now = new Date(NOW.getTime() + 900_000);
    const last = await runDeliveryBatch({ supabase: fake.client, now, log: createLogger(), sendMessage: send, perChatSpacingMs: 0 });
    expect(last.claimed).toBe(1); // only "second" (attempts < 3) is still claimable
  });

  it("reclaims a row whose lease expired (runner died mid-send)", async () => {
    let now = NOW;
    const clock = { now: () => now };
    const fake = fakeSupabase({ deliveries: [delivery({ status: "sending", attempts: 1, leased_until: new Date(NOW.getTime() - 1000).toISOString(), lease_owner: "dead" })], links: [link(OWNER_A, 100)] }, clock);
    const s = await runDeliveryBatch({ supabase: fake.client, now, log: createLogger(), sendMessage: async () => {}, perChatSpacingMs: 0 });
    expect(s).toMatchObject({ claimed: 1, sent: 1 });
    expect(fake.tables.photo_notification_deliveries[0]).toMatchObject({ status: "sent", attempts: 2 });
    now = new Date(NOW.getTime() + 1);
    // A live lease is not reclaimed.
    const live = fakeSupabase({ deliveries: [delivery({ status: "sending", attempts: 1, leased_until: new Date(NOW.getTime() + 60_000).toISOString() })], links: [link(OWNER_A, 100)] }, clock);
    expect((await runDeliveryBatch({ supabase: live.client, now, log: createLogger(), sendMessage: async () => {}, perChatSpacingMs: 0 })).claimed).toBe(0);
  });

  it("disables the link on a permanent chat error and spaces messages per chat", async () => {
    const clock = { now: () => NOW };
    const fake = fakeSupabase({ deliveries: [delivery({ alert_key: "x", created_at: "2026-03-14T05:58:00.000Z" }), delivery({ alert_key: "y" })], links: [link(OWNER_A, 100)] }, clock);
    const send = vi.fn(async () => { throw { error_code: 403, description: "Forbidden: bot was blocked by the user" }; });
    const s = await runDeliveryBatch({ supabase: fake.client, now: NOW, log: createLogger(), sendMessage: send, perChatSpacingMs: 0 });
    expect(s).toMatchObject({ claimed: 2, failed: 1, skipped: 1 });
    expect(fake.tables.photo_telegram_links[0].enabled).toBe(false);

    const waits: number[] = [];
    const ok = fakeSupabase({ deliveries: [delivery({ alert_key: "p", created_at: "2026-03-14T05:58:00.000Z" }), delivery({ alert_key: "q" })], links: [link(OWNER_A, 100)] }, clock);
    await runDeliveryBatch({ supabase: ok.client, now: NOW, log: createLogger(), sendMessage: async () => {}, perChatSpacingMs: 1_100, sleep: async (ms) => void waits.push(ms) });
    expect(waits).toHaveLength(1);
    expect(waits[0]).toBeGreaterThan(900);
  });

  it("never talks to Telegram from tests: the default sender is a dry run", async () => {
    const clock = { now: () => NOW };
    const fake = fakeSupabase({ deliveries: [delivery({})], links: [link(OWNER_A, 100)] }, clock);
    const s = await runDeliveryBatch({ supabase: fake.client, now: NOW, log: createLogger(), perChatSpacingMs: 0 });
    expect(s.sent).toBe(1);
    expect(getBot).not.toHaveBeenCalled();
  });
});

describe("textOf / deliveryInsert", () => {
  it("prefixes by stored category, payload category or kind, and builds dedupe-ready inserts", () => {
    expect(textOf({ payload: { text: "<b>Hi</b>" }, kind: "GO_TO_MAT", category: null })).toBe("<b>[Match] Hi</b>");
    expect(textOf({ payload: { title: "T", body: "B" }, kind: "RECOVERY_CHALLENGE", category: null })).toBe("<b>[System] T</b>\nB");
    expect(textOf({ payload: { text: "plain" }, kind: "ORDER_PLACED", category: "orders" })).toBe("<b>[Orders]</b> plain");
    expect(withCategory("<b>[Match] already</b>", "match")).toBe("<b>[Match] already</b>");
    const row = deliveryInsert({ ownerId: OWNER_A, alertKey: "k", kind: "REMIND_5", text: "<b>x</b>", category: "match", matchId: "m", now: NOW });
    expect(row).toMatchObject({ owner_id: OWNER_A, channel: "telegram", alert_key: "k", kind: "REMIND_5", category: "match", match_id: "m", status: "pending", attempts: 0, next_attempt_at: NOW.toISOString(), payload: { text: "<b>x</b>", category: "match" } });
  });
});
