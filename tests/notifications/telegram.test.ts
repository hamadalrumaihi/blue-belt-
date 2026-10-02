import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createLogger, setLogSink } from "@/lib/log";
import type { Database } from "@/lib/supabase/database.types";
import type { AthleteRow, EventRow, MatchRow } from "@/lib/types";
import type { RefreshResult } from "@/lib/watch-service";
import type { AppAlert } from "@/lib/notifications/types";
import {
  backoffDelayMs,
  classifyTelegramError,
  deliveryKeyFor,
  formatTelegramMessage,
  kindAllowed,
  resolveSubscription,
  type HistoryChange,
} from "@/lib/notifications/telegram/core";
import { normalizeKinds } from "@/lib/notifications/telegram/kinds";

vi.mock("server-only", () => ({}));

const webhookHandler = vi.hoisted(() => vi.fn(async () => new Response("ok", { status: 200 })));
vi.mock("grammy", () => ({ webhookCallback: vi.fn(() => webhookHandler) }));
vi.mock("@/lib/notifications/telegram/bot", () => ({ getBot: () => ({}) }));

beforeAll(() => setLogSink(() => {}));
afterEach(() => vi.unstubAllEnvs());

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

const baseAlert: AppAlert = { id: "go:m1", kind: "GO_TO_MAT", level: "danger", title: "GO TO MAT — Jane <Doe>", body: "Match starting now on Mat 3.", athleteId: "a1", athleteName: "Jane <Doe>", mat: "Mat 3", createdAt: "2026-10-02T10:00:00.000Z" };

describe("formatTelegramMessage", () => {
  it("renders a bold title, the body and mat · time, HTML-escaped", () => {
    const text = formatTelegramMessage(baseAlert, { time: "13:05" });
    expect(text).toBe("<b>GO TO MAT — Jane &lt;Doe&gt;</b>\nMatch starting now on Mat 3.\nMat 3 · 13:05");
  });

  it("omits the meta line when neither mat nor time is known", () => {
    expect(formatTelegramMessage({ ...baseAlert, mat: null })).toBe("<b>GO TO MAT — Jane &lt;Doe&gt;</b>\nMatch starting now on Mat 3.");
  });
});

describe("deliveryKeyFor", () => {
  const change: HistoryChange = { change_type: "MAT_CHANGE", match_id: "m1", old_value: { value: "Mat 1", label: "Mat 1" }, new_value: { value: "Mat 2", label: "Mat 2" } };

  it("keeps ranked alert ids as-is", () => {
    expect(deliveryKeyFor(baseAlert, new Map())).toBe("go:m1");
  });

  it("builds a stable key for history alerts regardless of the synthetic id", () => {
    const first = deliveryKeyFor({ ...baseAlert, id: "hist:-1", kind: "MAT_CHANGE" }, new Map([[-1, change]]));
    const second = deliveryKeyFor({ ...baseAlert, id: "hist:-7", kind: "MAT_CHANGE" }, new Map([[-7, { ...change }]]));
    expect(first).toBe("hist:MAT_CHANGE:m1:Mat 1>Mat 2");
    expect(second).toBe(first);
  });

  it("maps a status flip to on_mat onto the ranked ON MAT key", () => {
    const status: HistoryChange = { change_type: "STATUS_CHANGE", match_id: "m9", old_value: { value: "scheduled", label: "Scheduled" }, new_value: { value: "on_mat", label: "On mat" } };
    expect(deliveryKeyFor({ ...baseAlert, id: "hist:-2", kind: "ON_MAT" }, new Map([[-2, status]]))).toBe("on-mat:m9");
  });
});

describe("backoffDelayMs", () => {
  it("follows 30s, 2m then gives up after the third attempt", () => {
    expect(backoffDelayMs(1)).toBe(30_000);
    expect(backoffDelayMs(2)).toBe(120_000);
    expect(backoffDelayMs(3)).toBeNull();
    expect(backoffDelayMs(7)).toBeNull();
  });
});

describe("classifyTelegramError", () => {
  it("treats 429 as transient and honours retry_after", () => {
    expect(classifyTelegramError({ error_code: 429, description: "Too Many Requests", parameters: { retry_after: 7 } })).toEqual({ transient: true, retryAfterMs: 7_000, reason: "Too Many Requests" });
  });
  it("treats 5xx and network failures as transient", () => {
    expect(classifyTelegramError({ error_code: 502, description: "Bad Gateway" }).transient).toBe(true);
    expect(classifyTelegramError(new TypeError("fetch failed")).transient).toBe(true);
  });
  it("disables the link when the bot is blocked or the chat is gone", () => {
    expect(classifyTelegramError({ error_code: 403, description: "Forbidden: bot was blocked by the user" })).toMatchObject({ transient: false, disableLink: true });
    expect(classifyTelegramError({ error_code: 400, description: "Bad Request: chat not found" })).toMatchObject({ transient: false, disableLink: true });
  });
  it("keeps the link for other 4xx errors", () => {
    expect(classifyTelegramError({ error_code: 400, description: "Bad Request: can't parse entities" })).toMatchObject({ transient: false, disableLink: false });
  });
});

describe("subscriptions and kinds", () => {
  it("prefers the per-event row and filters by kinds", () => {
    const subs = [
      { event_id: null, kinds: ["GO_TO_MAT", "ON_MAT"], enabled: true },
      { event_id: "e1", kinds: ["MAT_CHANGE"], enabled: true },
    ];
    expect(resolveSubscription(subs, "e1")?.kinds).toEqual(["MAT_CHANGE"]);
    expect(resolveSubscription(subs, "e2")?.event_id).toBeNull();
    expect(kindAllowed(resolveSubscription(subs, "e1"), "GO_TO_MAT")).toBe(false);
    expect(kindAllowed(resolveSubscription(subs, "e2"), "GO_TO_MAT")).toBe(true);
    expect(kindAllowed({ event_id: null, kinds: ["GO_TO_MAT"], enabled: false }, "GO_TO_MAT")).toBe(false);
  });
  it("normalizes kinds and rejects unknown ones", () => {
    expect(normalizeKinds(["ON_MAT", "GO_TO_MAT", "ON_MAT"])).toEqual(["GO_TO_MAT", "ON_MAT"]);
    expect(normalizeKinds(["THRESHOLD_5"])).toBeNull();
    expect(normalizeKinds("GO_TO_MAT")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Webhook route
// ---------------------------------------------------------------------------

describe("POST /api/telegram/webhook", () => {
  const call = async (secret?: string) => {
    const { POST } = await import("@/app/api/telegram/webhook/route");
    return POST(new Request("http://localhost/api/telegram/webhook", { method: "POST", headers: secret ? { "x-telegram-bot-api-secret-token": secret } : {}, body: "{}" }));
  };

  it("is 404 when the feature is off", async () => {
    vi.stubEnv("TELEGRAM_ENABLED", "0");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "123:abc");
    vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "supersecret");
    expect((await call("supersecret")).status).toBe(404);
    expect(webhookHandler).not.toHaveBeenCalled();
  });

  it("rejects a missing or wrong secret before touching the bot", async () => {
    vi.stubEnv("TELEGRAM_ENABLED", "1");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "123:abc");
    vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "supersecret");
    expect((await call()).status).toBe(401);
    expect((await call("supersecreT")).status).toBe(401);
    expect((await call("supersecret-longer")).status).toBe(401);
    expect(webhookHandler).not.toHaveBeenCalled();
  });

  it("hands a correctly signed update to grammY", async () => {
    vi.stubEnv("TELEGRAM_ENABLED", "1");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "123:abc");
    vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "supersecret");
    const res = await call("supersecret");
    expect(res.status).toBe(200);
    expect(webhookHandler).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Notifier end-to-end against an in-memory Supabase
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;
type Sender = (chatId: number, html: string) => Promise<void>;
type Tables = Record<string, Row[]>;

/** Minimal PostgREST-style builder: enough for the notifier's queries. */
function fakeSupabase(seed: Partial<Tables> = {}) {
  const tables: Tables = { photo_telegram_links: [], photo_notification_subscriptions: [], photo_notification_deliveries: [], ...seed };
  let nextId = 1;
  function from(table: string) {
    const rows = tables[table];
    const q = { op: "select" as "select" | "insert" | "upsert" | "update", payload: null as unknown, filters: [] as Array<(r: Row) => boolean>, limitN: null as number | null, order: null as { col: string; asc: boolean } | null, single: false, returning: false, options: null as { onConflict?: string; ignoreDuplicates?: boolean } | null };
    const cmp = (a: unknown, b: unknown) => (a === b ? 0 : a === null ? -1 : b === null ? 1 : (a as string) < (b as string) ? -1 : 1);
    const exec = () => {
      const matched = () => {
        let out = rows.filter((r) => q.filters.every((f) => f(r)));
        if (q.order) out = [...out].sort((a, b) => cmp(a[q.order!.col], b[q.order!.col]) * (q.order!.asc ? 1 : -1));
        if (q.limitN !== null) out = out.slice(0, q.limitN);
        return out;
      };
      const stamp = (r: Row) => ({ id: nextId++, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...r });
      if (q.op === "select") {
        const data = matched();
        return { data: q.single ? data[0] ?? null : data, error: null };
      }
      if (q.op === "insert" || q.op === "upsert") {
        const list = (Array.isArray(q.payload) ? q.payload : [q.payload]) as Row[];
        const conflict = q.options?.onConflict?.split(",") ?? [];
        for (const r of list) {
          if (conflict.length && rows.some((x) => conflict.every((c) => x[c] === r[c]))) {
            if (q.options?.ignoreDuplicates) continue;
            throw new Error("duplicate without ignoreDuplicates");
          }
          rows.push(stamp(r));
        }
        return { data: null, error: null };
      }
      const updated = matched();
      for (const r of updated) Object.assign(r, q.payload as Row);
      return { data: q.returning ? updated : null, error: null };
    };
    const b: Record<string, unknown> = {
      select: () => { if (q.op !== "select") q.returning = true; return b; },
      insert: (p: unknown) => { q.op = "insert"; q.payload = p; return b; },
      upsert: (p: unknown, o: typeof q.options) => { q.op = "upsert"; q.payload = p; q.options = o; return b; },
      update: (p: unknown) => { q.op = "update"; q.payload = p; return b; },
      eq: (c: string, v: unknown) => { q.filters.push((r) => r[c] === v); return b; },
      is: (c: string, v: unknown) => { q.filters.push((r) => r[c] === v); return b; },
      not: (c: string, _op: string, v: unknown) => { q.filters.push((r) => r[c] !== v); return b; },
      in: (c: string, vs: unknown[]) => { q.filters.push((r) => vs.includes(r[c])); return b; },
      lt: (c: string, v: unknown) => { q.filters.push((r) => (r[c] as number) < (v as number)); return b; },
      lte: (c: string, v: unknown) => { q.filters.push((r) => r[c] !== null && (r[c] as string) <= (v as string)); return b; },
      order: (c: string, o?: { ascending?: boolean }) => { q.order = { col: c, asc: o?.ascending !== false }; return b; },
      limit: (n: number) => { q.limitN = n; return b; },
      maybeSingle: () => { q.single = true; return b; },
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve().then(exec).then(res, rej),
    };
    return b;
  }
  return { client: { from } as unknown as SupabaseClient<Database>, tables };
}

const NOW = new Date("2026-10-02T10:00:00.000Z");
const OWNER = "11111111-1111-4111-8111-111111111111";
const EVENT = "22222222-2222-4222-8222-222222222222";
const ATHLETE = "33333333-3333-4333-8333-333333333333";
const MATCH = "44444444-4444-4444-8444-444444444444";

function fixture(opts: { minutes?: number; status?: string; changes?: RefreshResult["changes"] } = {}) {
  const athlete = { id: ATHLETE, owner_id: OWNER, event_id: EVENT, name: "Jane Doe", active: true } as unknown as AthleteRow;
  const event = { id: EVENT, name: "Abu Dhabi Open", timezone: "Asia/Dubai", platform: "AJP" } as unknown as EventRow;
  const match = { id: MATCH, owner_id: OWNER, athlete_id: ATHLETE, mat: "Mat 3", status: opts.status ?? "scheduled", scheduled_at: new Date(NOW.getTime() + (opts.minutes ?? 1) * 60_000).toISOString(), estimated_at: null, match_order: 1 } as unknown as MatchRow;
  const result: RefreshResult = { athleteId: ATHLETE, athleteName: "Jane Doe", status: "OK", code: null, matches: [match], changes: opts.changes ?? [], checkedAt: NOW.toISOString(), sourceUrl: "https://example.test", health: { lastAttemptAt: null, lastSuccessAt: null, consecutiveFailures: 0 }, ambiguous: 0 };
  return { athletes: [athlete], events: new Map([[EVENT, event]]), results: [result] };
}

function seeded(extra: Partial<{ kinds: string[]; linkEnabled: boolean }> = {}) {
  return fakeSupabase({
    photo_telegram_links: [{ id: "link-1", owner_id: OWNER, chat_id: 123456, chat_title: "Jane", link_code: null, link_code_expires_at: null, linked_at: NOW.toISOString(), enabled: extra.linkEnabled ?? true }],
    photo_notification_subscriptions: [{ id: "sub-1", owner_id: OWNER, event_id: null, channel: "telegram", kinds: extra.kinds ?? ["GO_TO_MAT", "ON_MAT", "MAT_CHANGE", "MOVED_EARLIER", "MOVED_LATER"], enabled: true }],
  });
}

async function run(client: SupabaseClient<Database>, data: ReturnType<typeof fixture>, sendMessage: Sender, now = NOW) {
  const { runTelegramNotifier } = await import("@/lib/notifications/telegram/notifier");
  await runTelegramNotifier({ supabase: client, now, log: createLogger(), ...data }, { sendMessage });
}

describe("runTelegramNotifier", () => {
  it("sends a GO TO MAT alert once and records the delivery", async () => {
    const { client, tables } = seeded();
    const send = vi.fn<Sender>(async () => {});
    await run(client, fixture({ minutes: 1 }), send);
    await run(client, fixture({ minutes: 1 }), send, new Date(NOW.getTime() + 60_000));

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toBe(123456);
    expect(send.mock.calls[0][1]).toContain("<b>GO TO MAT — Jane Doe</b>");
    expect(send.mock.calls[0][1]).toContain("Mat 3 · 14:01");
    expect(tables.photo_notification_deliveries).toHaveLength(1);
    expect(tables.photo_notification_deliveries[0]).toMatchObject({ alert_key: `go:${MATCH}`, kind: "GO_TO_MAT", status: "sent", attempts: 1, match_id: MATCH });
  });

  it("uses a stable key for history alerts and the subscription's kinds filter", async () => {
    const change = { change_type: "MAT_CHANGE" as const, match_id: MATCH, old_value: { value: "Mat 1", label: "Mat 1" }, new_value: { value: "Mat 3", label: "Mat 3" } };
    const { client, tables } = seeded({ kinds: ["MAT_CHANGE"] });
    const send = vi.fn<Sender>(async () => {});
    await run(client, fixture({ minutes: 1, changes: [change] }), send);
    await run(client, fixture({ minutes: 1, changes: [change] }), send);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][1]).toContain("<b>MAT CHANGE — Jane Doe</b>");
    expect(tables.photo_notification_deliveries.map((r) => r.alert_key)).toEqual([`hist:MAT_CHANGE:${MATCH}:Mat 1>Mat 3`]);
  });

  it("does nothing without an enabled link", async () => {
    const { client, tables } = seeded({ linkEnabled: false });
    const send = vi.fn<Sender>(async () => {});
    await run(client, fixture(), send);
    expect(send).not.toHaveBeenCalled();
    expect(tables.photo_notification_deliveries).toHaveLength(0);
  });

  it("retries transient failures with backoff and gives up after three attempts", async () => {
    const { client, tables } = seeded();
    const send = vi.fn<Sender>(async () => { throw { error_code: 429, description: "Too Many Requests", parameters: { retry_after: 5 } }; });
    await run(client, fixture(), send);
    const row = tables.photo_notification_deliveries[0];
    expect(row).toMatchObject({ status: "pending", attempts: 1, last_error: "Too Many Requests" });
    expect(row.next_attempt_at).toBe(new Date(NOW.getTime() + 30_000).toISOString());

    // Not due yet: nothing is retried.
    await run(client, fixture(), send, new Date(NOW.getTime() + 10_000));
    expect(send).toHaveBeenCalledTimes(1);

    await run(client, fixture(), send, new Date(NOW.getTime() + 31_000));
    expect(send).toHaveBeenCalledTimes(2);
    expect(row).toMatchObject({ status: "pending", attempts: 2 });
    expect(row.next_attempt_at).toBe(new Date(NOW.getTime() + 31_000 + 120_000).toISOString());

    await run(client, fixture(), send, new Date(NOW.getTime() + 200_000));
    expect(send).toHaveBeenCalledTimes(3);
    expect(row).toMatchObject({ status: "failed", attempts: 3, next_attempt_at: null });

    await run(client, fixture(), send, new Date(NOW.getTime() + 900_000));
    expect(send).toHaveBeenCalledTimes(3);
    expect(tables.photo_telegram_links[0].enabled).toBe(true);
  });

  it("marks permanent failures and disables the link when the chat is gone", async () => {
    const { client, tables } = seeded();
    const send = vi.fn<Sender>(async () => { throw { error_code: 403, description: "Forbidden: bot was blocked by the user" }; });
    await run(client, fixture(), send);
    expect(tables.photo_notification_deliveries[0]).toMatchObject({ status: "failed", attempts: 1, next_attempt_at: null });
    expect(tables.photo_telegram_links[0].enabled).toBe(false);

    await run(client, fixture(), send);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
