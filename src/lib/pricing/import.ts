/**
 * Evidence import: a pasted JSON array (or `{ "references": [...] }`) or a
 * CSV with a header row → validated reference records, one result per row
 * with its own field errors. Pure; the action decides what to insert.
 * Idempotency is by `seed_key` (unique per owner): a record whose seed_key
 * already exists is skipped, never overwritten.
 */
import { isPlainObject } from "@/lib/validation";
import { validatePriceReference, type PriceReferenceValues } from "./form";

export type ImportRecord = { index: number; values: PriceReferenceValues | null; fieldErrors: Record<string, string>; label: string };
export type ParsedImport = { format: "json" | "csv"; records: ImportRecord[]; error: string | null };

export const IMPORT_MAX_RECORDS = 500;

/** Minimal RFC 4180 reader: quoted fields, doubled quotes, CRLF or LF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v.trim() !== ""));
}

function csvRecords(text: string): Record<string, unknown>[] {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_"));
  return rows.slice(1).map((r) => {
    const rec: Record<string, unknown> = {};
    header.forEach((h, i) => {
      const v = (r[i] ?? "").trim();
      if (v !== "") rec[h] = v;
    });
    return rec;
  });
}

function jsonRecords(text: string): Record<string, unknown>[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const list = Array.isArray(parsed) ? parsed : isPlainObject(parsed) && Array.isArray(parsed.references) ? parsed.references : null;
  if (!list) return null;
  return list.filter(isPlainObject);
}

export function parseReferenceImport(text: string, now: Date = new Date()): ParsedImport {
  const trimmed = text.trim();
  if (!trimmed) return { format: "json", records: [], error: "Paste JSON or CSV first." };
  const looksJson = trimmed.startsWith("[") || trimmed.startsWith("{");
  const raws = looksJson ? jsonRecords(trimmed) : csvRecords(trimmed);
  if (!raws) return { format: "json", records: [], error: "That is not a JSON array of references (or an object with a \"references\" array)." };
  if (raws.length === 0) return { format: looksJson ? "json" : "csv", records: [], error: looksJson ? "The JSON holds no records." : "The CSV needs a header row and at least one data row." };
  if (raws.length > IMPORT_MAX_RECORDS) return { format: looksJson ? "json" : "csv", records: [], error: `At most ${IMPORT_MAX_RECORDS} records per import.` };
  const records = raws.map((raw, index) => {
    const { values, fieldErrors } = validatePriceReference(raw, now);
    const label = typeof raw.provider === "string" && raw.provider.trim() ? raw.provider.trim() : `Row ${index + 1}`;
    return { index, values, fieldErrors, label };
  });
  return { format: looksJson ? "json" : "csv", records, error: null };
}

export const IMPORT_CSV_HEADER = "seed_key,provider,source_url,observed_on,location,region,service_type,comparable_scope,media_type,price_from,price_to,currency,duration_hours,includes_hours,includes_photos,includes_athletes,includes_video,deliverables,staffing_count,athlete_count,usage_rights,source_type,confidence,excluded,excluded_reason,notes";
