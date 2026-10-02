import { describe, expect, it } from "vitest";
import { detectChanges, mergeMatch } from "@/lib/changes";
import { TIME_TOLERANCE_MS, snapshotNumber, takeMatching } from "@/lib/match-identity";
import { buildRefreshPlan, describeParsed, isSuccessfulRead, planToRpcArgs } from "@/lib/refresh-plan";
import { matchRow, normalized, watchResult } from "./helpers/rows";

const CHECKED_AT = "2026-03-14T06:30:00.000Z";
const ROW_A = "aaaaaaaa-0000-4000-8000-00000000000a";
const ROW_B = "aaaaaaaa-0000-4000-8000-00000000000b";

describe("takeMatching (match identity)", () => {
  it("matches by external id first and claims the row", () => {
    const pool = [matchRow({ id: ROW_A, external_match_id: "9012", opponent: "Someone Else" }), matchRow({ id: ROW_B, external_match_id: "9027" })];
    const found = takeMatching(pool, normalized({ externalMatchId: "9012", opponent: "João Silva" }), 2);
    expect(found).toMatchObject({ kind: "match", confidence: "exact", row: { id: ROW_A } });
    expect(pool.map((m) => m.id)).toEqual([ROW_B]);
  });

  it("matches by match number stored in raw_snapshot", () => {
    const pool = [matchRow({ id: ROW_A, raw_snapshot: { matchNumber: "12" } }), matchRow({ id: ROW_B, raw_snapshot: { matchNumber: 27 } })];
    expect(snapshotNumber(pool[1])).toBe("27");
    expect(snapshotNumber(matchRow({ raw_snapshot: [] }))).toBeNull();
    const found = takeMatching(pool, normalized({ matchNumber: "27", opponent: "Nobody" }), 2);
    expect(found).toMatchObject({ kind: "match", confidence: "exact", row: { id: ROW_B } });
    expect(pool).toHaveLength(1);
  });

  it("treats a lone id-less stored row as the probable match for a lone parsed match", () => {
    const pool = [matchRow({ id: ROW_A, opponent: "Old Opponent" })];
    expect(takeMatching(pool, normalized({ opponent: "New Opponent", scheduledAt: null }), 1)).toMatchObject({ kind: "match", confidence: "probable", row: { id: ROW_A } });
    expect(pool).toHaveLength(0);
  });

  it("does not use the single-row shortcut when several matches were parsed", () => {
    const pool = [matchRow({ id: ROW_A, opponent: "Old Opponent", scheduled_at: null })];
    expect(takeMatching(pool, normalized({ opponent: "New Opponent", scheduledAt: null }), 2)).toEqual({ kind: "none" });
    expect(pool).toHaveLength(1);
  });

  it("matches by opponent when exactly one id-less row shares it", () => {
    const pool = [matchRow({ id: ROW_A, opponent: "Marco Rossi" }), matchRow({ id: ROW_B, opponent: "João Silva" })];
    const found = takeMatching(pool, normalized({ opponent: "JOÃO SILVA" }), 2);
    expect(found).toMatchObject({ kind: "match", confidence: "probable", row: { id: ROW_B } });
    expect(pool.map((m) => m.id)).toEqual([ROW_A]);
  });

  it("ignores rows that still carry an id or number for the fallback keys", () => {
    const pool = [matchRow({ id: ROW_A, opponent: "João Silva", external_match_id: "9999" }), matchRow({ id: ROW_B, opponent: "Marco Rossi" })];
    expect(takeMatching(pool, normalized({ opponent: "João Silva", scheduledAt: null }), 2)).toEqual({ kind: "none" });
  });

  it("reports ambiguity when two id-less rows share the opponent, leaving the pool intact", () => {
    const pool = [matchRow({ id: ROW_A, opponent: "João Silva" }), matchRow({ id: ROW_B, opponent: "João Silva" })];
    const found = takeMatching(pool, normalized({ opponent: "João Silva" }), 3);
    expect(found.kind).toBe("ambiguous");
    if (found.kind === "ambiguous") expect(found.candidates.map((c) => c.id)).toEqual([ROW_A, ROW_B]);
    expect(pool).toHaveLength(2);
  });

  it("matches by scheduled time within the tolerance", () => {
    expect(TIME_TOLERANCE_MS).toBe(60_000);
    const pool = [matchRow({ id: ROW_A, scheduled_at: "2026-03-14T07:40:30.000Z" }), matchRow({ id: ROW_B, scheduled_at: "2026-03-14T09:00:00.000Z" })];
    const found = takeMatching(pool, normalized({ opponent: null, scheduledAt: "2026-03-14T07:40:00.000Z" }), 2);
    expect(found).toMatchObject({ kind: "match", confidence: "probable", row: { id: ROW_A } });
    const none = takeMatching([matchRow({ id: ROW_B, scheduled_at: "2026-03-14T07:41:00.000Z" })], normalized({ opponent: null, scheduledAt: "2026-03-14T07:40:00.000Z" }), 2);
    expect(none).toEqual({ kind: "none" });
  });

  it("returns none for an empty pool", () => {
    expect(takeMatching([], normalized(), 1)).toEqual({ kind: "none" });
  });
});

describe("buildRefreshPlan", () => {
  it("inserts a new row for a first-ever match with MATCH_FOUND history (match_ref)", () => {
    const plan = buildRefreshPlan([], watchResult({ matches: [normalized({ matchNumber: "12" })] }), CHECKED_AT);
    expect(plan.ok).toBe(true);
    expect(plan.updates).toEqual([]);
    expect(plan.inserts).toHaveLength(1);
    expect(plan.inserts[0]).toMatchObject({ opponent: "João Silva", mat: "Mat 3", identity_confidence: "exact", last_checked_at: CHECKED_AT, last_changed_at: CHECKED_AT, raw_snapshot: { matchNumber: "12", athlete: "Hamad Al-Rumaihi" } });
    expect(plan.history).toEqual([{ change_type: "MATCH_FOUND", old_value: { value: null, label: "No match" }, new_value: { value: null, label: "Mat 3 · 10:40 · vs João Silva" }, match_ref: 0 }]);
    expect(plan.touchIds).toEqual([]);
    expect(plan.preview).toEqual([{ ...plan.inserts[0], ref: 0 }]);
    expect(plan.ambiguous).toBe(0);
  });

  it("keeps an ambiguous parsed match apart: new row flagged ambiguous + IDENTITY_AMBIGUOUS history, no merge", () => {
    const existing = [matchRow({ id: ROW_A, opponent: "João Silva", mat: "Mat 1" }), matchRow({ id: ROW_B, opponent: "João Silva", mat: "Mat 2" })];
    const plan = buildRefreshPlan(existing, watchResult({ matches: [normalized({ opponent: "João Silva", mat: "Mat 3" })] }), CHECKED_AT);
    expect(plan.updates).toEqual([]);
    expect(plan.inserts).toHaveLength(1);
    expect(plan.inserts[0].identity_confidence).toBe("ambiguous");
    expect(plan.ambiguous).toBe(1);
    expect(plan.history).toEqual([
      {
        change_type: "IDENTITY_AMBIGUOUS",
        old_value: { value: `${ROW_A},${ROW_B}`, label: "2 similar matches" },
        new_value: { value: null, label: "Mat 3 · 10:40 · vs João Silva" },
        match_ref: 0,
      },
    ]);
    // Both stored rows survive untouched apart from the re-stamp.
    expect(plan.touchIds).toEqual([ROW_A, ROW_B]);
    expect(plan.preview.map((p) => ("id" in p ? p.id : `ref:${p.ref}`))).toEqual(["ref:0", ROW_A, ROW_B]);
  });

  it("upgrades identity when the external id appears later", () => {
    const stored = matchRow({ id: ROW_A, opponent: "João Silva", mat: "Mat 3", scheduled_at: "2026-03-14T07:40:00.000Z", identity_confidence: "probable" });
    const parsed = normalized({ externalMatchId: "9012", matchNumber: "12" });

    const first = buildRefreshPlan([stored], watchResult({ matches: [parsed] }), CHECKED_AT);
    expect(first.updates).toHaveLength(1);
    expect(first.updates[0].id).toBe(ROW_A);
    // Matched through the single-row fallback: still probable, but the id is now stored.
    expect(first.updates[0].patch).toMatchObject({ external_match_id: "9012", identity_confidence: "probable", raw_snapshot: { matchNumber: "12" } });
    expect(first.history.map((h) => h.change_type)).toEqual(["MATCH_NUMBER_CHANGE"]);
    expect(first.history[0]).toMatchObject({ match_id: ROW_A });

    const upgraded = { ...stored, ...first.updates[0].patch };
    const second = buildRefreshPlan([upgraded], watchResult({ matches: [parsed, normalized({ externalMatchId: "9027", opponent: "Marco Rossi" })] }), CHECKED_AT);
    expect(second.updates[0]).toMatchObject({ id: ROW_A, patch: { identity_confidence: "exact" } });
    expect(second.history.filter((h) => h.match_id === ROW_A)).toEqual([]);
    expect(second.inserts).toHaveLength(1);
  });

  it("keeps an ambiguous row flagged on a probable match and clears it on an exact match", () => {
    const flagged = matchRow({ id: ROW_A, opponent: "João Silva", identity_confidence: "ambiguous" });
    const probable = buildRefreshPlan([flagged], watchResult({ matches: [normalized()] }), CHECKED_AT);
    expect(probable.updates[0].patch.identity_confidence).toBe("ambiguous");
    const exact = buildRefreshPlan([{ ...flagged, external_match_id: "9012" }], watchResult({ matches: [normalized({ externalMatchId: "9012" })] }), CHECKED_AT);
    expect(exact.updates[0].patch.identity_confidence).toBe("exact");
  });

  it("FETCH_ERROR keeps existing rows untouched (ok false, nothing to apply)", () => {
    const existing = [matchRow({ id: ROW_A }), matchRow({ id: ROW_B })];
    const plan = buildRefreshPlan(existing, watchResult({ status: "FETCH_ERROR", code: "SOURCE_TIMEOUT", matches: [] }), CHECKED_AT);
    expect(plan).toEqual({ ok: false, updates: [], inserts: [], history: [], touchIds: [], preview: existing, ambiguous: 0 });
    expect(isSuccessfulRead("FETCH_ERROR")).toBe(false);
    expect(isSuccessfulRead("REQUIRES_BROWSER_WATCHER")).toBe(false);
  });

  it("NO_MATCHES touches existing rows but never deletes them", () => {
    const existing = [matchRow({ id: ROW_A }), matchRow({ id: ROW_B })];
    for (const status of ["NO_MATCHES", "ATHLETE_NOT_FOUND"] as const) {
      const plan = buildRefreshPlan(existing, watchResult({ status, matches: [] }), CHECKED_AT);
      expect(plan.ok).toBe(true);
      expect(plan.touchIds).toEqual([ROW_A, ROW_B]);
      expect(plan.updates).toEqual([]);
      expect(plan.inserts).toEqual([]);
      expect(plan.history).toEqual([]);
      expect(plan.preview).toBe(existing);
    }
    // An OK result with zero rows behaves the same way.
    expect(buildRefreshPlan(existing, watchResult({ status: "OK", matches: [] }), CHECKED_AT).touchIds).toEqual([ROW_A, ROW_B]);
  });

  it("records mat / time / opponent / status changes against the matched row", () => {
    const stored = matchRow({ id: ROW_A, external_match_id: "9012", opponent: "João Silva", mat: "Mat 1", scheduled_at: "2026-03-14T07:00:00.000Z", status: "scheduled" });
    const parsed = normalized({ externalMatchId: "9012", opponent: "Khalid Noor", mat: "Mat 3", scheduledAt: "2026-03-14T07:40:00.000Z", status: "on_mat" });
    const plan = buildRefreshPlan([stored], watchResult({ matches: [parsed] }), CHECKED_AT, "Asia/Qatar");
    expect(plan.history.map((h) => [h.change_type, h.old_value.label, h.new_value.label, h.match_id])).toEqual([
      ["MAT_CHANGE", "Mat 1", "Mat 3", ROW_A],
      ["TIME_CHANGE", "10:00", "10:40", ROW_A],
      ["OPPONENT_CHANGE", "João Silva", "Khalid Noor", ROW_A],
      ["STATUS_CHANGE", "Scheduled", "On mat", ROW_A],
    ]);
    expect(plan.updates[0].patch).toMatchObject({ mat: "Mat 3", opponent: "Khalid Noor", status: "on_mat", last_changed_at: CHECKED_AT });
  });

  it("rows the source no longer lists are only re-stamped", () => {
    const stored = [matchRow({ id: ROW_A, external_match_id: "9012" }), matchRow({ id: ROW_B, external_match_id: "9027", last_checked_at: "old" })];
    const plan = buildRefreshPlan(stored, watchResult({ matches: [normalized({ externalMatchId: "9012" })] }), CHECKED_AT);
    expect(plan.touchIds).toEqual([ROW_B]);
    expect(plan.preview[1]).toMatchObject({ id: ROW_B, last_checked_at: CHECKED_AT });
  });

  it("describeParsed", () => {
    expect(describeParsed(normalized(), "Asia/Qatar")).toBe("Mat 3 · 10:40 · vs João Silva");
    expect(describeParsed(normalized({ mat: null, scheduledAt: null, opponent: null }), "Asia/Qatar")).toBe("Match added");
    expect(describeParsed(normalized({ scheduledAt: "garbage" }), "Asia/Qatar")).toBe("Mat 3 · vs João Silva");
  });
});

describe("detectChanges / mergeMatch", () => {
  const stored = matchRow({ id: ROW_A, opponent: "João Silva", mat: "Mat 3", scheduled_at: "2026-03-14T07:40:00.000Z", estimated_at: null, status: "scheduled", match_order: 2, raw_snapshot: { matchNumber: "12" } });

  it("reports nothing when the parse matches the stored row (case / whitespace insensitive)", () => {
    expect(detectChanges(stored, normalized({ opponent: " joão silva ", mat: "mat 3", matchNumber: "12", matchOrder: 2 }), "Asia/Qatar")).toEqual([]);
  });

  it("never reports known -> unknown for opponent or mat, nor status -> unknown", () => {
    const changes = detectChanges(stored, normalized({ opponent: null, mat: null, status: "unknown", matchNumber: "12", matchOrder: 2 }), "Asia/Qatar");
    expect(changes).toEqual([]);
  });

  it("reports unknown -> known for mat and opponent", () => {
    const blank = matchRow({ id: ROW_A, opponent: null, mat: null, scheduled_at: "2026-03-14T07:40:00.000Z" });
    const changes = detectChanges(blank, normalized({ matchNumber: null }), "Asia/Qatar");
    expect(changes).toEqual([
      { change_type: "MAT_CHANGE", old_value: { value: null, label: "Unknown" }, new_value: { value: "Mat 3", label: "Mat 3" } },
      { change_type: "OPPONENT_CHANGE", old_value: { value: null, label: "Unknown" }, new_value: { value: "João Silva", label: "João Silva" } },
    ]);
  });

  it("reports ETA, order and match number changes with formatted labels", () => {
    const changes = detectChanges(stored, normalized({ estimatedAt: "2026-03-14T07:55:00.000Z", matchOrder: 3, matchNumber: "14" }), "Asia/Qatar");
    expect(changes).toEqual([
      { change_type: "ETA_CHANGE", old_value: { value: null, label: "Unknown" }, new_value: { value: "2026-03-14T07:55:00.000Z", label: "10:55" } },
      { change_type: "ORDER_CHANGE", old_value: { value: 2, label: "#2" }, new_value: { value: 3, label: "#3" } },
      { change_type: "MATCH_NUMBER_CHANGE", old_value: { value: "12", label: "12" }, new_value: { value: "14", label: "14" } },
    ]);
  });

  it("normalises time representations before comparing", () => {
    expect(detectChanges(stored, normalized({ scheduledAt: "2026-03-14T10:40:00+03:00", matchNumber: "12", matchOrder: 2 }), "Asia/Qatar")).toEqual([]);
  });

  it("mergeMatch never erases known values with nulls and only bumps last_changed_at on a change", () => {
    const merged = mergeMatch(stored, normalized({ opponent: null, mat: null, status: "unknown", matchNumber: "12", matchOrder: 2 }), CHECKED_AT);
    expect(merged).toMatchObject({ opponent: "João Silva", mat: "Mat 3", scheduled_at: "2026-03-14T07:40:00.000Z", status: "scheduled", match_order: 2, last_checked_at: CHECKED_AT, last_changed_at: stored.last_changed_at });
    // Losing a time or an order is still a change (only opponent/mat are exempt).
    expect(mergeMatch(stored, normalized({ scheduledAt: null, matchNumber: "12", matchOrder: null }), CHECKED_AT)).toMatchObject({ scheduled_at: "2026-03-14T07:40:00.000Z", match_order: 2, last_changed_at: CHECKED_AT });
    const changed = mergeMatch(stored, normalized({ mat: "Mat 4", matchNumber: "12", matchOrder: 2 }), CHECKED_AT);
    expect(changed.last_changed_at).toBe(CHECKED_AT);
    const fresh = mergeMatch(null, normalized({ status: "unknown" }), CHECKED_AT);
    expect(fresh.status).toBe("unknown");
    expect(fresh.last_changed_at).toBe(CHECKED_AT);
  });
});

describe("planToRpcArgs", () => {
  it("serialises match_id for existing rows and match_ref for inserts", () => {
    const stored = matchRow({ id: ROW_A, external_match_id: "9012", mat: "Mat 1", opponent: "João Silva", scheduled_at: "2026-03-14T07:40:00.000Z" });
    const plan = buildRefreshPlan([stored, matchRow({ id: ROW_B, external_match_id: "9099" })], watchResult({ matches: [normalized({ externalMatchId: "9012" }), normalized({ externalMatchId: "9027", opponent: "Marco Rossi" })] }), CHECKED_AT);
    const args = planToRpcArgs(plan);
    expect(args.p_touch_ids).toEqual([ROW_B]);
    expect(args.p_updates).toEqual([{ id: ROW_A, patch: plan.updates[0].patch }]);
    expect(args.p_inserts).toEqual(plan.inserts);
    const history = args.p_history as Array<Record<string, unknown>>;
    expect(history).toHaveLength(2);
    expect(history[0]).toEqual({ change_type: "MAT_CHANGE", old_value: { value: "Mat 1", label: "Mat 1" }, new_value: { value: "Mat 3", label: "Mat 3" }, match_id: ROW_A });
    expect(history[0]).not.toHaveProperty("match_ref");
    expect(history[1]).toMatchObject({ change_type: "MATCH_FOUND", match_ref: 0 });
    expect(history[1]).not.toHaveProperty("match_id");
    expect(() => JSON.stringify(args)).not.toThrow();
  });
});
