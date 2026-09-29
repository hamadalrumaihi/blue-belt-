/**
 * AJP division rules for the Qatar National Jiu-Jitsu Championship 2026,
 * as published by the AJP Technical Commission (belt/age divisions per
 * gender and weight classes per age group). Used by the client form so the
 * photographer picks from lists instead of typing.
 */

export type Gender = "Male" | "Female";

export type Belt = "White" | "Grey" | "Yellow" | "Orange" | "Green" | "Blue" | "Purple" | "Brown" | "Black";

export type WeightGroup = "kids1" | "kids2" | "kids3" | "infant" | "junior" | "teen" | "youth" | "adult";

export type BeltRule = { belt: Belt; /** Latest eligible birth year (inclusive). */ maxYear: number };

export type AgeDivision = {
  id: string;
  label: string;
  /** Earliest eligible birth year (inclusive), undefined = no lower bound. */
  minYear?: number;
  /** Latest eligible birth year (inclusive). */
  maxYear: number;
  /** Age range label from the AJP table. */
  ages: string;
  genders: Gender[];
  belts: BeltRule[];
  weightGroup: WeightGroup;
};

const KIDS_BELTS = (maxYear: number, belts: Belt[]): BeltRule[] => belts.map((belt) => ({ belt, maxYear }));

export const AGE_DIVISIONS: AgeDivision[] = [
  { id: "kids1", label: "Kids 1", minYear: 2021, maxYear: 2022, ages: "4–5", genders: ["Male", "Female"], belts: KIDS_BELTS(2022, ["White", "Grey"]), weightGroup: "kids1" },
  { id: "kids2", label: "Kids 2", minYear: 2019, maxYear: 2020, ages: "6–7", genders: ["Male", "Female"], belts: KIDS_BELTS(2020, ["White", "Grey", "Yellow"]), weightGroup: "kids2" },
  { id: "kids3", label: "Kids 3", minYear: 2017, maxYear: 2018, ages: "8–9", genders: ["Male", "Female"], belts: KIDS_BELTS(2018, ["White", "Grey", "Yellow"]), weightGroup: "kids3" },
  { id: "infant", label: "Infant", minYear: 2015, maxYear: 2016, ages: "10–11", genders: ["Male", "Female"], belts: KIDS_BELTS(2016, ["White", "Grey", "Yellow", "Orange"]), weightGroup: "infant" },
  { id: "junior", label: "Junior", minYear: 2013, maxYear: 2014, ages: "12–13", genders: ["Male", "Female"], belts: KIDS_BELTS(2014, ["White", "Grey", "Yellow", "Orange", "Green"]), weightGroup: "junior" },
  { id: "teen", label: "Teen", minYear: 2011, maxYear: 2012, ages: "14–15", genders: ["Male", "Female"], belts: KIDS_BELTS(2012, ["White", "Grey", "Yellow", "Orange", "Green"]), weightGroup: "teen" },
  { id: "youth", label: "Youth", minYear: 2009, maxYear: 2010, ages: "16–17", genders: ["Male", "Female"], belts: KIDS_BELTS(2010, ["White", "Blue", "Purple"]), weightGroup: "youth" },
  { id: "amateur", label: "Amateur", maxYear: 2008, ages: "18+", genders: ["Male", "Female"], belts: KIDS_BELTS(2008, ["White", "Blue"]), weightGroup: "adult" },
  {
    id: "professional",
    label: "Professional",
    maxYear: 2010,
    ages: "16+ (purple) / 18+ (brown, black)",
    genders: ["Male", "Female"],
    belts: [{ belt: "Purple", maxYear: 2010 }, { belt: "Brown", maxYear: 2008 }, { belt: "Black", maxYear: 2008 }],
    weightGroup: "adult",
  },
  { id: "master1", label: "Master 1", maxYear: 1996, ages: "30+", genders: ["Male", "Female"], belts: KIDS_BELTS(1996, ["White", "Blue", "Purple", "Brown", "Black"]), weightGroup: "adult" },
  { id: "master2", label: "Master 2", maxYear: 1990, ages: "36+", genders: ["Male"], belts: KIDS_BELTS(1990, ["White", "Blue", "Purple", "Brown", "Black"]), weightGroup: "adult" },
  { id: "master3", label: "Master 3", maxYear: 1985, ages: "41+", genders: ["Male"], belts: KIDS_BELTS(1985, ["White", "Blue", "Purple", "Brown", "Black"]), weightGroup: "adult" },
  { id: "master4", label: "Master 4", maxYear: 1980, ages: "46+", genders: ["Male"], belts: KIDS_BELTS(1980, ["White", "Blue", "Purple", "Brown", "Black"]), weightGroup: "adult" },
];

export const WEIGHT_NAMES = [
  "Rooster",
  "Light Feather",
  "Feather",
  "Light",
  "Welter",
  "Middle",
  "Light Heavy",
  "Heavy",
  "Super Heavy",
] as const;

type Kg = number | null;

/** Upper limits in kg per weight name, in WEIGHT_NAMES order. null = class not offered. */
const WEIGHT_TABLE: Record<Gender, Record<WeightGroup, Kg[]>> = {
  Male: {
    teen: [38, 42, 46, 50, 56, 62, 67, 72, 84],
    junior: [34, 37, 41, 45, 50, 55, 60, 66, 78],
    infant: [24, 27, 30, 34, 38, 42, 46, 50, 62],
    kids3: [21, 24, 27, 30, 34, 38, 42, 50, null],
    kids2: [18, 20, 23, 26, 30, 34, 38, 46, null],
    kids1: [16, 18, 21, 24, 28, 32, 36, 44, null],
    youth: [46, 50, 55, 60, 66, 73, 81, 94, null],
    adult: [null, 56, 62, 69, 77, 85, 94, null, 120],
  },
  Female: {
    teen: [36, 40, 44, 48, 52, 57, 63, 68, 80],
    junior: [32, 36, 40, 44, 48, 52, 57, 63, 75],
    infant: [22, 25, 28, 32, 36, 40, 44, 48, 60],
    kids3: [20, 22, 25, 28, 32, 36, 40, 48, null],
    kids2: [17, 19, 22, 25, 29, 33, 37, 44, null],
    kids1: [16, 18, 21, 24, 28, 32, 36, 44, null],
    youth: [40, 44, 48, 52, 57, 63, 70, 82, null],
    adult: [49, 55, null, 62, null, 70, null, 95, null],
  },
};

export type WeightClass = { name: (typeof WEIGHT_NAMES)[number]; maxKg: number; /** Stored value, e.g. "-77kg Welter". */ value: string };

export function divisionsFor(gender: Gender | null | undefined): AgeDivision[] {
  if (!gender) return AGE_DIVISIONS;
  return AGE_DIVISIONS.filter((d) => d.genders.includes(gender));
}

export function findDivision(id: string | null | undefined): AgeDivision | null {
  return AGE_DIVISIONS.find((d) => d.id === id || d.label === id) ?? null;
}

/** Belts allowed in a division; narrowed by birth year when known. */
export function beltsFor(division: AgeDivision | null, birthYear?: number | null): Belt[] {
  if (!division) return ["White", "Grey", "Yellow", "Orange", "Green", "Blue", "Purple", "Brown", "Black"];
  return division.belts.filter((r) => !birthYear || birthYear <= r.maxYear).map((r) => r.belt);
}

export function weightClassesFor(gender: Gender | null | undefined, division: AgeDivision | null): WeightClass[] {
  if (!gender || !division) return [];
  const limits = WEIGHT_TABLE[gender][division.weightGroup];
  return WEIGHT_NAMES.flatMap((name, i) => {
    const kg = limits[i];
    return kg === null ? [] : [{ name, maxKg: kg, value: `-${kg}kg ${name}` }];
  });
}

/** True when an athlete with this birth year may enter the division. */
export function eligible(division: AgeDivision, birthYear: number): boolean {
  if (birthYear > division.maxYear) return false;
  if (division.minYear !== undefined && birthYear < division.minYear) return false;
  return true;
}

/**
 * Suggests the default division for a birth year: the kids/youth band that
 * contains it, else Amateur for adults. Older athletes may also choose a
 * Master division; `eligibleDivisions` lists every option.
 */
export function suggestDivision(birthYear: number | null | undefined, gender: Gender | null | undefined): AgeDivision | null {
  if (!birthYear || !Number.isFinite(birthYear)) return null;
  const options = divisionsFor(gender).filter((d) => eligible(d, birthYear));
  const banded = options.find((d) => d.minYear !== undefined);
  return banded ?? options.find((d) => d.id === "amateur") ?? options[0] ?? null;
}

export function eligibleDivisions(birthYear: number | null | undefined, gender: Gender | null | undefined): AgeDivision[] {
  const all = divisionsFor(gender);
  if (!birthYear || !Number.isFinite(birthYear)) return all;
  return all.filter((d) => eligible(d, birthYear));
}

/** Human summary such as "Amateur / Male / Blue / -77kg Welter". */
export function composeDivision(parts: { division?: string | null; gender?: string | null; belt?: string | null; weight?: string | null }): string {
  return [parts.division, parts.gender, parts.belt, parts.weight].filter((p) => p && p.trim()).join(" / ");
}
