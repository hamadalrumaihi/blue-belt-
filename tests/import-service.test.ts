import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/watch-service", () => ({ refreshAthletes: vi.fn() }));

import { importPage, pageKey, samePage } from "@/lib/import-service";
import type { Database } from "@/lib/supabase/database.types";
import { refreshAthletes, type RefreshOptions } from "@/lib/watch-service";
import { parseImportedHtml } from "@/lib/watchers";
import { fixture } from "./fixtures";
import { athleteRow, eventRow } from "./helpers/rows";

const refreshMock = vi.mocked(refreshAthletes);
const PAGE = "https://ajptour.com/en/event/1411/bracket/130617";
const NOW = new Date("2026-03-14T06:00:00.000Z");

function fakeSupabase(opts: { athletes?: unknown[]; events?: unknown[]; error?: { message: string } }) {
  const calls: Array<{ table: string; op: string; args: unknown[] }> = [];
  function builder(table: string) {
    const data = table === "photo_athletes" ? opts.athletes ?? [] : opts.events ?? [];
    const chain = {
      select: (...a: unknown[]) => (calls.push({ table, op: "select", args: a }), chain),
      eq: (...a: unknown[]) => (calls.push({ table, op: "eq", args: a }), chain),
      in: (...a: unknown[]) => (calls.push({ table, op: "in", args: a }), chain),
      limit: (...a: unknown[]) => (calls.push({ table, op: "limit", args: a }), chain),
      then: (resolve: (v: { data: unknown[] | null; error: { message: string } | null }) => void) =>
        Promise.resolve(opts.error && table === "photo_athletes" ? { data: null, error: opts.error } : { data, error: null }).then(resolve),
    };
    return chain;
  }
  return { client: { from: builder } as unknown as SupabaseClient<Database>, calls };
}

beforeEach(() => {
  refreshMock.mockReset();
  refreshMock.mockResolvedValue([]);
});

describe("samePage / pageKey", () => {
  it("matches the same host+path regardless of case, trailing slash, hash and query", () => {
    expect(samePage(PAGE, `${PAGE}/`)).toBe(true);
    expect(samePage(PAGE, `${PAGE}#top`)).toBe(true);
    expect(samePage(PAGE, `${PAGE}?tab=2`)).toBe(true);
    expect(samePage(PAGE, "https://AJPTOUR.com/en/event/1411/bracket/130617")).toBe(true);
    expect(samePage(PAGE, "http://ajptour.com/en/event/1411/bracket/130617")).toBe(true);
  });

  it("does not match other pages, other hosts, or invalid URLs", () => {
    expect(samePage(PAGE, "https://ajptour.com/en/event/1411/bracket/130618")).toBe(false);
    expect(samePage(PAGE, "https://smoothcomp.com/en/event/1411/bracket/130617")).toBe(false);
    expect(samePage(null, PAGE)).toBe(false);
    expect(samePage("not a url", "not a url")).toBe(false);
    expect(pageKey("https://evil.example/")).toBeNull();
    expect(pageKey("https://www.ajptour.com/x/")).toBe("www.ajptour.com/x");
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
    expect(await importPage(fake.client, { url: "https://evil.example/x", html: "<html></html>", now: NOW })).toMatchObject({ ok: false, code: "UNSUPPORTED_HOST" });
    expect(fake.calls).toHaveLength(0);
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("reports NO_ATHLETES with the pages that are tracked when nothing matches", async () => {
    const fake = fakeSupabase({ athletes: [athleteRow({ source_url: "https://ajptour.com/en/event/1411/bracket/999" })] });
    const out = await importPage(fake.client, { url: PAGE, html: "<html></html>", now: NOW });
    expect(out).toMatchObject({ ok: false, code: "NO_ATHLETES", candidates: ["https://ajptour.com/en/event/1411/bracket/999"] });
    expect(fake.calls.some((c) => c.table === "photo_athletes" && c.op === "eq" && c.args[0] === "active" && c.args[1] === true)).toBe(true);
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("surfaces a query failure", async () => {
    const fake = fakeSupabase({ error: { message: "boom" } });
    expect(await importPage(fake.client, { url: PAGE, html: "<html></html>", now: NOW })).toMatchObject({ ok: false, code: "QUERY_FAILED" });
  });

  it("refreshes every client on that page through the injected watch, with its event's timezone", async () => {
    const a1 = athleteRow({ id: "22222222-2222-4222-8222-000000000001", name: "Hamad Al Rumaihi", source_url: PAGE });
    const a2 = athleteRow({ id: "22222222-2222-4222-8222-000000000002", name: "Someone Else", source_url: `${PAGE}/` });
    const other = athleteRow({ id: "22222222-2222-4222-8222-000000000003", source_url: "https://ajptour.com/en/event/1411/bracket/1" });
    const event = eventRow({ timezone: "Asia/Qatar", event_date: "2026-03-14" });
    const fake = fakeSupabase({ athletes: [a1, a2, other], events: [event] });
    refreshMock.mockImplementation(async (_c, athletes, _e, options) => {
      const results = [];
      for (const a of athletes) {
        const r = await (options as RefreshOptions).watch!(a, event);
        results.push({ athleteId: a.id, athleteName: a.name, status: r.status, code: r.code ?? null, matches: [], changes: [], checkedAt: NOW.toISOString(), sourceUrl: a.source_url, health: { lastAttemptAt: null, lastSuccessAt: null, consecutiveFailures: 0 }, ambiguous: 0, diagnostics: r.diagnostics });
      }
      return results;
    });

    const out = await importPage(fake.client, { url: PAGE, html: fixture("ajp-bracket-table"), now: NOW });
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
  });
});
