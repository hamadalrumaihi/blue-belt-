import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/watchers", () => ({ watchUrl: vi.fn() }));
vi.mock("@/lib/watch-service", () => ({ refreshAthletes: vi.fn() }));

import { GET, POST, dynamic, maxDuration, runtime } from "@/app/api/watch/route";
import { RULES, resetRateLimits } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { refreshAthletes } from "@/lib/watch-service";
import { watchUrl } from "@/lib/watchers";
import { athleteRow, eventRow, watchResult } from "./helpers/rows";

const createClientMock = vi.mocked(createClient);
const watchUrlMock = vi.mocked(watchUrl);
const refreshAthletesMock = vi.mocked(refreshAthletes);

const USER = { id: "user-1", email: "photographer@example.com" };
const URL_A = "https://ajptour.com/events/4471/brackets/88";
const UUID_A = "7f4f6d1e-3c2b-4a1d-9e8f-0a1b2c3d4e5f";

type Fake = { user: typeof USER | null; athletes?: unknown[]; events?: unknown[]; queryError?: { message: string } };

function fakeClient(opts: Fake) {
  const queries: Array<{ table: string; calls: Array<[string, unknown[]]> }> = [];
  function builder(table: string) {
    const entry = { table, calls: [] as Array<[string, unknown[]]> };
    queries.push(entry);
    const data = table === "photo_athletes" ? opts.athletes ?? [] : opts.events ?? [];
    const chain = {
      select: (...a: unknown[]) => { entry.calls.push(["select", a]); return chain; },
      eq: (...a: unknown[]) => { entry.calls.push(["eq", a]); return chain; },
      in: (...a: unknown[]) => { entry.calls.push(["in", a]); return chain; },
      limit: (...a: unknown[]) => { entry.calls.push(["limit", a]); return chain; },
      then: (resolve: (v: { data: unknown[] | null; error: { message: string } | null }) => void) =>
        Promise.resolve(opts.queryError && table === "photo_athletes" ? { data: null, error: opts.queryError } : { data, error: null }).then(resolve),
    };
    return chain;
  }
  const client = { auth: { getUser: async () => ({ data: { user: opts.user } }) }, from: (table: string) => builder(table) };
  return { client, queries };
}

function install(opts: Fake) {
  const fake = fakeClient(opts);
  createClientMock.mockResolvedValue(fake.client as unknown as Awaited<ReturnType<typeof createClient>>);
  return fake;
}

function post(body: string | undefined, headers: Record<string, string> = {}) {
  return POST(new Request("http://localhost/api/watch", { method: "POST", body, headers: { "content-type": "application/json", ...headers } }));
}

beforeEach(() => {
  resetRateLimits();
  install({ user: USER });
  watchUrlMock.mockResolvedValue(watchResult());
  refreshAthletesMock.mockResolvedValue([]);
});

describe("POST /api/watch: module shape", () => {
  it("exports the Node runtime config", () => {
    expect(runtime).toBe("nodejs");
    expect(dynamic).toBe("force-dynamic");
    expect(maxDuration).toBe(120);
  });
});

describe("POST /api/watch: malformed requests", () => {
  it.each([
    ["invalid JSON", "{nope", "INVALID_JSON"],
    ["null", "null", "INVALID_BODY"],
    ["a string", '"str"', "INVALID_BODY"],
    ["an array", "[]", "INVALID_BODY"],
    ["an empty object", "{}", "MISSING_MODE"],
    ["empty athleteIds", JSON.stringify({ athleteIds: [] }), "INVALID_FIELD"],
    ["invalid eventId", JSON.stringify({ eventId: "nope" }), "INVALID_FIELD"],
    ["two modes", JSON.stringify({ url: URL_A, eventId: UUID_A }), "AMBIGUOUS_MODE"],
    ["unknown field", JSON.stringify({ url: URL_A, bogus: 1 }), "UNKNOWN_FIELD"],
    ["bad eventDate", JSON.stringify({ url: URL_A, eventDate: "2026-02-30" }), "INVALID_DATE"],
  ])("%s -> 400 %s", async (_label, body, code) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code, error: expect.any(String) });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(watchUrlMock).not.toHaveBeenCalled();
    expect(refreshAthletesMock).not.toHaveBeenCalled();
  });

  it("an empty body is invalid JSON", async () => {
    const res = await post(undefined);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "INVALID_JSON" });
  });

  it("echoes a well-formed x-request-id and mints one otherwise", async () => {
    const res = await post("{}", { "x-request-id": "req-abc-123" });
    expect(res.headers.get("x-request-id")).toBe("req-abc-123");
    const minted = await post("{}", { "x-request-id": "bad id" });
    expect(minted.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("POST /api/watch: auth", () => {
  it("rejects anonymous callers before reading the body", async () => {
    install({ user: null });
    const res = await post("{nope");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized", code: "UNAUTHORIZED" });
  });
});

describe("POST /api/watch: preview mode", () => {
  it("calls watchUrl with the parsed fields and returns its result", async () => {
    const res = await post(JSON.stringify({ url: ` ${URL_A} `, athleteName: "Hamad", timezone: "Asia/Qatar", eventDate: "2026-03-14" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "OK", platform: "AJP", matches: [expect.objectContaining({ mat: "Mat 3" })] });
    expect(watchUrlMock).toHaveBeenCalledTimes(1);
    expect(watchUrlMock.mock.calls[0][0]).toBe(URL_A);
    expect(watchUrlMock.mock.calls[0][1]).toMatchObject({ athleteName: "Hamad", timezone: "Asia/Qatar", eventDate: "2026-03-14" });
    expect(res.headers.get("x-ratelimit-limit")).toBe(String(RULES.previewPerUser.max));
    expect(res.headers.get("x-ratelimit-remaining")).toBe(String(RULES.previewPerUser.max - 1));
  });

  it("rate-limits previews per user after RULES.previewPerUser.max calls", async () => {
    for (let i = 0; i < RULES.previewPerUser.max; i++) {
      expect((await post(JSON.stringify({ url: URL_A }))).status).toBe(200);
    }
    const res = await post(JSON.stringify({ url: URL_A }));
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ code: "RATE_LIMITED", retryAfterSeconds: expect.any(Number) });
    expect(res.headers.get("retry-after")).toMatch(/^\d+$/);
    expect(res.headers.get("x-ratelimit-remaining")).toBe("0");
    expect(watchUrlMock).toHaveBeenCalledTimes(RULES.previewPerUser.max);

    // Another user has their own window.
    install({ user: { ...USER, id: "user-2" } });
    expect((await post(JSON.stringify({ url: URL_A }))).status).toBe(200);
    // Refresh mode has its own bucket too.
    resetRateLimits();
  });

  it("GET previews from query parameters and rejects a missing url", async () => {
    const ok = await GET(new Request(`http://localhost/api/watch?url=${encodeURIComponent(URL_A)}&athleteName=Hamad`));
    expect(ok.status).toBe(200);
    expect(watchUrlMock.mock.calls[0][1]).toMatchObject({ athleteName: "Hamad", timezone: null, eventDate: null });
    const missing = await GET(new Request("http://localhost/api/watch"));
    expect(missing.status).toBe(400);
    expect(await missing.json()).toMatchObject({ code: "INVALID_URL" });
    install({ user: null });
    expect((await GET(new Request("http://localhost/api/watch?url=x"))).status).toBe(401);
  });
});

describe("POST /api/watch: refresh mode", () => {
  it("loads active athletes by id, their events, and delegates to refreshAthletes with a cooldown", async () => {
    const athlete = athleteRow({ id: UUID_A });
    const event = eventRow();
    const fake = install({ user: USER, athletes: [athlete], events: [event] });
    refreshAthletesMock.mockResolvedValue([{ athleteId: UUID_A, athleteName: athlete.name, status: "OK", code: "MATCHES_FOUND", matches: [], changes: [], checkedAt: "x", sourceUrl: athlete.source_url, health: { lastAttemptAt: null, lastSuccessAt: null, consecutiveFailures: 0 }, ambiguous: 0 }]);

    const res = await post(JSON.stringify({ athleteIds: [UUID_A, UUID_A] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results).toHaveLength(1);
    expect(typeof body.checkedAt).toBe("string");

    expect(fake.queries[0].table).toBe("photo_athletes");
    expect(fake.queries[0].calls).toEqual([["select", ["*"]], ["eq", ["active", true]], ["in", ["id", [UUID_A]]]]);
    expect(fake.queries[1].table).toBe("photo_events");
    expect(fake.queries[1].calls).toEqual([["select", ["*"]], ["in", ["id", [event.id]]]]);

    expect(refreshAthletesMock).toHaveBeenCalledTimes(1);
    const [, athletes, events, options] = refreshAthletesMock.mock.calls[0];
    expect(athletes).toEqual([athlete]);
    expect(events.get(event.id)).toEqual(event);
    expect(options).toMatchObject({ cooldownSeconds: 8 });
    expect(watchUrlMock).not.toHaveBeenCalled();
  });

  it("event mode filters by event id with a cap, and an empty selection short-circuits", async () => {
    const fake = install({ user: USER, athletes: [] });
    const res = await post(JSON.stringify({ eventId: UUID_A }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ results: [] });
    expect(fake.queries[0].calls).toEqual([["select", ["*"]], ["eq", ["active", true]], ["eq", ["event_id", UUID_A]], ["limit", [60]]]);
    expect(refreshAthletesMock).not.toHaveBeenCalled();
  });

  it("a database error is a 500 QUERY_FAILED", async () => {
    install({ user: USER, queryError: { message: "permission denied" } });
    const res = await post(JSON.stringify({ athleteIds: [UUID_A] }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Could not load clients.", code: "QUERY_FAILED" });
  });
});
