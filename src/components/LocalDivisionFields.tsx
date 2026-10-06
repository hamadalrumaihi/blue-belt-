"use client";

import { useMemo, useState } from "react";
import {
  ageGroupsFor,
  checkFit,
  composeLocalDivision,
  divisionForWeight,
  divisionLabel,
  findAgeGroup,
  findWeightDivision,
  possibleAges,
  trimKg,
  type DivisionRules,
} from "@/lib/local-divisions";
import { cn } from "@/lib/utils";
import { AlertIcon } from "./icons";
import { FormField } from "./FormField";

type Initial = {
  birth_date?: string | null;
  birth_year?: number | null;
  weight_kg?: number | null;
  age_category?: string | null;
  weight?: string | null;
  division?: string | null;
};

type Props = { rules: DivisionRules; eventDate: string | null; eventName?: string; initial?: Initial | null };

/**
 * Division fields for a local competition: real birth date (or year) and real
 * weight in kg, then the event's own age group and weight division. Mismatches
 * are warned about, never blocked — the owner decides. Posts birth_date,
 * birth_year, weight_kg, age_category (group label), weight (division label)
 * and division (both, for the cards).
 */
export function LocalDivisionFields({ rules, eventDate, eventName, initial }: Props) {
  const [birthDate, setBirthDate] = useState(initial?.birth_date ?? "");
  const [birthYear, setBirthYear] = useState(initial?.birth_year ? String(initial.birth_year) : "");
  const [weightKg, setWeightKg] = useState(initial?.weight_kg != null ? trimKg(Number(initial.weight_kg)) : "");
  const [groupId, setGroupId] = useState(findAgeGroup(rules, initial?.age_category)?.id ?? "");
  const [divisionName, setDivisionName] = useState(findWeightDivision(findAgeGroup(rules, initial?.age_category), initial?.weight)?.label ?? "");

  const kg = weightKg.trim() ? Number(weightKg) : null;
  const weight = kg !== null && Number.isFinite(kg) && kg > 0 ? kg : null;
  const year = birthYear.length === 4 ? Number(birthYear) : null;
  const ages = useMemo(() => possibleAges({ birthDate: birthDate || null, birthYear: year }, eventDate), [birthDate, year, eventDate]);
  const group = findAgeGroup(rules, groupId);
  const division = findWeightDivision(group, divisionName);
  const fitting = useMemo(() => new Set(ageGroupsFor(rules, ages.ages).map((g) => g.id)), [rules, ages.ages]);
  const suggested = group && weight !== null ? divisionForWeight(group, weight) : null;
  const warnings = checkFit({ ...ages, weightKg: weight, ageGroup: group, weightDivision: division });

  function onGroup(id: string) {
    setGroupId(id);
    const g = findAgeGroup(rules, id);
    const next = g && weight !== null ? divisionForWeight(g, weight) : null;
    setDivisionName(next?.label ?? (g && findWeightDivision(g, divisionName) ? divisionName : ""));
  }

  function onWeight(value: string) {
    const clean = value.replace(/[^\d.]/g, "").slice(0, 6);
    setWeightKg(clean);
    const w = Number(clean);
    if (group && clean && Number.isFinite(w) && w > 0) {
      const fit = divisionForWeight(group, w);
      if (fit) setDivisionName(fit.label);
    }
  }

  function onBirthDate(value: string) {
    setBirthDate(value);
    const found = possibleAges({ birthDate: value || null, birthYear: year }, eventDate);
    const fits = ageGroupsFor(rules, found.ages);
    if (fits.length === 1 && (!group || !fits.some((g) => g.id === group.id))) onGroup(fits[0].id);
  }

  function onBirthYear(value: string) {
    const digits = value.replace(/\D/g, "").slice(0, 4);
    setBirthYear(digits);
    if (digits.length === 4 && !birthDate) {
      const fits = ageGroupsFor(rules, possibleAges({ birthYear: Number(digits) }, eventDate).ages);
      if (fits.length === 1 && (!group || !fits.some((g) => g.id === group.id))) onGroup(fits[0].id);
    }
  }

  const ageText = ages.ages.length === 0 ? null : ages.ages.length === 1 ? `Age ${ages.ages[0]}` : `Age ${ages.ages[0]}–${ages.ages[ages.ages.length - 1]} (from birth year)`;

  return (
    <div className="space-y-5">
      <input type="hidden" name="division" value={composeLocalDivision(group, division)} />
      <input type="hidden" name="age_category" value={group?.label ?? ""} />
      <input type="hidden" name="weight" value={division ? divisionLabel(division) : ""} />
      <div className="grid gap-5 sm:grid-cols-2">
        <FormField label="Birth date" htmlFor="birth_date" hint={ageText ? `${ageText} on ${eventDate ? "the event date" : "today"}${eventName ? ` · ${eventName}` : ""}` : "Used to count the age on the event date"}>
          <input id="birth_date" name="birth_date" type="date" className="input" value={birthDate} onChange={(e) => onBirthDate(e.target.value)} max="2100-12-31" />
        </FormField>
        <FormField label="…or birth year" htmlFor="birth_year" hint="If the exact date is not known">
          <input id="birth_year" name="birth_year" inputMode="numeric" pattern="[0-9]*" className="input" value={birthYear} onChange={(e) => onBirthYear(e.target.value)} placeholder="2019" autoComplete="off" />
        </FormField>
        <FormField label="Weight (kg)" htmlFor="weight_kg" hint={suggested ? `Fits ${divisionLabel(suggested)}` : "Actual weight; divisions are “up to” limits"}>
          <input id="weight_kg" name="weight_kg" inputMode="decimal" className="input" value={weightKg} onChange={(e) => onWeight(e.target.value)} placeholder="36" autoComplete="off" />
        </FormField>
        <FormField label="Age group" htmlFor="age_group" hint={group ? `Ages ${group.minAge}–${group.maxAge}` : "This competition’s own groups"}>
          <select id="age_group" className="input" value={groupId} onChange={(e) => onGroup(e.target.value)}>
            <option value="">—</option>
            {rules.ageGroups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.label} · ages {g.minAge}–{g.maxAge}{ages.ages.length ? (fitting.has(g.id) ? " · fits" : " · does not fit") : ""}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Weight division" htmlFor="weight_division" hint={!group ? "Choose an age group first" : undefined} className="sm:col-span-2">
          <select id="weight_division" className="input" value={divisionName} onChange={(e) => setDivisionName(e.target.value)} disabled={!group}>
            <option value="">—</option>
            {group?.divisions.map((d) => (
              <option key={d.label} value={d.label}>
                {divisionLabel(d)}{suggested?.label === d.label ? " · fits" : ""}
              </option>
            ))}
          </select>
        </FormField>
      </div>
      <div role="status" aria-live="polite" className={cn(warnings.length === 0 && "sr-only")}>
        {warnings.map((w) => (
          <p key={w.field + w.message} className="mt-1 flex gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
            <AlertIcon size={16} className="mt-px shrink-0" aria-hidden />
            <span>{w.message} You can keep this choice or change it.</span>
          </p>
        ))}
      </div>
    </div>
  );
}
