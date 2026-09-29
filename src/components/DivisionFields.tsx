"use client";

import { useMemo, useState } from "react";
import {
  beltsFor,
  composeDivision,
  eligibleDivisions,
  findDivision,
  suggestDivision,
  weightClassesFor,
  type Gender,
} from "@/lib/ajp-divisions";
import { FormField } from "./FormField";

type Initial = {
  gender?: string | null;
  age_category?: string | null;
  belt?: string | null;
  weight?: string | null;
  division?: string | null;
};

const CURRENT_YEAR = new Date().getFullYear();

/**
 * Gender → age division → belt → weight, driven by the AJP Qatar National
 * 2026 tables. Every list narrows as the previous choice is made; a birth
 * year (not stored) pre-selects the age division. Values post as the plain
 * text columns gender / age_category / belt / weight / division.
 */
export function DivisionFields({ initial }: { initial?: Initial | null }) {
  const [gender, setGender] = useState<Gender | "">(initial?.gender === "Male" || initial?.gender === "Female" ? initial.gender : "");
  const [birthYear, setBirthYear] = useState<string>("");
  const [divisionId, setDivisionId] = useState<string>(findDivision(initial?.age_category)?.id ?? "");
  const [belt, setBelt] = useState<string>(initial?.belt ?? "");
  const [weight, setWeight] = useState<string>(initial?.weight ?? "");
  const [division, setDivision] = useState<string>(initial?.division ?? "");
  const [divisionTouched, setDivisionTouched] = useState<boolean>(Boolean(initial?.division));

  const year = birthYear.length === 4 ? Number(birthYear) : null;
  const ageDivision = findDivision(divisionId);
  const divisions = useMemo(() => eligibleDivisions(year, gender || null), [year, gender]);
  const belts = useMemo(() => beltsFor(ageDivision, year), [ageDivision, year]);
  const weights = useMemo(() => weightClassesFor(gender || null, ageDivision), [gender, ageDivision]);

  const summary = composeDivision({ division: ageDivision?.label, gender: gender || null, belt, weight });
  const divisionValue = divisionTouched ? division : summary;

  function onGender(next: Gender | "") {
    setGender(next);
    if (next && ageDivision && !ageDivision.genders.includes(next)) setDivisionId("");
    setWeight("");
  }

  function onBirthYear(value: string) {
    const digits = value.replace(/\D/g, "").slice(0, 4);
    setBirthYear(digits);
    if (digits.length === 4) {
      const suggested = suggestDivision(Number(digits), gender || null);
      if (suggested) {
        setDivisionId(suggested.id);
        setWeight("");
        if (belt && !beltsFor(suggested, Number(digits)).includes(belt as never)) setBelt("");
      }
    }
  }

  function onDivision(id: string) {
    setDivisionId(id);
    const d = findDivision(id);
    if (belt && d && !beltsFor(d, year).includes(belt as never)) setBelt("");
    setWeight("");
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <FormField label="Gender" htmlFor="gender">
          <select id="gender" name="gender" className="input" value={gender} onChange={(e) => onGender(e.target.value as Gender | "")}>
            <option value="">—</option>
            <option value="Male">Male</option>
            <option value="Female">Female</option>
          </select>
        </FormField>
        <FormField label="Birth year" htmlFor="birth_year" hint="Optional helper: picks the AJP age division. Not stored.">
          <input id="birth_year" inputMode="numeric" pattern="[0-9]*" className="input" value={birthYear} onChange={(e) => onBirthYear(e.target.value)} placeholder={String(CURRENT_YEAR - 25)} autoComplete="off" />
        </FormField>
        <FormField label="Age division" htmlFor="age_category" hint={ageDivision ? `Ages ${ageDivision.ages} · born ${ageDivision.minYear ? `${ageDivision.minYear}–${ageDivision.maxYear}` : `${ageDivision.maxYear} or before`}` : "AJP Qatar National 2026 divisions"}>
          <select id="age_category" name="age_category" className="input" value={ageDivision?.label ?? ""} onChange={(e) => onDivision(findDivision(e.target.value)?.id ?? "")}>
            <option value="">—</option>
            {divisions.map((d) => (
              <option key={d.id} value={d.label}>{d.label}{d.genders.length === 1 ? " (men)" : ""}</option>
            ))}
          </select>
        </FormField>
        <FormField label="Belt" htmlFor="belt" hint={ageDivision?.id === "professional" ? "Purple: born 2010 or before · Brown/Black: 2008 or before" : undefined}>
          <select id="belt" name="belt" className="input" value={belt} onChange={(e) => setBelt(e.target.value)}>
            <option value="">—</option>
            {belts.map((b) => <option key={b} value={b}>{b}</option>)}
            {belt && !belts.includes(belt as never) && <option value={belt}>{belt}</option>}
          </select>
        </FormField>
        <FormField label="Weight class" htmlFor="weight" hint={!gender || !ageDivision ? "Choose gender and age division first" : undefined}>
          <select id="weight" name="weight" className="input" value={weight} onChange={(e) => setWeight(e.target.value)} disabled={!weights.length && !weight}>
            <option value="">—</option>
            {weights.map((w) => <option key={w.value} value={w.value}>{w.name} · −{w.maxKg} kg</option>)}
            {weight && !weights.some((w) => w.value === weight) && <option value={weight}>{weight}</option>}
          </select>
        </FormField>
        <FormField label="Division (as shown on the bracket)" htmlFor="division" hint={divisionTouched ? "Custom text" : "Auto-filled from the choices above; edit to override"}>
          <input
            id="division"
            name="division"
            className="input"
            value={divisionValue}
            onChange={(e) => { setDivision(e.target.value); setDivisionTouched(true); }}
            placeholder="Amateur / Male / Blue / -77kg Welter"
          />
        </FormField>
      </div>
    </div>
  );
}
