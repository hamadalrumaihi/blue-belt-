import { describe, expect, it } from "vitest";
import { manualChangeHistory, matchAthlete, normalizeMatchStatus, parseBracketCsv, parseBracketRow, rowInstant } from "@/lib/manual-matches";

describe("normalizeMatchStatus", () => {
  it("maps the words people type onto the stored statuses", () => {
    expect(normalizeMatchStatus("")).toBe("scheduled");
    expect(normalizeMatchStatus("On mat")).toBe("on_mat");
    expect(normalizeMatchStatus("Finished")).toBe("complete");
    expect(normalizeMatchStatus("won")).toBe("complete");
    expect(normalizeMatchStatus("postponed")).toBe("delayed");
    expect(normalizeMatchStatus("???")).toBe("unknown");
  });
});

describe("parseBracketRow", () => {
  it("validates a row and turns a 'won' status into a result", () => {
    const r = parseBracketRow({ athlete: "  Khalid   Al-Thani ", opponent: "Yousef", round: "Quarter-final", mat: "Mat 2", time: "14:30", status: "won" });
    expect(r.ok && r.row).toMatchObject({ athlete: "Khalid Al-Thani", opponent: "Yousef", round: "Quarter-final", mat: "Mat 2", time: "14:30", status: "complete", result: "Won" });
    expect(parseBracketRow({ athlete: "" })).toMatchObject({ ok: false, error: "Missing athlete name." });
    expect(parseBracketRow({ athlete: "K", time: "half past two" })).toMatchObject({ ok: false, error: "K: time must be HH:MM." });
    expect(parseBracketRow({ athlete: "K", date: "2026-13-40" })).toMatchObject({ ok: false });
  });
});

describe("parseBracketCsv", () => {
  it("maps header aliases and parses rows one by one", () => {
    const csv = "Name,Vs,Stage,Mat,Time,Status,Next round\nAhmed,Sara,Final,1,15:00,scheduled,\nBad,,,,25:99,,\n";
    const out = parseBracketCsv(csv);
    expect(out.error).toBeUndefined();
    expect(out.headers).toEqual(["athlete", "opponent", "round", "mat", "time", "status", "next_round"]);
    expect(out.rows[0]).toMatchObject({ line: 2, parsed: { ok: true, row: { athlete: "Ahmed", opponent: "Sara", round: "Final", mat: "1", time: "15:00" } } });
    expect(out.rows[1].parsed).toMatchObject({ ok: false });
  });

  it("needs an athlete column", () => {
    expect(parseBracketCsv("opponent,mat\nX,1").error).toContain('"athlete"');
  });
});

describe("rowInstant", () => {
  it("resolves HH:MM on the row date, else the event date, in the event's zone", () => {
    expect(rowInstant({ time: "14:30", date: null }, "2026-10-10", "Asia/Qatar")).toBe("2026-10-10T11:30:00.000Z");
    expect(rowInstant({ time: "09:00", date: "2026-10-11" }, "2026-10-10", "Asia/Qatar")).toBe("2026-10-11T06:00:00.000Z");
    expect(rowInstant({ time: "2026-10-10T11:30:00.000Z", date: null }, null, "Asia/Qatar")).toBe("2026-10-10T11:30:00.000Z");
    expect(rowInstant({ time: null, date: null }, "2026-10-10", "Asia/Qatar")).toBeNull();
  });
});

describe("manualChangeHistory", () => {
  const prev = { mat: "Mat 1", scheduled_at: "2026-10-10T11:30:00.000Z", status: "scheduled", opponent: "Sara" };

  it("records a new match as found by hand, and only the fields that changed on an edit", () => {
    const created = manualChangeHistory(null, { mat: "Mat 1", scheduled_at: prev.scheduled_at, status: "scheduled", opponent: "Sara" }, "Asia/Qatar");
    expect(created).toEqual([{ change_type: "MATCH_FOUND", old_value: null, new_value: { value: "Mat 1", label: "Mat 1 · 14:30" } }]);
    const edited = manualChangeHistory(prev, { mat: "Mat 3", scheduled_at: prev.scheduled_at, status: "on_mat", opponent: "sara" }, "Asia/Qatar");
    expect(edited.map((h) => h.change_type)).toEqual(["MAT_CHANGE", "STATUS_CHANGE"]);
    expect(edited[0]).toMatchObject({ old_value: { value: "Mat 1", label: "Mat 1" }, new_value: { value: "Mat 3", label: "Mat 3" } });
    expect(manualChangeHistory(prev, { ...prev }, "Asia/Qatar")).toEqual([]);
  });
});

describe("matchAthlete", () => {
  it("matches by normalised name", () => {
    const list = [{ id: "a", name: "Khalid  Al-Thani" }];
    expect(matchAthlete(list, "khalid al-thani")?.id).toBe("a");
    expect(matchAthlete(list, "Khalid")).toBeNull();
  });
});
