import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createLogger, setLogSink } from "@/lib/log";
import { draftOf, enqueueClientEmail, runEmailBatch } from "@/lib/notifications/email/outbox";
import { buildEmail } from "@/lib/notifications/email/templates";
import type { Database } from "@/lib/supabase/database.types";

beforeAll(() => setLogSink(() => {}));

type Row = Record<string, unknown>;
const OWNER = "aaaaaaaa-0000-4000-8000-000000000001";
const NOW = new Date("2026-10-01T10:00:00.000Z");

/** Prefs + deliveries tables with the shapes the outbox uses (upsert-or-skip on owner/channel/alert_key, claim RPC). */
function fakeSupabase(seed: { prefs?: Row[]; deliveries?: Row[] } = {}) {
  const tables: Record<string, Row[]> = { photo_client_notification_prefs: seed.prefs ?? [], photo_notification_deliveries: seed.deliveries ?? [] };
  const updates: Row[] = [];
  let failUpdates = false;
  function from(table: string) {
    const rows = tables[table];
    const filters: Array<(r: Row) => boolean> = [];
    let op: "select" | "update" | "upsert" = "select";
    let payload: Row | null = null;
    let inserted: Row[] = [];
    const matched = () => rows.filter((r) => filters.every((f) => f(r)));
    const b: Record<string, unknown> = {
      select: () => b,
      update: (p: Row) => ((op = "update"), (payload = p), b),
      upsert: (p: Row) => {
        op = "upsert";
        inserted = [];
        if (!rows.some((r) => r.owner_id === p.owner_id && r.channel === p.channel && r.alert_key === p.alert_key)) {
          const row = { id: rows.length + 1, ...p };
          rows.push(row);
          inserted.push(row);
        }
        return b;
      },
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), b),
      maybeSingle: async () => ({ data: matched()[0] ?? null, error: null }),
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
        if (op === "update") {
          if (failUpdates) return Promise.resolve({ data: null, error: { message: "db down" } }).then(res, rej);
          for (const r of matched()) Object.assign(r, payload);
          updates.push(payload as Row);
          return Promise.resolve({ data: null, error: null }).then(res, rej);
        }
        if (op === "upsert") return Promise.resolve({ data: inserted.map((r) => ({ id: r.id })), error: null }).then(res, rej);
        return Promise.resolve({ data: matched(), error: null }).then(res, rej);
      },
    };
    return b;
  }
  const rpcCalls: Row[] = [];
  const rpc = async (name: string, args: Row) => {
    rpcCalls.push({ name, ...args });
    const due = tables.photo_notification_deliveries.filter((r) => r.channel === args.p_channel && r.status === "pending" && (r.attempts as number) < 3).slice(0, args.p_limit as number);
    for (const r of due) Object.assign(r, { status: "sending", attempts: (r.attempts as number) + 1 });
    return { data: due.map((r) => ({ ...r })), error: null };
  };
  return { client: { from, rpc } as unknown as SupabaseClient<Database>, tables, updates, rpcCalls, setFailUpdates: (v: boolean) => (failUpdates = v) };
}

const draft = (to = "fatima@example.com") => buildEmail(to, { kind: "GALLERY_READY", subject: "Your gallery is ready", greeting: "Hi Fatima,", paragraphs: ["Photos are up."], cta: { label: "View your gallery", url: "https://bb.pic-time.com/doha" }, businessName: "Blue Belt Media" });

describe("enqueueClientEmail", () => {
  it("queues one pending row on channel email with the draft and links in the payload", async () => {
    const fake = fakeSupabase();
    const res = await enqueueClientEmail(fake.client, { ownerId: OWNER, kind: "GALLERY_READY", alertKey: "email:gallery:g1:ready", draft: draft(), personId: "p1", bookingId: "b1", now: NOW });
    expect(res).toEqual({ ok: true, queued: true, reason: undefined });
    const row = fake.tables.photo_notification_deliveries[0];
    expect(row).toMatchObject({ owner_id: OWNER, channel: "email", alert_key: "email:gallery:g1:ready", kind: "GALLERY_READY", category: "delivery", status: "pending", attempts: 0, next_attempt_at: NOW.toISOString() });
    expect(row.payload).toMatchObject({ to: "fatima@example.com", subject: "Your gallery is ready", personId: "p1", bookingId: "b1" });
    expect(String((row.payload as Row).html)).toContain("View your gallery");
  });

  it("refuses an invalid address without touching the database", async () => {
    const fake = fakeSupabase();
    const res = await enqueueClientEmail(fake.client, { ownerId: OWNER, kind: "GALLERY_READY", alertKey: "k", draft: draft("not-an-email") });
    expect(res).toEqual({ ok: true, queued: false, reason: "invalid_address" });
    expect(fake.tables.photo_notification_deliveries).toHaveLength(0);
  });

  it("honours the owner's per-kind switch, except for always-on kinds", async () => {
    const fake = fakeSupabase({ prefs: [{ owner_id: OWNER, kind: "GALLERY_READY", enabled: false }, { owner_id: OWNER, kind: "PORTAL_SIGN_IN", enabled: false }] });
    expect(await enqueueClientEmail(fake.client, { ownerId: OWNER, kind: "GALLERY_READY", alertKey: "k1", draft: draft() })).toEqual({ ok: true, queued: false, reason: "disabled_by_owner" });
    expect(fake.tables.photo_notification_deliveries).toHaveLength(0);
    expect(await enqueueClientEmail(fake.client, { ownerId: OWNER, kind: "PORTAL_SIGN_IN", alertKey: "k2", draft: draft() })).toMatchObject({ ok: true, queued: true });
    // Another owner's "off" row does not apply.
    const other = fakeSupabase({ prefs: [{ owner_id: "someone-else", kind: "GALLERY_READY", enabled: false }] });
    expect(await enqueueClientEmail(other.client, { ownerId: OWNER, kind: "GALLERY_READY", alertKey: "k3", draft: draft() })).toMatchObject({ queued: true });
  });

  it("dedupes on alert key: the second call queues nothing", async () => {
    const fake = fakeSupabase();
    await enqueueClientEmail(fake.client, { ownerId: OWNER, kind: "BOOKING_CONFIRMED", alertKey: "email:booking:b1:confirmed", draft: draft() });
    const again = await enqueueClientEmail(fake.client, { ownerId: OWNER, kind: "BOOKING_CONFIRMED", alertKey: "email:booking:b1:confirmed", draft: draft() });
    expect(again).toEqual({ ok: true, queued: false, reason: "duplicate" });
    expect(fake.tables.photo_notification_deliveries).toHaveLength(1);
  });
});

const delivery = (over: Row = {}): Row => ({ id: Math.floor(Math.random() * 1e9), owner_id: OWNER, channel: "email", alert_key: `k-${Math.random()}`, kind: "GALLERY_READY", category: "delivery", payload: { to: "fatima@example.com", subject: "Ready", html: "<p>hi</p>", text: "hi" }, status: "pending", attempts: 0, next_attempt_at: NOW.toISOString(), created_at: NOW.toISOString(), ...over });

describe("runEmailBatch", () => {
  it("claims via the RPC on channel email, sends each draft and marks it sent", async () => {
    const fake = fakeSupabase({ deliveries: [delivery({ alert_key: "a" }), delivery({ alert_key: "b", channel: "telegram" })] });
    const sent: string[] = [];
    const summary = await runEmailBatch({ supabase: fake.client, now: NOW, log: createLogger(), send: async (d) => (sent.push(d.to), { id: "re_1" }), worker: "t" });
    expect(summary).toEqual({ claimed: 1, sent: 1, retried: 0, failed: 0 });
    expect(sent).toEqual(["fatima@example.com"]);
    expect(fake.rpcCalls[0]).toMatchObject({ name: "photo_claim_notification_deliveries", p_channel: "email", p_limit: 20, p_worker: "t", p_owner_id: null });
    expect(fake.tables.photo_notification_deliveries.find((r) => r.alert_key === "a")).toMatchObject({ status: "sent", sent_at: NOW.toISOString(), last_error: null, leased_until: null });
    expect(fake.tables.photo_notification_deliveries.find((r) => r.alert_key === "b")).toMatchObject({ status: "pending" });
  });

  it("backs off a failed send and gives up after three attempts", async () => {
    const fake = fakeSupabase({ deliveries: [delivery({ alert_key: "flaky" })] });
    const send = vi.fn(async () => {
      throw new Error("resend 500: upstream");
    });
    const first = await runEmailBatch({ supabase: fake.client, now: NOW, log: createLogger(), send });
    expect(first).toMatchObject({ claimed: 1, retried: 1, failed: 0 });
    const row = fake.tables.photo_notification_deliveries[0];
    expect(row).toMatchObject({ status: "pending", attempts: 1, last_error: "resend 500: upstream", next_attempt_at: new Date(NOW.getTime() + 30_000).toISOString() });
    await runEmailBatch({ supabase: fake.client, now: NOW, log: createLogger(), send });
    expect(row).toMatchObject({ status: "pending", attempts: 2 });
    const third = await runEmailBatch({ supabase: fake.client, now: NOW, log: createLogger(), send });
    expect(third).toMatchObject({ failed: 1, retried: 0 });
    expect(row).toMatchObject({ status: "failed", attempts: 3, next_attempt_at: null });
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("fails a malformed payload outright instead of retrying it", async () => {
    const fake = fakeSupabase({ deliveries: [delivery({ alert_key: "bad", payload: { subject: "no recipient" } })] });
    const send = vi.fn(async () => ({ id: null }));
    const summary = await runEmailBatch({ supabase: fake.client, now: NOW, log: createLogger(), send });
    expect(summary).toMatchObject({ claimed: 1, failed: 1, sent: 0 });
    expect(send).not.toHaveBeenCalled();
    expect(fake.tables.photo_notification_deliveries[0]).toMatchObject({ status: "failed", last_error: "malformed e-mail payload" });
  });

  it("throws when the claim RPC fails, so the cron reports it", async () => {
    const client = { rpc: async () => ({ data: null, error: { message: "boom" } }), from: () => ({}) } as unknown as SupabaseClient<Database>;
    await expect(runEmailBatch({ supabase: client, now: NOW, log: createLogger(), send: async () => ({ id: null }) })).rejects.toThrow(/claim email deliveries: boom/);
  });
});

describe("draftOf", () => {
  it("needs to, subject and html; text is optional", () => {
    expect(draftOf({ payload: { to: "a@b.co", subject: "S", html: "<p>h</p>" } })).toEqual({ to: "a@b.co", subject: "S", html: "<p>h</p>", text: "" });
    expect(draftOf({ payload: { to: "a@b.co", subject: "S", html: "<p>h</p>", text: "t" } })?.text).toBe("t");
    expect(draftOf({ payload: { to: "a@b.co", subject: "S" } })).toBeNull();
    expect(draftOf({ payload: { to: 5, subject: "S", html: "h" } })).toBeNull();
    expect(draftOf({ payload: null })).toBeNull();
    expect(draftOf({ payload: ["x"] })).toBeNull();
    expect(draftOf({ payload: "text" })).toBeNull();
  });
});
