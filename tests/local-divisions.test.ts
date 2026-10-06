import { describe, expect, it } from "vitest";
import {
  ageGroupsFor,
  ageOnDate,
  checkFit,
  composeLocalDivision,
  DEFAULT_LOCAL_RULES,
  divisionForWeight,
  findAgeGroup,
  findWeightDivision,
  parseDivisionRules,
  possibleAges,
  rulesOf,
  usesLocalDivisions,
} from "@/lib/local-divisions";

const R = DEFAULT_LOCAL_RULES;
const kids2 = findAgeGroup(R, "kids2")!;

describe("default local chart", () => {
  it("matches the photographer's chart", () => {
    expect(R.ageGroups.map((g) => [g.label, g.minAge, g.maxAge])).toEqual([
      ["Kids 1", 3, 5],
      ["Kids 2", 6, 7],
      ["Kids 3", 8, 9],
      ["Junior 1", 10, 11],
      ["Junior 2", 12, 14],
    ]);
    expect(kids2.divisions.map((d) => [d.label, d.maxKg])).toEqual([["Light", 24], ["Medium", 28], ["Medium Heavy", 32], ["Heavy", 36], ["Superheavy", 42]]);
    expect(findAgeGroup(R, "Junior 2")!.divisions.at(-1)).toEqual({ label: "Superheavy", maxKg: 64 });
  });

  it("carries no gender category", () => {
    expect(JSON.stringify(R)).not.toMatch(/male|female|gender/i);
  });
});

describe("parseDivisionRules", () => {
  it("round-trips the default chart and sorts divisions by maximum", () => {
    const parsed = parseDivisionRules(R);
    expect(parsed.ok && parsed.rules).toEqual(R);
    const shuffled = parseDivisionRules({ ageGroups: [{ label: "Open", minAge: 15, maxAge: 99, divisions: [{ label: "Heavy", maxKg: 90 }, { label: "Light", maxKg: 70 }] }] });
    expect(shuffled.ok && shuffled.rules.ageGroups[0]).toMatchObject({ id: "open", divisions: [{ label: "Light", maxKg: 70 }, { label: "Heavy", maxKg: 90 }] });
  });

  it("rejects bad input with a plain message", () => {
    expect(parseDivisionRules(null)).toMatchObject({ ok: false });
    expect(parseDivisionRules({ ageGroups: [] })).toMatchObject({ ok: false, error: "Add at least one age group." });
    expect(parseDivisionRules({ ageGroups: [{ label: "Kids", minAge: 7, maxAge: 5, divisions: [{ label: "L", maxKg: 20 }] }] })).toMatchObject({ ok: false, error: expect.stringContaining("ages must be whole numbers") });
    expect(parseDivisionRules({ ageGroups: [{ label: "Kids", minAge: 5, maxAge: 7, divisions: [] }] })).toMatchObject({ ok: false, error: expect.stringContaining("at least one weight division") });
    expect(parseDivisionRules({ ageGroups: [{ label: "Kids", minAge: 5, maxAge: 7, divisions: [{ label: "L", maxKg: 20 }, { label: "M", maxKg: 20 }] }] })).toMatchObject({ ok: false, error: expect.stringContaining("same maximum") });
  });

  it("keeps ids unique", () => {
    const parsed = parseDivisionRules({ ageGroups: [{ label: "Kids", minAge: 3, maxAge: 5, divisions: [{ label: "L", maxKg: 20 }] }, { label: "Kids", minAge: 6, maxAge: 7, divisions: [{ label: "L", maxKg: 24 }] }] });
    expect(parsed.ok && parsed.rules.ageGroups.map((g) => g.id)).toEqual(["kids", "kids-2"]);
  });
});

describe("rulesOf", () => {
  it("uses the event's own rules, the default chart for a LOCAL event, and nothing for AJP", () => {
    const custom = { version: 1, ageGroups: [{ id: "u16", label: "U16", minAge: 14, maxAge: 15, divisions: [{ label: "Light", maxKg: 55 }] }] };
    expect(rulesOf({ platform: "AJP", division_rules: custom })!.ageGroups[0].label).toBe("U16");
    expect(rulesOf({ platform: "LOCAL", division_rules: null })).toEqual(R);
    expect(rulesOf({ platform: "AJP", division_rules: null })).toBeNull();
    expect(usesLocalDivisions({ platform: "LOCAL" })).toBe(true);
    expect(usesLocalDivisions({ platform: "SMOOTHCOMP" })).toBe(false);
  });
});

describe("ages", () => {
  it("counts whole years on the event date", () => {
    expect(ageOnDate("2019-10-07", "2026-10-06")).toBe(6); // birthday tomorrow
    expect(ageOnDate("2019-10-06", "2026-10-06")).toBe(7);
    expect(ageOnDate("garbage", "2026-10-06")).toBeNull();
  });

  it("gives one age from a birth date and two from a birth year", () => {
    expect(possibleAges({ birthDate: "2019-03-01" }, "2026-10-06")).toEqual({ ages: [7], approximate: false });
    expect(possibleAges({ birthYear: 2019 }, "2026-10-06")).toEqual({ ages: [6, 7], approximate: true });
    expect(possibleAges({}, "2026-10-06")).toEqual({ ages: [], approximate: true });
  });

  it("filters age groups by any possible age", () => {
    expect(ageGroupsFor(R, [7]).map((g) => g.id)).toEqual(["kids2"]);
    expect(ageGroupsFor(R, [7, 8]).map((g) => g.id)).toEqual(["kids2", "kids3"]);
    expect(ageGroupsFor(R, [20])).toEqual([]);
    expect(ageGroupsFor(R, [])).toHaveLength(5);
  });
});

describe("weight fit", () => {
  it("treats every 'up to' value as the maximum: 36 kg is Heavy, 36.1 kg is Superheavy", () => {
    expect(divisionForWeight(kids2, 36)).toEqual({ label: "Heavy", maxKg: 36 });
    expect(divisionForWeight(kids2, 36.1)).toEqual({ label: "Superheavy", maxKg: 42 });
    expect(divisionForWeight(kids2, 20)).toEqual({ label: "Light", maxKg: 24 });
    expect(divisionForWeight(kids2, 50)).toBeNull();
  });

  it("a 7-year-old at 36 kg in Kids 2 → Heavy has no warnings", () => {
    const ages = possibleAges({ birthDate: "2019-03-01" }, "2026-10-06");
    expect(checkFit({ ...ages, weightKg: 36, ageGroup: kids2, weightDivision: findWeightDivision(kids2, "Heavy") })).toEqual([]);
  });

  it("warns when the weight is over the chosen division, naming the one that fits", () => {
    const w = checkFit({ ages: [7], approximate: false, weightKg: 37, ageGroup: kids2, weightDivision: findWeightDivision(kids2, "Heavy") });
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ field: "weight" });
    expect(w[0].message).toBe("37 kg is over the Heavy limit (up to 36 kg). It fits Superheavy (up to 42 kg).");
  });

  it("warns when a lighter division fits, and when the age is outside the group", () => {
    const w = checkFit({ ages: [7], approximate: false, weightKg: 30, ageGroup: kids2, weightDivision: findWeightDivision(kids2, "Superheavy") });
    expect(w[0].message).toBe("30 kg fits Medium Heavy (up to 32 kg); Superheavy is for over 36 kg.");
    const a = checkFit({ ages: [8, 9], approximate: true, weightKg: null, ageGroup: kids2, weightDivision: null });
    expect(a[0]).toMatchObject({ field: "age_group" });
    expect(a[0].message).toContain("Age 8–9 (from birth year) on the event date is outside Kids 2 (ages 6–7).");
  });

  it("says when the weight is above every division", () => {
    const w = checkFit({ ages: [7], approximate: false, weightKg: 50, ageGroup: kids2, weightDivision: findWeightDivision(kids2, "Superheavy") });
    expect(w[0].message).toContain("above every division in this age group");
  });

  it("composes the stored labels", () => {
    expect(composeLocalDivision(kids2, findWeightDivision(kids2, "Heavy"))).toBe("Kids 2 · Heavy (up to 36 kg)");
    expect(findWeightDivision(kids2, "Heavy (up to 36 kg)")).toEqual({ label: "Heavy", maxKg: 36 });
  });
});
