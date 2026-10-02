import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/watchers", () => ({ watchUrl: vi.fn() }));

import type { ApplyRefreshArgs, Database, Json } from "@/lib/supabase/database.types";
import type { AthleteRow, MatchRow } from "@/lib/types";
import { healthOf, parseApplyResult, refreshAthlete, refreshAthletes } from "@/lib/watch-service";
import { watchUrl } from "@/lib/watchers";
import { athleteRow, eventRow, matchRow, normalized, watchResult } from "./helpers/rows";

const watchUrlMock = vi.mocked(watchUrl);
const NOW = new Date("2026-03-14T06:30:00.000Z");
const CHECKED_AT = NOW.toISOString();
const INSERTED_ID = "bbbbbbbb-0000-4000-8000-000000000001";

type RpcCall = { name: string; args: ApplyRefreshArgs };

/**
 * Minimal stand-in for the Supabase client: a thenable query builder for the
 * two reads watch-service performs, plus an rpc that behaves like
 * photo_apply_refresh with optimistic versioning.
 */
function fakeSupabase(state: { matches: MatchRow[]; athlete: AthleteRow | null; version: number }, rpcImpl?: (args: ApplyRefreshArgs) => Promise<{ data: Json; error: { message: string } | null }>) {
  const rpcCalls: RpcCall[] = [];
  const reads: string[] = [];
  const applied: ApplyRefreshArgs[] = [];

  const defaultRpc = async (args: ApplyRefreshArgs) => {
    if (args.p_expected_version !== state.version) {
      return { data: { ok: false, code: "CONFLICT", version: state.version, matches: state.matches as unknown as Json }, error: null };
    }
    applied.push(args);
    state.version += 1;
    const inserts = Array.isArray(args.p_inserts) ? args.p_inserts : [];
    const insertedIds = inserts.map((_, i) => INSERTED_ID.replace(/1$/, String(i + 1)));
    state.matches = [
      ...state.matches,
      ...inserts.map((patch, i) => matchRow({ ...(patch as unknown as Partial<MatchRow>), id: insertedIds[i], athlete_id: args.p_athlete_id })),
    ];
    if (state.athlete) state.athlete = { ...state.athlete, refresh_version: state.version, last_watch_status: args.p_status, last_watch_message: args.p_message, last_checked_at: args.p_checked_at, last_attempt_at: args.p_checked_at };
    return { data: { ok: true, version: state.version, matches: state.matches as unknown as Json, inserted_ids: insertedIds }, error: null };
  };

  function builder(table: string) {
    const chain = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      in: () => chain,
      maybeSingle: () => Promise.resolve({ data: table === "photo_athletes" ? state.athlete : null, error: null }),
      then: (resolve: (v: { data: MatchRow[]; error: null }) => void) => {
        reads.push(table);
        return Promise.resolve({ data: table === "photo_matches" ? [...state.matches] : [], error: null }).then(resolve);
      },
    };
    return chain;
  }

  const client = {
    from: (table: string) => builder(table),
    rpc: async (name: string, args: ApplyRefreshArgs) => {
      rpcCalls.push({ name, args });
      return (rpcImpl ?? defaultRpc)(args);
    },
  };
  return { client: client as unknown as SupabaseClient<Database>, rpcCalls, reads, applied, state };
}

beforeEach(() => {
  watchUrlMock.mockReset();
});

describe("refreshAthlete", () => {
  it("fetches, plans and persists one athlete, returning the applied rows and history", async () => {
    const athlete = athleteRow({ refresh_version: 3 });
    const fake = fakeSupabase({ matches: [], athlete, version: 3 });
    watchUrlMock.mockResolvedValue(watchResult({ matches: [normalized({ matchNumber: "12" })], diagnostics: { strategy: "http:table", sourceStatus: 200, finalUrl: athlete.source_url, elapsedMs: 42.6, attempts: 1 } }));

    const result = await refreshAthlete(fake.client, athlete, eventRow(), { now: NOW });

    expect(watchUrlMock).toHaveBeenCalledTimes(1);
    expect(watchUrlMock.mock.calls[0][0]).toBe(athlete.source_url);
    expect(watchUrlMock.mock.calls[0][1]).toMatchObject({ athleteName: "Hamad Al Rumaihi", timezone: "Asia/Qatar", eventDate: "2026-03-14", now: NOW });
    expect(fake.rpcCalls).toHaveLength(1);
    expect(fake.rpcCalls[0].name).toBe("photo_apply_refresh");
    expect(fake.rpcCalls[0].args).toMatchObject({ p_athlete_id: athlete.id, p_expected_version: 3, p_checked_at: CHECKED_AT, p_ok: true, p_status: "OK", p_code: "MATCHES_FOUND", p_touch_ids: [], p_diag: { strategy: "http:table", sourceStatus: 200, elapsedMs: 43, workerCode: null, attempts: 1 } });
    expect(fake.rpcCalls[0].args.p_inserts).toHaveLength(1);
    expect(result).toMatchObject({ athleteId: athlete.id, athleteName: athlete.name, status: "OK", code: "MATCHES_FOUND", checkedAt: CHECKED_AT, sourceUrl: athlete.source_url, ambiguous: 0 });
    expect(result.skipped).toBeUndefined();
    expect(result.matches).toHaveLength(1);
    expect(result.changes).toEqual([expect.objectContaining({ change_type: "MATCH_FOUND", match_id: INSERTED_ID, match_ref: 0 })]);
    expect(result.health).toEqual({ lastAttemptAt: CHECKED_AT, lastSuccessAt: CHECKED_AT, consecutiveFailures: 0 });
  });

  it("two concurrent refreshes of the same athlete: the loser is skipped as CONCURRENT and only one plan is applied", async () => {
    const athlete = athleteRow({ refresh_version: 3 });
    const fake = fakeSupabase({ matches: [], athlete, version: 3 });
    watchUrlMock.mockResolvedValue(watchResult({ matches: [normalized({ matchNumber: "12" })] }));

    const [first, second] = await Promise.all([
      refreshAthlete(fake.client, athlete, eventRow(), { now: NOW }),
      refreshAthlete(fake.client, athlete, eventRow(), { now: NOW }),
    ]);

    expect(watchUrlMock).toHaveBeenCalledTimes(2);
    expect(fake.rpcCalls).toHaveLength(2);
    expect(fake.applied).toHaveLength(1); // exactly one insert plan made it through
    expect(fake.applied[0].p_inserts).toHaveLength(1);
    expect(fake.state.matches).toHaveLength(1); // no duplicate row

    expect(first.skipped).toBeUndefined();
    expect(first.changes).toHaveLength(1);
    expect(second).toMatchObject({ skipped: "CONCURRENT", code: "SKIPPED", status: "OK", changes: [], checkedAt: CHECKED_AT });
    expect(second.matches).toEqual(fake.state.matches); // the winner's rows are returned to the loser
    expect(second.health.lastAttemptAt).toBe(CHECKED_AT);
    expect(fake.reads.filter((t) => t === "photo_matches")).toHaveLength(2);
  });

  it("a CONFLICT reply without a reloadable athlete still returns the rows from the reply", async () => {
    const athlete = athleteRow({ refresh_version: 1 });
    const existing = matchRow({ id: "cccccccc-0000-4000-8000-000000000001", external_match_id: "9012" });
    const fake = fakeSupabase({ matches: [existing], athlete: null, version: 1 }, async () => ({ data: { ok: false, code: "CONFLICT", version: 2, matches: [existing] as unknown as Json }, error: null }));
    watchUrlMock.mockResolvedValue(watchResult({ matches: [normalized({ externalMatchId: "9012" })] }));
    const result = await refreshAthlete(fake.client, athlete, eventRow(), { now: NOW });
    expect(result).toMatchObject({ skipped: "CONCURRENT", status: "OK", code: "SKIPPED", matches: [existing], changes: [] });
  });

  it("cooldown: a recent attempt is served from the database without fetching", async () => {
    const athlete = athleteRow({ last_attempt_at: new Date(NOW.getTime() - 5_000).toISOString(), last_checked_at: "2026-03-14T06:29:55.000Z", last_watch_status: "OK", last_watch_message: "Qatar National Pro 2026", last_success_at: "2026-03-14T06:29:55.000Z", consecutive_failures: 0 });
    const stored = matchRow({ id: "cccccccc-0000-4000-8000-000000000002" });
    const fake = fakeSupabase({ matches: [stored], athlete, version: 0 });

    const result = await refreshAthlete(fake.client, athlete, eventRow(), { now: NOW, cooldownSeconds: 45 });

    expect(watchUrlMock).not.toHaveBeenCalled();
    expect(fake.rpcCalls).toEqual([]);
    expect(result).toMatchObject({ skipped: "COOLDOWN", code: "SKIPPED", status: "OK", message: "Qatar National Pro 2026", matches: [stored], changes: [], checkedAt: "2026-03-14T06:29:55.000Z" });
    expect(result.health).toEqual({ lastAttemptAt: athlete.last_attempt_at, lastSuccessAt: "2026-03-14T06:29:55.000Z", consecutiveFailures: 0 });
  });

  it("cooldown does not apply when the last attempt is older than the window, or the window is 0", async () => {
    const athlete = athleteRow({ last_attempt_at: new Date(NOW.getTime() - 60_000).toISOString() });
    watchUrlMock.mockResolvedValue(watchResult({ status: "NO_MATCHES", code: "SCHEDULE_NOT_PUBLISHED", matches: [] }));
    const fake = fakeSupabase({ matches: [], athlete, version: 0 });
    expect((await refreshAthlete(fake.client, athlete, eventRow(), { now: NOW, cooldownSeconds: 45 })).skipped).toBeUndefined();
    const recent = athleteRow({ last_attempt_at: new Date(NOW.getTime() - 1_000).toISOString() });
    const fresh = fakeSupabase({ matches: [], athlete: recent, version: 0 });
    expect((await refreshAthlete(fresh.client, recent, eventRow(), { now: NOW, cooldownSeconds: 0 })).skipped).toBeUndefined();
    expect(watchUrlMock).toHaveBeenCalledTimes(2);
  });

  it("a failed read (FETCH_ERROR) is persisted with p_ok false and increments the failure count", async () => {
    const athlete = athleteRow({ last_success_at: "2026-03-14T05:00:00.000Z", consecutive_failures: 2 });
    const stored = matchRow({ id: "cccccccc-0000-4000-8000-000000000003" });
    const fake = fakeSupabase({ matches: [stored], athlete, version: 0 });
    watchUrlMock.mockResolvedValue(watchResult({ status: "FETCH_ERROR", code: "SOURCE_TIMEOUT", message: "Source did not respond within 8s.", matches: [] }));

    const result = await refreshAthlete(fake.client, athlete, eventRow(), { now: NOW });

    expect(fake.rpcCalls[0].args).toMatchObject({ p_ok: false, p_status: "FETCH_ERROR", p_code: "SOURCE_TIMEOUT", p_updates: [], p_inserts: [], p_history: [], p_touch_ids: [] });
    expect(result).toMatchObject({ status: "FETCH_ERROR", code: "SOURCE_TIMEOUT", matches: [stored], changes: [] });
    expect(result.health).toEqual({ lastAttemptAt: CHECKED_AT, lastSuccessAt: "2026-03-14T05:00:00.000Z", consecutiveFailures: 3 });
  });

  it("when watchUrl throws, the failure is recorded (p_ok false, ERROR) and the stored rows are returned", async () => {
    const athlete = athleteRow({ consecutive_failures: 1 });
    const stored = matchRow({ id: "cccccccc-0000-4000-8000-000000000004" });
    const fake = fakeSupabase({ matches: [stored], athlete, version: 0 });
    watchUrlMock.mockRejectedValue(new Error("boom"));

    const result = await refreshAthlete(fake.client, athlete, eventRow(), { now: NOW });

    expect(fake.rpcCalls).toHaveLength(1);
    expect(fake.rpcCalls[0].args).toEqual({ p_athlete_id: athlete.id, p_expected_version: 0, p_checked_at: CHECKED_AT, p_ok: false, p_status: "ERROR", p_code: "REFRESH_ERROR", p_message: "boom" });
    expect(result).toMatchObject({ status: "ERROR", code: "REFRESH_ERROR", message: "boom", matches: [stored], changes: [] });
    expect(result.health).toEqual({ lastAttemptAt: CHECKED_AT, lastSuccessAt: null, consecutiveFailures: 2 });
  });

  it("an rpc error after a successful fetch also lands on the ERROR path", async () => {
    const athlete = athleteRow();
    const fake = fakeSupabase({ matches: [], athlete, version: 0 }, async (args) => (args.p_ok ? { data: null, error: { message: "permission denied" } } : { data: { ok: true, version: 1, matches: [], inserted_ids: [] }, error: null }));
    watchUrlMock.mockResolvedValue(watchResult());
    const result = await refreshAthlete(fake.client, athlete, eventRow(), { now: NOW });
    expect(result).toMatchObject({ status: "ERROR", code: "REFRESH_ERROR", message: "photo_apply_refresh: permission denied" });
    expect(fake.rpcCalls.map((c) => c.args.p_status)).toEqual(["OK", "ERROR"]);
  });

  it("NOT_FOUND from the rpc means the client was deleted meanwhile", async () => {
    const athlete = athleteRow();
    const fake = fakeSupabase({ matches: [], athlete, version: 0 }, async () => ({ data: { ok: false, code: "NOT_FOUND" }, error: null }));
    watchUrlMock.mockResolvedValue(watchResult());
    const result = await refreshAthlete(fake.client, athlete, eventRow(), { now: NOW });
    expect(result).toMatchObject({ status: "ERROR", code: "REFRESH_ERROR", message: "Client no longer exists." });
  });
});

describe("refreshAthletes", () => {
  it("refreshes every athlete, isolating failures, with the event's timezone", async () => {
    const a = athleteRow({ id: "dddddddd-0000-4000-8000-000000000001", name: "A", refresh_version: 0 });
    const b = athleteRow({ id: "dddddddd-0000-4000-8000-000000000002", name: "B", refresh_version: 0, event_id: null });
    const fake = fakeSupabase({ matches: [], athlete: a, version: 0 });
    watchUrlMock.mockImplementation(async (url, options) => (options?.athleteName === "B" ? Promise.reject(new Error("down")) : watchResult({ matches: [] , status: "NO_MATCHES", code: "NO_MATCH_ROWS" })));

    const results = await refreshAthletes(fake.client, [a, b], new Map([[a.event_id as string, eventRow({ timezone: "Europe/London" })]]), { now: NOW, staggerMs: 0 });

    expect(results.map((r) => [r.athleteName, r.status, r.code])).toEqual([["A", "NO_MATCHES", "NO_MATCH_ROWS"], ["B", "ERROR", "REFRESH_ERROR"]]);
    expect(watchUrlMock.mock.calls.find((c) => c[1]?.athleteName === "A")?.[1]).toMatchObject({ timezone: "Europe/London", eventDate: "2026-03-14" });
    expect(watchUrlMock.mock.calls.find((c) => c[1]?.athleteName === "B")?.[1]).toMatchObject({ timezone: "Asia/Qatar", eventDate: null });
  });
});

describe("helpers", () => {
  it("parseApplyResult validates the rpc payload", () => {
    expect(parseApplyResult({ ok: true, version: 4, matches: [], inserted_ids: ["x"] })).toEqual({ ok: true, version: 4, matches: [], inserted_ids: ["x"] });
    expect(parseApplyResult({ ok: true })).toEqual({ ok: true, version: 0, matches: [], inserted_ids: [] });
    expect(parseApplyResult({ ok: false, code: "CONFLICT", version: 9, matches: [] })).toEqual({ ok: false, code: "CONFLICT", version: 9, matches: [] });
    expect(parseApplyResult({ ok: false, code: "NOT_FOUND" })).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(parseApplyResult({ ok: false })).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(() => parseApplyResult(null)).toThrow(/unexpected payload/);
    expect(() => parseApplyResult([])).toThrow(/unexpected payload/);
  });

  it("healthOf reads the athlete's bookkeeping", () => {
    expect(healthOf(athleteRow({ last_attempt_at: "a", last_success_at: "s", consecutive_failures: 4 }))).toEqual({ lastAttemptAt: "a", lastSuccessAt: "s", consecutiveFailures: 4 });
    expect(healthOf({ last_attempt_at: null, last_success_at: null, consecutive_failures: 0 })).toEqual({ lastAttemptAt: null, lastSuccessAt: null, consecutiveFailures: 0 });
  });
});
