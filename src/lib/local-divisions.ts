/**
 * Local competitions: each event carries its own age groups and weight
 * divisions (photo_events.division_rules), editable per event. Nothing here
 * assumes AJP or Smoothcomp rules, and nothing infers a gender category.
 *
 * Checks use the athlete's real age on the event date and real weight in kg.
 * Every "up to" value is that division's maximum. They only warn: the owner
 * can always keep a different choice.
 */

export type WeightDivision = { label: string; maxKg: number };
export type AgeGroup = { id: string; label: string; minAge: number; maxAge: number; divisions: WeightDivision[] };
export type DivisionRules = { version: 1; ageGroups: AgeGroup[] };

const group = (id: string, label: string, minAge: number, maxAge: number, pairs: Array<[string, number]>): AgeGroup => ({
  id,
  label,
  minAge,
  maxAge,
  divisions: pairs.map(([label, maxKg]) => ({ label, maxKg })),
});

/** The default chart for a local event. Editable per event; this is only the starting point. */
export const DEFAULT_LOCAL_RULES: DivisionRules = {
  version: 1,
  ageGroups: [
    group("kids1", "Kids 1", 3, 5, [["Light", 20], ["Medium", 24], ["Medium Heavy", 28], ["Heavy", 32]]),
    group("kids2", "Kids 2", 6, 7, [["Light", 24], ["Medium", 28], ["Medium Heavy", 32], ["Heavy", 36], ["Superheavy", 42]]),
    group("kids3", "Kids 3", 8, 9, [["Light", 28], ["Medium", 32], ["Medium Heavy", 36], ["Heavy", 40], ["Superheavy", 46]]),
    group("junior1", "Junior 1", 10, 11, [["Light", 34], ["Medium", 40], ["Medium Heavy", 46], ["Heavy", 52], ["Superheavy", 58]]),
    group("junior2", "Junior 2", 12, 14, [["Light", 40], ["Medium", 46], ["Medium Heavy", 52], ["Heavy", 58], ["Superheavy", 64]]),
  ],
};

export const MAX_AGE_GROUPS = 30;
export const MAX_DIVISIONS_PER_GROUP = 20;

export type RulesParse = { ok: true; rules: DivisionRules } | { ok: false; error: string };

function slug(label: string): string {
  return label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "group";
}

/**
 * Validates rules from the editor or a stored JSON column. Labels are trimmed,
 * divisions sorted by maxKg, ids made unique. Never throws.
 */
export function parseDivisionRules(input: unknown): RulesParse {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, error: "Division rules must be an object." };
  const raw = (input as { ageGroups?: unknown }).ageGroups;
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, error: "Add at least one age group." };
  if (raw.length > MAX_AGE_GROUPS) return { ok: false, error: `At most ${MAX_AGE_GROUPS} age groups.` };
  const ids = new Set<string>();
  const ageGroups: AgeGroup[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const g = raw[i] as Record<string, unknown> | null;
    const label = typeof g?.label === "string" ? g.label.trim().slice(0, 60) : "";
    if (!label) return { ok: false, error: `Age group ${i + 1} needs a name.` };
    const minAge = Number(g?.minAge);
    const maxAge = Number(g?.maxAge);
    if (!Number.isInteger(minAge) || !Number.isInteger(maxAge) || minAge < 0 || maxAge > 120 || minAge > maxAge) {
      return { ok: false, error: `${label}: ages must be whole numbers with "from" not above "to".` };
    }
    const rawDivs = Array.isArray(g?.divisions) ? g.divisions : [];
    if (rawDivs.length === 0) return { ok: false, error: `${label}: add at least one weight division.` };
    if (rawDivs.length > MAX_DIVISIONS_PER_GROUP) return { ok: false, error: `${label}: at most ${MAX_DIVISIONS_PER_GROUP} weight divisions.` };
    const divisions: WeightDivision[] = [];
    for (const d of rawDivs as Array<Record<string, unknown> | null>) {
      const dl = typeof d?.label === "string" ? d.label.trim().slice(0, 60) : "";
      const maxKg = Number(d?.maxKg);
      if (!dl) return { ok: false, error: `${label}: every weight division needs a name.` };
      if (!Number.isFinite(maxKg) || maxKg <= 0 || maxKg >= 400) return { ok: false, error: `${label} · ${dl}: enter the maximum weight in kg.` };
      divisions.push({ label: dl, maxKg: Math.round(maxKg * 100) / 100 });
    }
    divisions.sort((a, b) => a.maxKg - b.maxKg);
    for (let k = 1; k < divisions.length; k += 1) {
      if (divisions[k].maxKg === divisions[k - 1].maxKg) return { ok: false, error: `${label}: two divisions share the same maximum (${divisions[k].maxKg} kg).` };
    }
    let id = typeof g?.id === "string" && /^[a-z0-9-]{1,40}$/.test(g.id) ? g.id : slug(label);
    while (ids.has(id)) id = `${id}-${ids.size + 1}`;
    ids.add(id);
    ageGroups.push({ id, label, minAge, maxAge, divisions });
  }
  return { ok: true, rules: { version: 1, ageGroups } };
}

/** The rules an event uses: its own when set and valid, else none (platform defaults apply). */
export function rulesOf(event: { division_rules?: unknown; platform?: string | null } | null | undefined): DivisionRules | null {
  if (!event) return null;
  if (event.division_rules) {
    const parsed = parseDivisionRules(event.division_rules);
    if (parsed.ok) return parsed.rules;
  }
  return event.platform === "LOCAL" ? DEFAULT_LOCAL_RULES : null;
}

/** True when the event's divisions are its own chart (local rules), not the AJP tables. */
export function usesLocalDivisions(event: { division_rules?: unknown; platform?: string | null } | null | undefined): boolean {
  return rulesOf(event) !== null;
}

export function findAgeGroup(rules: DivisionRules, idOrLabel: string | null | undefined): AgeGroup | null {
  if (!idOrLabel) return null;
  const key = idOrLabel.trim().toLowerCase();
  return rules.ageGroups.find((g) => g.id === key || g.label.toLowerCase() === key) ?? null;
}

export function findWeightDivision(group: AgeGroup | null, label: string | null | undefined): WeightDivision | null {
  if (!group || !label) return null;
  const key = label.trim().toLowerCase();
  return group.divisions.find((d) => d.label.toLowerCase() === key || divisionLabel(d).toLowerCase() === key) ?? null;
}

/** "Heavy (up to 36 kg)" — what is stored in photo_athletes.weight and shown on cards. */
export function divisionLabel(d: WeightDivision): string {
  return `${d.label} (up to ${trimKg(d.maxKg)} kg)`;
}

export function trimKg(kg: number): string {
  return Number.isInteger(kg) ? String(kg) : kg.toFixed(1).replace(/\.0$/, "");
}

/** "Kids 2 · Heavy (up to 36 kg)" for the division column. */
export function composeLocalDivision(group: AgeGroup | null, division: WeightDivision | null): string {
  return [group?.label, division ? divisionLabel(division) : null].filter(Boolean).join(" · ");
}

/** Age in whole years on `onDate` (YYYY-MM-DD) for a birth date (YYYY-MM-DD). */
export function ageOnDate(birthDate: string, onDate: string): number | null {
  const b = parseYmd(birthDate);
  const o = parseYmd(onDate);
  if (!b || !o) return null;
  let age = o.y - b.y;
  if (o.m < b.m || (o.m === b.m && o.d < b.d)) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

/**
 * The athlete's possible ages on the event date. A full birth date gives one
 * number; a birth year alone gives two (the birthday may not have passed yet).
 * Without an event date, today's date is used.
 */
export function possibleAges(input: { birthDate?: string | null; birthYear?: number | null }, eventDate: string | null | undefined, today: Date = new Date()): { ages: number[]; approximate: boolean } {
  const on = eventDate && parseYmd(eventDate) ? eventDate : today.toISOString().slice(0, 10);
  if (input.birthDate) {
    const age = ageOnDate(input.birthDate, on);
    if (age !== null) return { ages: [age], approximate: false };
  }
  const year = input.birthYear ?? (input.birthDate ? parseYmd(input.birthDate)?.y ?? null : null);
  if (year && Number.isInteger(year)) {
    const y = Number(on.slice(0, 4));
    const a = y - year;
    return { ages: [a - 1, a].filter((v) => v >= 0), approximate: true };
  }
  return { ages: [], approximate: true };
}

export type FitWarning = { field: "age_group" | "weight"; message: string };

export type FitInput = {
  ages: number[];
  approximate: boolean;
  weightKg: number | null;
  ageGroup: AgeGroup | null;
  weightDivision: WeightDivision | null;
};

/** Age groups the athlete's age fits (any of their possible ages). */
export function ageGroupsFor(rules: DivisionRules, ages: number[]): AgeGroup[] {
  if (!ages.length) return rules.ageGroups;
  return rules.ageGroups.filter((g) => ages.some((a) => a >= g.minAge && a <= g.maxAge));
}

/** The lightest division whose maximum is at or above the weight ("up to" = maximum). */
export function divisionForWeight(group: AgeGroup, weightKg: number): WeightDivision | null {
  return group.divisions.find((d) => weightKg <= d.maxKg) ?? null;
}

/**
 * Warnings when the chosen age group / division do not match the athlete's
 * real age and weight. Empty when everything fits or nothing is known yet.
 */
export function checkFit(input: FitInput): FitWarning[] {
  const out: FitWarning[] = [];
  const { ages, approximate, weightKg, ageGroup, weightDivision } = input;
  if (ageGroup && ages.length && !ages.some((a) => a >= ageGroup.minAge && a <= ageGroup.maxAge)) {
    const shown = ages.length === 1 ? `${ages[0]}` : `${ages[0]}–${ages[ages.length - 1]}`;
    out.push({ field: "age_group", message: `Age ${shown}${approximate ? " (from birth year)" : ""} on the event date is outside ${ageGroup.label} (ages ${ageGroup.minAge}–${ageGroup.maxAge}).` });
  }
  if (ageGroup && weightDivision && weightKg !== null) {
    const fit = divisionForWeight(ageGroup, weightKg);
    if (weightKg > weightDivision.maxKg) {
      out.push({ field: "weight", message: `${trimKg(weightKg)} kg is over the ${weightDivision.label} limit (up to ${trimKg(weightDivision.maxKg)} kg).${fit ? ` It fits ${divisionLabel(fit)}.` : " It is above every division in this age group."}` });
    } else if (fit && fit.maxKg < weightDivision.maxKg) {
      const below = ageGroup.divisions.filter((d) => d.maxKg < weightDivision.maxKg).at(-1);
      out.push({ field: "weight", message: `${trimKg(weightKg)} kg fits ${divisionLabel(fit)}; ${weightDivision.label} is for over ${trimKg(below?.maxKg ?? fit.maxKg)} kg.` });
    }
  }
  return out;
}

function parseYmd(s: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s ?? "");
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return { y, m: mo, d };
}
