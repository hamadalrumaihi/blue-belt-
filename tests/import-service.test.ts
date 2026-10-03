import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/watch-service", () => ({ refreshAthletes: vi.fn() }));

import { importPage, pageKey, samePage } from "@/lib/import-service";
import type { Database, PhotoCaptureRow } from "@/lib/supabase/database.types";
import { refreshAthletes, type RefreshOptions } from "@/lib/watch-service";
import { parseImportedHtml } from "@/lib/watchers";
import { fixture } from "./fixtures";
import { athleteRow, eventRow, OWNER } from "./helpers/rows";

const refreshMock = vi.mocked(refreshAthletes);
const PAGE = "https://ajptour.com/en/event/1411/bracket/130617";
const NOW = new Date("2026-03-14T06:00:00.000Z");

type Row = Record<string, unknown>;

/**
 * In-memory stand-in for the three tables the import service touches. The
 * photo_captures table is real enough to honour the (owner_id, capture_id)
 * unique index (23505), filters, ordering and limits.
 */
function fakeSupabase(opts: { athletes?: unknown[]; events?: unknown[]; error?: { message: string }; captures?: Partial<PhotoCaptureRow>[] }) {
  const calls: Array<{ table: string; op: string; args: unknown[] }> = [];
  const captures: Row[] = (opts.captures ?? []).map((c, i) => ({ id: `cap-row-${i + 1}`, status: "received", outcome: {}, diagnostics: {}, reject_code: null, applied_at: null, athlete_count: null, ...c }));
  let nextId = captures.length + 1;

  function builder(table: string) {
    const filters: Array<[string, unknown]> = [];
    let order: { col: string; asc: boolean } | null = null;
    let limit: number | null = null;
    let mode: "select" | "insert" | "update" = "select";
    let payload: Row | null = null;
    let single: "single" | "maybe" | null = null;

    const rows = () => {
      if (table === "photo_athletes") return (opts.athletes ?? []) as Row[];
      if (table === "photo_events") return (opts.events ?? []) as Row[];
      return captures;
    };
    const matching = () => {
      let out = rows().filter((r) => filters.every(([k, v]) => r[k] === v));
      if (order) out = [...out].sort((a, b) => (String(a[order!.col]) < String(b[order!.col]) ? (order!.asc ? -1 : 1) : order!.asc ? 1 : -1));
      if (limit !== null) out = out.slice(0, limit);
      return out;
    };
    const resolve = () => {
      if (opts.error && table === "photo_athletes") return { data: null, error: opts.error };
      if (table === "photo_captures" && mode === "insert" && payload) {
        if (captures.some((c) => c.owner_id === payload!.owner_id && c.capture_id === payload!.capture_id)) {
          return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
        }
        const row: Row = { id: `cap-row-${nextId++}`, status: "received", outcome: {}, diagnostics: {}, reject_code: null, applied_at: null, athlete_count: null, created_at: NOW.toISOString(), updated_at: NOW.toISOString(), ...payload };
        captures.push(row);
        return { data: single ? row : [row], error: null };
      }
      if (table === "photo_captures" && mode === "update" && payload) {
        const hit = matching();
        for (const r of hit) Object.assign(r, payload);
        return { data: single ? hit[0] ?? null : hit, error: null };
      }
      const data = matching();
      if (single === "single") return { data: data[0] ?? null, error: data[0] ? null : { message: "no rows" } };
      if (single === "maybe") return { data: data[0] ?? null, error: null };
      return { data, error: null };
    };

    const chain = {
      select: (...a: unknown[]) => (calls.push({ table, op: "select", args: a }), chain),
      insert: (row: Row) => (calls.push({ table, op: "insert", args: [row] }), (mode = "insert"), (payload = row), chain),
      update: (row: Row) => (calls.push({ table, op: "update", args: [row] }), (mode = "update"), (payload = row), chain),
      eq: (k: string, v: unknown) => (calls.push({ table, op: "eq", args: [k, v] }), filters.push([k, v]), chain),
      in: (...a: unknown[]) => (calls.push({ table, op: "in", args: a }), chain),
      order: (col: string, o?: { ascending?: boolean }) => ((order = { col, asc: o?.ascending !== false }), chain),
      limit: (n: number) => (calls.push({ table, op: "limit", args: [n] }), (limit = n), chain),
      single: () => ((single = "single"), chain),
      maybeSingle: () => ((single = "maybe"), chain),
      then: (res: (v: unknown) => void, rej?: (e: unknown) => void) => Promise.resolve(resolve()).then(res, rej),
    };
    return chain;
  }
  return { client: { from: builder } as unknown as SupabaseClient<Database>, calls, captures };
}

function okRefresh() {
  refreshMock.mockImplementation(async (_c, athletes, events, options) => {
    const results = [];
    for (const a of athletes) {
      const r = await (options as RefreshOptions).watch!(a, a.event_id ? events.get(a.event_id) ?? null : null);
      results.push({ athleteId: a.id, athleteName: a.name, status: r.status, code: r.code ?? null, matches: [], changes: [], checkedAt: NOW.toISOString(), sourceUrl: a.source_url, health: { lastAttemptAt: null, lastSuccessAt: null, consecutiveFailures: 0 }, ambiguous: 0, diagnostics: r.diagnostics });
    }
    return results;
  });
}

beforeEach(() => {
  refreshMock.mockReset();
  refreshMock.mockResolvedValue([]);
});

describe("samePage / pageKey (source identity)", () => {
  it("matches the same host+path regardless of case, trailing slash, hash and presentation query", () => {
    expect(samePage(PAGE, `${PAGE}/`)).toBe(true);
    expect(samePage(PAGE, `${PAGE}#top`)).toBe(true);
    expect(samePage(PAGE, `${PAGE}?tab=2`)).toBe(true);
    expect(samePage(PAGE, "https://AJPTOUR.com/en/event/1411/bracket/130617")).toBe(true);
    expect(samePage(PAGE, "http://ajptour.com/en/event/1411/bracket/130617")).toBe(true);
  });

  it("does not match other pages, other brackets on the same path, other hosts, or invalid URLs", () => {
    expect(samePage(PAGE, "https://ajptour.com/en/event/1411/bracket/130618")).toBe(false);
    expect(samePage(`${PAGE}?category=1`, `${PAGE}?category=2`)).toBe(false);
    expect(samePage(PAGE, "https://smoothcomp.com/en/event/1411/bracket/130617")).toBe(false);
    expect(samePage(null, PAGE)).toBe(false);
    expect(samePage("not a url", "not a url")).toBe(false);
    expect(pageKey("https://evil.example/")).toBeNull();
    expect(pageKey("https://www.ajptour.com/x/")).toBe("ajptour.com|/x");
  });
});

describe("parseImportedHtml", () => {
  it("parses handed-over HTML with the normal adapters and marks the strategy as import", () => {
    const result = parseImportedHtml(PAGE, fixture("ajp-bracket-table"), { athleteName: "Hamad Al Rumaihi", timezone: "Asia/Qatar", eventDate: "2026-03-14", now: NOW });
    expect(result.status).toBe("OK");
    expect(result.code).toBe("MATCHES_FOUND");
    expect(result.strategy).toBe("import:table");
    expect(result.matches).toHaveLength(2);
    expect(result.diagnostics).toMatchObject({ strategy: "import:table", sourceStatus: null, finalUrl: PAGE, attempts: 1 });
    expect(result.fetchedAt).toBe(NOW.toISOString());
  });

  it("tells the photographer when the handed-over page is still the challenge page", () => {
    const result = parseImportedHtml(PAGE, fixture("cloudflare-challenge"), { athleteName: "Hamad Al Rumaihi", now: NOW });
    expect(result.status).toBe("REQUIRES_BROWSER_WATCHER");
    expect(result.code).toBe("BROWSER_CHALLENGE");
    expect(result.message).toMatch(/still the bot-challenge page/);
  });

  it("applies the URL policy without touching the network", () => {
    expect(parseImportedHtml("https://evil.example/page", "<html></html>", { now: NOW })).toMatchObject({ status: "UNSUPPORTED_HOST", code: "UNSUPPORTED_HOST", matches: [] });
    expect(parseImportedHtml("nope", "<html></html>", { now: NOW })).toMatchObject({ status: "INVALID_URL", code: "INVALID_URL" });
  });
});

describe("importPage", () => {
  it("rejects URLs outside the policy before any query", async () => {
    const fake = fakeSupabase({ athletes: [athleteRow()] });
    expect(await importPage(fake.client, { url: "https://evil.example/x", html: "<html></html>", ownerId: OWNER, now: NOW })).toMatchObject({ ok: false, code: "UNSUPPORTED_HOST" });
    expect(fake.calls).toHaveLength(0);
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("reports NO_ATHLETES with the pages that are tracked when nothing matches, and stores no capture", async () => {
    const fake = fakeSupabase({ athletes: [athleteRow({ source_url: "https://ajptour.com/en/event/1411/bracket/999" })] });
    const out = await importPage(fake.client, { url: PAGE, html: "<html></html>", ownerId: OWNER, now: NOW });
    expect(out).toMatchObject({ ok: false, code: "NO_ATHLETES", candidates: ["https://ajptour.com/en/event/1411/bracket/999"] });
    expect(fake.calls.some((c) => c.table === "photo_athletes" && c.op === "eq" && c.args[0] === "active" && c.args[1] === true)).toBe(true);
    expect(fake.captures).toHaveLength(0);
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("surfaces a query failure", async () => {
    const fake = fakeSupabase({ error: { message: "boom" } });
    expect(await importPage(fake.client, { url: PAGE, html: "<html></html>", ownerId: OWNER, now: NOW })).toMatchObject({ ok: false, code: "QUERY_FAILED" });
  });

  it("refreshes every client on that source (not other brackets) through the injected watch and records the capture as applied", async () => {
    const a1 = athleteRow({ id: "22222222-2222-4222-8222-000000000001", name: "Hamad Al Rumaihi", source_url: PAGE });
    const a2 = athleteRow({ id: "22222222-2222-4222-8222-000000000002", name: "Someone Else", source_url: `${PAGE}/` });
    const other = athleteRow({ id: "22222222-2222-4222-8222-000000000003", source_url: "https://ajptour.com/en/event/1411/bracket/1" });
    const otherBracket = athleteRow({ id: "22222222-2222-4222-8222-000000000004", source_url: `${PAGE}?category=77` });
    const event = eventRow({ timezone: "Asia/Qatar", event_date: "2026-03-14" });
    const fake = fakeSupabase({ athletes: [a1, a2, other, otherBracket], events: [event] });
    okRefresh();

    const out = await importPage(fake.client, { url: PAGE, html: fixture("ajp-bracket-table"), ownerId: OWNER, capture: { captureId: "cap-00000001", capturedAt: "2026-03-14T05:58:00.000Z", transport: "handoff" }, now: NOW });
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error("expected ok");
    expect(out.matched).toBe(2);
    expect(refreshMock).toHaveBeenCalledTimes(1);
    const [, athletes, events, options] = refreshMock.mock.calls[0];
    expect(athletes.map((a) => a.id)).toEqual([a1.id, a2.id]);
    expect(events.get(event.id)).toEqual(event);
    expect(options).toMatchObject({ staggerMs: 0, concurrency: 4 });
    expect(out.results.map((r) => [r.athleteName, r.status])).toEqual([
      ["Hamad Al Rumaihi", "OK"],
      ["Someone Else", "ATHLETE_NOT_FOUND"],
    ]);
    expect(out.results[0].diagnostics?.strategy).toBe("import:table");
    expect(out.capture).toMatchObject({ captureId: "cap-00000001", transport: "handoff", capturedAt: "2026-03-14T05:58:00.000Z", replayed: false, sourceKey: "ajptour.com|/event/1411/bracket/130617" });

    expect(fake.captures).toHaveLength(1);
    const row = fake.captures[0];
    expect(row).toMatchObject({ owner_id: OWNER, capture_id: "cap-00000001", status: "applied", transport: "handoff", athlete_count: 2, source_key: "ajptour.com|/event/1411/bracket/130617", final_url: PAGE });
    expect(row.content_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.outcome).toMatchObject({ matched: 2, statuses: { OK: 1, ATHLETE_NOT_FOUND: 1 } });
    expect(JSON.stringify(row.diagnostics)).not.toContain("<");
  });

  it("owner identity comes from the caller, never from the page or the body", async () => {
    const fake = fakeSupabase({ athletes: [athleteRow({ source_url: PAGE })], events: [eventRow()] });
    okRefresh();
    await importPage(fake.client, { url: PAGE, html: fixture("ajp-bracket-table"), ownerId: "owner-from-session", now: NOW });
    expect(fake.captures[0].owner_id).toBe("owner-from-session");
  });

  it("replays a capture id that was already applied without refreshing again (no duplicate history)", async () => {
    const fake = fakeSupabase({
      athletes: [athleteRow({ source_url: PAGE })],
      events: [eventRow()],
      captures: [{ owner_id: OWNER, capture_id: "cap-00000001", source_key: "ajptour.com|/event/1411/bracket/130617", source_url: PAGE, status: "applied", captured_at: "2026-03-14T05:58:00.000Z", received_at: "2026-03-14T05:58:30.000Z", applied_at: "2026-03-14T05:58:31.000Z", athlete_count: 3, completeness: "complete", transport: "handoff", content_hash: "x", bytes: 1, outcome: { matched: 3, checkedAt: "2026-03-14T05:58:31.000Z" } }],
    });
    okRefresh();
    const out = await importPage(fake.client, { url: PAGE, html: fixture("ajp-bracket-table"), ownerId: OWNER, capture: { captureId: "cap-00000001" }, now: NOW });
    expect(out).toMatchObject({ ok: true, matched: 3, checkedAt: "2026-03-14T05:58:31.000Z", results: [], capture: { replayed: true, captureId: "cap-00000001", capturedAt: "2026-03-14T05:58:00.000Z", completeness: "complete" } });
    expect(refreshMock).not.toHaveBeenCalled();
    expect(fake.captures).toHaveLength(1);
  });

  it("the same capture id for ANOTHER owner is a new capture, not a replay", async () => {
    const fake = fakeSupabase({
      athletes: [athleteRow({ source_url: PAGE, owner_id: "owner-b" })],
      events: [eventRow()],
      captures: [{ owner_id: "owner-a", capture_id: "cap-00000001", source_key: "ajptour.com|/event/1411/bracket/130617", source_url: PAGE, status: "applied", captured_at: "2026-03-14T05:58:00.000Z", received_at: "2026-03-14T05:58:30.000Z", transport: "handoff", content_hash: "x", bytes: 1, completeness: "unknown" }],
    });
    okRefresh();
    const out = await importPage(fake.client, { url: PAGE, html: fixture("ajp-bracket-table"), ownerId: "owner-b", capture: { captureId: "cap-00000001" }, now: NOW });
    expect(out).toMatchObject({ ok: true, capture: { replayed: false } });
    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(fake.captures).toHaveLength(2);
  });

  it("refuses an out-of-order capture that is older than the newest applied capture of the same owner+source", async () => {
    const fake = fakeSupabase({
      athletes: [athleteRow({ source_url: PAGE })],
      events: [eventRow()],
      captures: [{ owner_id: OWNER, capture_id: "cap-newer", source_key: "ajptour.com|/event/1411/bracket/130617", source_url: PAGE, status: "applied", captured_at: "2026-03-14T05:59:00.000Z", received_at: "2026-03-14T05:59:10.000Z", transport: "agent", content_hash: "x", bytes: 1, completeness: "complete" }],
    });
    okRefresh();
    const out = await importPage(fake.client, { url: PAGE, html: fixture("ajp-bracket-table"), ownerId: OWNER, capture: { captureId: "cap-older", capturedAt: "2026-03-14T05:50:00.000Z" }, now: NOW });
    expect(out).toMatchObject({ ok: false, code: "STALE_CAPTURE", capture: { captureId: "cap-older", replayed: false } });
    expect(refreshMock).not.toHaveBeenCalled();
    expect(fake.captures.find((c) => c.capture_id === "cap-older")).toMatchObject({ status: "rejected", reject_code: "STALE_CAPTURE" });
    // A newer applied capture of a DIFFERENT bracket does not block this one.
    const fake2 = fakeSupabase({
      athletes: [athleteRow({ source_url: PAGE })],
      events: [eventRow()],
      captures: [{ owner_id: OWNER, capture_id: "cap-newer", source_key: "ajptour.com|/event/1411/bracket/130617|category=9", source_url: `${PAGE}?category=9`, status: "applied", captured_at: "2026-03-14T05:59:00.000Z", received_at: "2026-03-14T05:59:10.000Z", transport: "agent", content_hash: "x", bytes: 1, completeness: "complete" }],
    });
    expect(await importPage(fake2.client, { url: PAGE, html: fixture("ajp-bracket-table"), ownerId: OWNER, capture: { captureId: "cap-older", capturedAt: "2026-03-14T05:50:00.000Z" }, now: NOW })).toMatchObject({ ok: true });
  });

  it("refuses implausible capture times and a final URL that is another bracket, without storing anything", async () => {
    const fake = fakeSupabase({ athletes: [athleteRow({ source_url: PAGE })], events: [eventRow()] });
    okRefresh();
    expect(await importPage(fake.client, { url: PAGE, html: "<p>x</p>", ownerId: OWNER, capture: { capturedAt: "2026-03-13T06:00:00.000Z" }, now: NOW })).toMatchObject({ ok: false, code: "CAPTURE_TIMING" });
    expect(await importPage(fake.client, { url: PAGE, html: "<p>x</p>", ownerId: OWNER, capture: { capturedAt: "2026-03-14T07:00:00.000Z" }, now: NOW })).toMatchObject({ ok: false, code: "CAPTURE_TIMING" });
    expect(await importPage(fake.client, { url: PAGE, html: "<p>x</p>", ownerId: OWNER, capture: { finalUrl: "https://ajptour.com/en/event/1411/bracket/999" }, now: NOW })).toMatchObject({ ok: false, code: "FINAL_URL_MISMATCH" });
    // A locale / tab variant of the same page after redirect is fine.
    expect(await importPage(fake.client, { url: PAGE, html: fixture("ajp-bracket-table"), ownerId: OWNER, capture: { finalUrl: "https://ajptour.com/ar/event/1411/bracket/130617?tab=1" }, now: NOW })).toMatchObject({ ok: true });
    expect(fake.captures).toHaveLength(1);
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("reports a capture that is still being applied by another request", async () => {
    const fake = fakeSupabase({
      athletes: [athleteRow({ source_url: PAGE })],
      events: [eventRow()],
      captures: [{ owner_id: OWNER, capture_id: "cap-00000001", source_key: "ajptour.com|/event/1411/bracket/130617", source_url: PAGE, status: "received", captured_at: "2026-03-14T05:59:00.000Z", received_at: "2026-03-14T05:59:50.000Z", transport: "handoff", content_hash: "x", bytes: 1, completeness: "unknown" }],
    });
    expect(await importPage(fake.client, { url: PAGE, html: fixture("ajp-bracket-table"), ownerId: OWNER, capture: { captureId: "cap-00000001" }, now: NOW })).toMatchObject({ ok: false, code: "CAPTURE_IN_PROGRESS" });
    expect(refreshMock).not.toHaveBeenCalled();
  });
});

describe("previewImport (no persistence)", () => {
  it("reports per-client outcome without calling refreshAthletes or storing a capture", async () => {
    const a1 = athleteRow({ id: "22222222-2222-4222-8222-000000000001", name: "Hamad Al Rumaihi", source_url: PAGE });
    const a2 = athleteRow({ id: "22222222-2222-4222-8222-000000000002", name: "Someone Else", source_url: PAGE });
    const event = eventRow({ timezone: "Asia/Qatar", event_date: "2026-03-14" });
    const fake = fakeSupabase({ athletes: [a1, a2], events: [event] });
    const { previewImport } = await import("@/lib/import-service");
    const out = await previewImport(fake.client, { url: PAGE, html: fixture("ajp-bracket-table"), now: NOW });
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error("expected ok");
    expect(out.found).toBe(2);
    expect(out.withMatches).toBe(1);
    expect(out.notFound).toBe(1);
    expect(out.rows.map((r) => [r.name, r.status])).toEqual([
      ["Hamad Al Rumaihi", "OK"],
      ["Someone Else", "ATHLETE_NOT_FOUND"],
    ]);
    expect(out.capturedAt).toBe(NOW.toISOString());
    expect(refreshMock).not.toHaveBeenCalled();
    expect(fake.captures).toHaveLength(0);
  });

  it("rejects a handed-over challenge page before touching the database", async () => {
    const fake = fakeSupabase({ athletes: [athleteRow({ source_url: PAGE })] });
    const { previewImport } = await import("@/lib/import-service");
    const out = await previewImport(fake.client, { url: PAGE, html: fixture("cloudflare-challenge"), now: NOW });
    expect(out).toMatchObject({ ok: false, code: "CHALLENGE_PAGE" });
    expect(fake.calls).toHaveLength(0);
  });

  it("reports NO_ATHLETES with the tracked pages when nothing matches", async () => {
    const fake = fakeSupabase({ athletes: [athleteRow({ source_url: "https://ajptour.com/en/event/1/bracket/9" })] });
    const { previewImport } = await import("@/lib/import-service");
    const out = await previewImport(fake.client, { url: PAGE, html: "<html><body>x</body></html>", now: NOW });
    expect(out).toMatchObject({ ok: false, code: "NO_ATHLETES", candidates: ["https://ajptour.com/en/event/1/bracket/9"] });
  });
});

describe("importPage rejects a challenge page", () => {
  it("does not apply when the handed-over HTML is still the bot check", async () => {
    const fake = fakeSupabase({ athletes: [athleteRow({ source_url: PAGE })] });
    const out = await importPage(fake.client, { url: PAGE, html: fixture("cloudflare-challenge"), ownerId: OWNER, now: NOW });
    expect(out).toMatchObject({ ok: false, code: "CHALLENGE_PAGE" });
    expect(refreshMock).not.toHaveBeenCalled();
    expect(fake.captures).toHaveLength(0);
  });
});
