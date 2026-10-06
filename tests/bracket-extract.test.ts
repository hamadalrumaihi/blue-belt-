import { describe, expect, it } from "vitest";
import { coerceExtracted, extractedToRows, isExtractMediaType } from "@/lib/bracket-extract";

describe("coerceExtracted", () => {
  it("never trusts the shape: drops nameless matches, trims, caps lists", () => {
    const out = coerceExtracted({ ageGroup: " Kids 2 ", division: null, matches: [{ athlete: " Ahmed ", opponent: "", winner: 7 }, { athlete: "" }, null, "x"], unreadable: ["blurry row 3", 5] });
    expect(out).toEqual({ ageGroup: "Kids 2", division: null, matches: [{ athlete: "Ahmed", opponent: null, round: null, mat: null, time: null, matchNumber: null, result: null, winner: null }], unreadable: ["blurry row 3"] });
    expect(coerceExtracted(null)).toEqual({ ageGroup: null, division: null, matches: [], unreadable: [] });
  });
});

describe("extractedToRows", () => {
  const extracted = coerceExtracted({
    ageGroup: "Kids 2",
    division: "Heavy",
    matches: [
      { athlete: "Khalid Al-Thani", opponent: "Yousef Al-Marri", round: "Semi-final", mat: "2", time: "14:30", matchNumber: "12", result: "Points 4-2", winner: "Khalid Al-Thani" },
      { athlete: "Sara Haddad", opponent: null, round: "Semi-final", mat: null, time: null, matchNumber: null, result: null, winner: null },
    ],
    unreadable: [],
  });

  it("builds a row for each client on the bracket, with won / lost from the marked winner", () => {
    const rows = extractedToRows(extracted, new Set(["khalid al-thani", "yousef al-marri"]));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ athlete: "Khalid Al-Thani", opponent: "Yousef Al-Marri", round: "Semi-final", mat: "2", time: "14:30", matchNumber: "12", status: "complete", result: "Won · Points 4-2", ageGroup: "Kids 2", division: "Heavy" });
    expect(rows[1]).toMatchObject({ athlete: "Yousef Al-Marri", opponent: "Khalid Al-Thani", status: "complete", result: "Lost · Points 4-2" });
  });

  it("includes everyone when asked, and leaves undecided matches scheduled with a bye as no opponent", () => {
    const rows = extractedToRows(extracted, new Set(), { everyone: true });
    expect(rows.map((r) => r.athlete)).toEqual(["Khalid Al-Thani", "Yousef Al-Marri", "Sara Haddad"]);
    expect(rows[2]).toMatchObject({ opponent: null, status: "scheduled", result: null });
    expect(extractedToRows(extracted, new Set())).toEqual([]);
  });
});

describe("isExtractMediaType", () => {
  it("accepts the image types the reader supports", () => {
    expect(isExtractMediaType("image/png")).toBe(true);
    expect(isExtractMediaType("application/pdf")).toBe(false);
  });
});
