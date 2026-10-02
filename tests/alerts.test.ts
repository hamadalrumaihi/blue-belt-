import { describe, expect, it } from "vitest";
import { buildAlerts } from "@/lib/alerts";
import { bucketTone, computeEta, formatCountdown, formatMinutes, pickCurrentMatch, rankAthletes } from "@/lib/eta";
import type { NotificationPrefs } from "@/lib/settings";
import { athleteWithMatches, historyEntry, matchRow } from "./helpers/rows";

const NOW = new Date("2026-03-14T07:00:00.000Z");
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000).toISOString();
const ALL: NotificationPrefs = { m30: true, m15: true, m5: true, matChange: true, timeChange: true };

describe("computeEta", () => {
  it("buckets by minutes remaining", () => {
    expect(computeEta(matchRow({ scheduled_at: at(40) }), NOW)).toMatchObject({ bucket: "UPCOMING", minutesRemaining: 40, usesEstimate: false });
    expect(computeEta(matchRow({ scheduled_at: at(30) }), NOW).bucket).toBe("30 MIN");
    expect(computeEta(matchRow({ scheduled_at: at(16) }), NOW).bucket).toBe("30 MIN");
    expect(computeEta(matchRow({ scheduled_at: at(15) }), NOW).bucket).toBe("15 MIN");
    expect(computeEta(matchRow({ scheduled_at: at(6) }), NOW).bucket).toBe("15 MIN");
    expect(computeEta(matchRow({ scheduled_at: at(5) }), NOW).bucket).toBe("5 MIN");
    expect(computeEta(matchRow({ scheduled_at: at(3) }), NOW).bucket).toBe("5 MIN");
    expect(computeEta(matchRow({ scheduled_at: at(2) }), NOW)).toMatchObject({ bucket: "GO TO MAT", priority: 1 });
    expect(computeEta(matchRow({ scheduled_at: at(-10) }), NOW).bucket).toBe("GO TO MAT");
    expect(computeEta(matchRow({ scheduled_at: at(-45) }), NOW).bucket).toBe("GO TO MAT");
    expect(computeEta(matchRow({ scheduled_at: at(-46) }), NOW)).toMatchObject({ bucket: "UNKNOWN", minutesRemaining: -46 });
  });

  it("status overrides the clock", () => {
    expect(computeEta(matchRow({ status: "on_mat", scheduled_at: at(40) }), NOW)).toMatchObject({ bucket: "ON MAT", priority: 0, minutesRemaining: 40 });
    expect(computeEta(matchRow({ status: "complete", scheduled_at: at(-5) }), NOW)).toMatchObject({ bucket: "COMPLETE", priority: 8_000_000 });
    expect(computeEta(matchRow({ status: "delayed", scheduled_at: null }), NOW)).toMatchObject({ bucket: "DELAYED", minutesRemaining: null });
    expect(computeEta(matchRow({ status: "delayed", scheduled_at: at(10) }), NOW).bucket).toBe("15 MIN");
    expect(computeEta(matchRow({ status: "weird" }), NOW)).toMatchObject({ bucket: "UNKNOWN", minutesRemaining: null, priority: 9_000_000 });
    expect(computeEta(null, NOW)).toMatchObject({ bucket: "UNKNOWN", targetAt: null });
    expect(computeEta(matchRow({ scheduled_at: "garbage" }), NOW).bucket).toBe("UNKNOWN");
  });

  it("prefers estimated_at over scheduled_at", () => {
    const eta = computeEta(matchRow({ scheduled_at: at(40), estimated_at: at(4) }), NOW);
    expect(eta).toMatchObject({ bucket: "5 MIN", usesEstimate: true, targetAt: at(4), minutesRemaining: 4 });
  });

  it("bucketTone / formatMinutes / formatCountdown", () => {
    expect(bucketTone("ON MAT")).toBe("red");
    expect(bucketTone("5 MIN")).toBe("orange");
    expect(bucketTone("30 MIN")).toBe("amber");
    expect(bucketTone("UPCOMING")).toBe("green");
    expect(bucketTone("COMPLETE")).toBe("blue");
    expect(bucketTone("UNKNOWN")).toBe("gray");
    expect(formatMinutes(null)).toBe("—");
    expect(formatMinutes(0)).toBe("now");
    expect(formatMinutes(59)).toBe("59 min");
    expect(formatMinutes(125)).toBe("2h 5m");
    expect(formatMinutes(120)).toBe("2h");
    expect(formatCountdown(null)).toBe("No time yet");
    expect(formatCountdown(-50)).toBe("Time passed");
    expect(formatCountdown(-1)).toBe("Now");
    expect(formatCountdown(12)).toBe("in 12 min");
  });
});

describe("pickCurrentMatch / rankAthletes", () => {
  it("picks the on-mat match, else the soonest pending one, else the latest completed", () => {
    const done = matchRow({ id: "d", status: "complete", scheduled_at: at(-60) });
    const soon = matchRow({ id: "s", scheduled_at: at(20) });
    const later = matchRow({ id: "l", scheduled_at: at(90) });
    const live = matchRow({ id: "o", status: "on_mat" });
    expect(pickCurrentMatch([done, later, soon, live], NOW)?.id).toBe("o");
    expect(pickCurrentMatch([done, later, soon], NOW)?.id).toBe("s");
    expect(pickCurrentMatch([done], NOW)?.id).toBe("d");
    expect(pickCurrentMatch([], NOW)).toBeNull();
  });

  it("orders ON MAT -> GO TO MAT -> nearest ETA -> later -> complete -> unknown", () => {
    const athletes = [
      athleteWithMatches("Unknown", [matchRow({ scheduled_at: null })]),
      athleteWithMatches("Later", [matchRow({ scheduled_at: at(120) })]),
      athleteWithMatches("Complete", [matchRow({ status: "complete", scheduled_at: at(-30) })]),
      athleteWithMatches("Nearest", [matchRow({ scheduled_at: at(12) })]),
      athleteWithMatches("Go", [matchRow({ scheduled_at: at(1) })]),
      athleteWithMatches("NoMatch", []),
      athleteWithMatches("OnMat", [matchRow({ status: "on_mat" })]),
      athleteWithMatches("Soonish", [matchRow({ scheduled_at: at(25) })]),
    ];
    const ranked = rankAthletes(athletes, NOW);
    expect(ranked.map((r) => r.athlete.name)).toEqual(["OnMat", "Go", "Nearest", "Soonish", "Later", "Complete", "NoMatch", "Unknown"]);
    expect(ranked.map((r) => r.eta.bucket)).toEqual(["ON MAT", "GO TO MAT", "15 MIN", "30 MIN", "UPCOMING", "COMPLETE", "UNKNOWN", "UNKNOWN"]);
  });

  it("breaks ties by name", () => {
    const ranked = rankAthletes([athleteWithMatches("Zed", [matchRow({ scheduled_at: at(10) })]), athleteWithMatches("Amy", [matchRow({ scheduled_at: at(10) })])], NOW);
    expect(ranked.map((r) => r.athlete.name)).toEqual(["Amy", "Zed"]);
  });
});

describe("buildAlerts", () => {
  const ranked = (minutes: number | null, status = "scheduled", mat: string | null = "Mat 3", name = "Hamad Al Rumaihi") =>
    rankAthletes([athleteWithMatches(name, [matchRow({ id: `m-${name}`, scheduled_at: minutes === null ? null : at(minutes), status, mat })])], NOW);

  it("raises threshold alerts at 30 / 15 / 5 with the right level and copy", () => {
    expect(buildAlerts(ranked(30), [], ALL, NOW)).toMatchObject([{ kind: "THRESHOLD_30", level: "info", id: "m30:m-Hamad Al Rumaihi", title: "Hamad Al Rumaihi in 30 min", body: "Upcoming on Mat 3.", mat: "Mat 3" }]);
    expect(buildAlerts(ranked(15), [], ALL, NOW)).toMatchObject([{ kind: "THRESHOLD_15", level: "warning", title: "Hamad Al Rumaihi in 15 min", body: "Get ready on Mat 3." }]);
    expect(buildAlerts(ranked(5), [], ALL, NOW)).toMatchObject([{ kind: "THRESHOLD_5", level: "warning", title: "Hamad Al Rumaihi in 5 min", body: "Head to on Mat 3 now." }]);
    expect(buildAlerts(ranked(5, "scheduled", null), [], ALL, NOW)).toMatchObject([{ kind: "THRESHOLD_5", body: "Head to the mat now.", mat: null }]);
    expect(buildAlerts(ranked(31), [], ALL, NOW)).toEqual([]);
  });

  it("GO TO MAT and ON MAT are always raised (danger), regardless of prefs", () => {
    const none: NotificationPrefs = { m30: false, m15: false, m5: false, matChange: false, timeChange: false };
    expect(buildAlerts(ranked(1), [], none, NOW)).toMatchObject([{ kind: "GO_TO_MAT", level: "danger", title: "GO TO MAT — Hamad Al Rumaihi", body: "Match starting now on Mat 3." }]);
    expect(buildAlerts(ranked(40, "on_mat"), [], none, NOW)).toMatchObject([{ kind: "ON_MAT", level: "danger", title: "Hamad Al Rumaihi is ON MAT", body: "Match in progress on Mat 3." }]);
    expect(buildAlerts(ranked(null, "complete"), [], ALL, NOW)).toEqual([]);
  });

  it("respects the threshold toggles", () => {
    expect(buildAlerts(ranked(30), [], { ...ALL, m30: false }, NOW)).toEqual([]);
    expect(buildAlerts(ranked(15), [], { ...ALL, m15: false }, NOW)).toEqual([]);
    expect(buildAlerts(ranked(5), [], { ...ALL, m5: false }, NOW)).toEqual([]);
  });

  it("reports MOVED_EARLIER for any earlier move and MOVED_LATER only from 15 minutes", () => {
    const time = (from: number, to: number, id: number, type = "TIME_CHANGE") =>
      historyEntry({ id, change_type: type, old_value: { value: at(from), label: `T${from}` }, new_value: { value: at(to), label: `T${to}` }, detected_at: at(-1) });
    const alerts = buildAlerts([], [time(60, 55, 1), time(60, 74, 2), time(60, 75, 3), time(60, 120, 4, "ETA_CHANGE")], ALL, NOW);
    expect(alerts.map((a) => [a.kind, a.level, a.id, a.body])).toEqual([
      ["MOVED_EARLIER", "danger", "hist:1", "T60 → T55 (5 min earlier)"],
      ["MOVED_LATER", "warning", "hist:3", "T60 → T75 (+15 min)"],
      ["MOVED_LATER", "warning", "hist:4", "T60 → T120 (+60 min)"],
    ]);
    expect(alerts[0]).toMatchObject({ athleteId: historyEntry().athlete_id, athleteName: "Hamad Al Rumaihi", changeType: "TIME_CHANGE", createdAt: at(-1) });
    expect(buildAlerts([], [time(60, 55, 9)], { ...ALL, timeChange: false }, NOW)).toEqual([]);
    // Unparseable values are skipped.
    expect(buildAlerts([], [historyEntry({ change_type: "TIME_CHANGE", old_value: { value: null, label: "Unknown" }, new_value: { value: at(5), label: "x" }, detected_at: at(-1) })], ALL, NOW)).toEqual([]);
  });

  it("reports MAT_CHANGE (with the new mat) and status -> on_mat from history", () => {
    const mat = historyEntry({ id: 10, change_type: "MAT_CHANGE", old_value: { value: "Mat 1", label: "Mat 1" }, new_value: { value: "Mat 3", label: "Mat 3" }, detected_at: at(-2), athlete_name: null });
    const status = historyEntry({ id: 11, change_type: "STATUS_CHANGE", old_value: { value: "scheduled", label: "Scheduled" }, new_value: { value: "on_mat", label: "On mat" }, detected_at: at(-2) });
    const alerts = buildAlerts([], [mat, status], ALL, NOW);
    expect(alerts).toMatchObject([
      { kind: "MAT_CHANGE", level: "danger", id: "hist:10", title: "MAT CHANGE — A client", body: "Mat 1 → Mat 3", mat: "Mat 3" },
      { kind: "ON_MAT", level: "danger", id: "hist:11", title: "Hamad Al Rumaihi is ON MAT", body: "Status changed to on mat." },
    ]);
    expect(buildAlerts([], [mat], { ...ALL, matChange: false }, NOW)).toEqual([]);
    expect(buildAlerts([], [historyEntry({ change_type: "OPPONENT_CHANGE", detected_at: at(-1) })], ALL, NOW)).toEqual([]);
  });

  it("ignores history older than the 20-minute window", () => {
    const fresh = historyEntry({ id: 20, change_type: "MAT_CHANGE", detected_at: at(-19) });
    const stale = historyEntry({ id: 21, change_type: "MAT_CHANGE", detected_at: at(-21) });
    expect(buildAlerts([], [stale, fresh], ALL, NOW).map((a) => a.id)).toEqual(["hist:20"]);
  });

  it("orders alerts danger -> warning -> info", () => {
    const athletes = [
      athleteWithMatches("Info", [matchRow({ id: "i", scheduled_at: at(28) })]),
      athleteWithMatches("Warn", [matchRow({ id: "w", scheduled_at: at(12) })]),
    ];
    const history = [historyEntry({ id: 30, change_type: "MAT_CHANGE", detected_at: at(-1) })];
    const alerts = buildAlerts(rankAthletes(athletes, NOW), history, ALL, NOW);
    expect(alerts.map((a) => a.level)).toEqual(["danger", "warning", "info"]);
    expect(alerts.map((a) => a.kind)).toEqual(["MAT_CHANGE", "THRESHOLD_15", "THRESHOLD_30"]);
  });
});
