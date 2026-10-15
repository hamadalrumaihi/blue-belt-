import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validatePriceReference, type PriceReferenceValues } from "@/lib/pricing/form";

export const SEED_NOW = new Date("2026-10-15T09:00:00.000Z");

/** The seeded evidence as reference rows, validated through the same parser the import uses. */
export type SeedRow = PriceReferenceValues & { id: string; superseded_by: null };

export function seedRows(now: Date = SEED_NOW): SeedRow[] {
  const doc = JSON.parse(readFileSync(join(__dirname, "..", "scripts/pricing/seed-references.json"), "utf8")) as { references: Record<string, unknown>[] };
  return doc.references.map((raw, i) => {
    const { values, fieldErrors } = validatePriceReference(raw, now);
    if (!values) throw new Error(`seed ${raw.seed_key}: ${JSON.stringify(fieldErrors)}`);
    return { id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`, superseded_by: null, ...values };
  });
}
