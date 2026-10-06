/**
 * Pure parsing for the owner-only pricing area: reference prices (what other
 * providers charge) and the job inputs of a quote. The actions file is
 * "use server", so validation lives here and is unit-tested directly.
 * Nothing here touches the network or the database.
 */
import { isBookingType } from "@/lib/bookings/state";
import type { BookingType, Json, PhotoPriceReferenceRow, PhotoQuoteRow } from "@/lib/supabase/database.types";
import { isPlainObject, isValidCalendarDate } from "@/lib/validation";
import { isValidHttpUrl, trimOrNull } from "@/lib/utils";

export const PRICING_MAX = { provider: 120, source_url: 500, location: 120, notes: 1000, price: 1_000_000, hours: 24 * 14, athletes: 500, photos: 100_000, editing_hours: 1000, delivery_days: 365, travel_km: 5000, margin: 300, hourly: 100_000 } as const;

export const DEFAULT_MARGIN_PERCENT = 30;

/** What a reference price covers. Every key optional: unknown is different from false. */
export type PriceReferenceIncludes = {
  hours?: number;
  athletes?: number;
  photos?: number;
  /** true = video included, false = photo only, absent = the provider does not say. */
  video?: boolean;
  editing_hours?: number;
  delivery_days?: number;
  raw_files?: boolean;
  travel_included?: boolean;
};

export type PriceReferenceValues = {
  provider: string;
  source_url: string | null;
  checked_on: string;
  location: string | null;
  service_type: BookingType;
  price_from: number;
  price_to: number | null;
  currency: string;
  includes: PriceReferenceIncludes;
  notes: string | null;
};

export type ParsedPriceReferenceForm = { fieldErrors: Record<string, string>; values: PriceReferenceValues | null };

const INCLUDE_NUMBER_KEYS = ["hours", "athletes", "photos", "editing_hours", "delivery_days"] as const;
const INCLUDE_BOOLEAN_KEYS = ["video", "raw_files", "travel_included"] as const;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Optional non-negative number (commas allowed). Returns undefined when absent, null when invalid. */
function optionalNumber(raw: string | null, max: number, options: { integer?: boolean } = {}): number | null | undefined {
  if (raw === null) return undefined;
  const n = Number(raw.replace(/,/g, ""));
  if (!Number.isFinite(n) || n < 0 || n > max) return null;
  if (options.integer && !Number.isInteger(n)) return null;
  return round2(n);
}

function checkbox(v: FormDataEntryValue | null): boolean {
  return v === "on" || v === "1" || v === "true";
}

/** Today's calendar date (UTC) as YYYY-MM-DD; "not in the future" is judged on the calendar day. */
function ymd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function parsePriceReferenceForm(fd: FormData, now: Date = new Date()): ParsedPriceReferenceForm {
  const fieldErrors: Record<string, string> = {};
  const provider = trimOrNull(fd.get("provider"));
  const sourceUrl = trimOrNull(fd.get("source_url"));
  const checkedOn = trimOrNull(fd.get("checked_on"));
  const location = trimOrNull(fd.get("location"));
  const serviceType = trimOrNull(fd.get("service_type"));
  const notes = trimOrNull(fd.get("notes"));

  if (!provider) fieldErrors.provider = "Who charges this price?";
  else if (provider.length > PRICING_MAX.provider) fieldErrors.provider = `Keep the provider name under ${PRICING_MAX.provider} characters.`;
  if (sourceUrl && (sourceUrl.length > PRICING_MAX.source_url || !isValidHttpUrl(sourceUrl))) fieldErrors.source_url = "Enter a full http(s) link, or leave it empty.";
  let checked_on = ymd(now);
  if (checkedOn) {
    if (!isValidCalendarDate(checkedOn)) fieldErrors.checked_on = "Enter a real date (YYYY-MM-DD).";
    else if (checkedOn > ymd(now)) fieldErrors.checked_on = "The check date cannot be in the future.";
    else checked_on = checkedOn;
  }
  if (location && location.length > PRICING_MAX.location) fieldErrors.location = `Keep the location under ${PRICING_MAX.location} characters.`;
  if (!isBookingType(serviceType)) fieldErrors.service_type = "Choose a service type.";
  if (notes && notes.length > PRICING_MAX.notes) fieldErrors.notes = `Keep the notes under ${PRICING_MAX.notes} characters.`;

  const priceFrom = optionalNumber(trimOrNull(fd.get("price_from")), PRICING_MAX.price);
  if (priceFrom === undefined) fieldErrors.price_from = "Enter the price (QAR).";
  else if (priceFrom === null) fieldErrors.price_from = "Enter an amount in QAR, 0 or more.";
  const priceTo = optionalNumber(trimOrNull(fd.get("price_to")), PRICING_MAX.price);
  if (priceTo === null) fieldErrors.price_to = "Enter an amount in QAR, or leave it empty.";
  else if (priceTo !== undefined && typeof priceFrom === "number" && priceTo < priceFrom) fieldErrors.price_to = "The upper price cannot be below the lower price.";

  const includes: PriceReferenceIncludes = {};
  for (const key of INCLUDE_NUMBER_KEYS) {
    const max = key === "hours" ? PRICING_MAX.hours : key === "athletes" ? PRICING_MAX.athletes : key === "photos" ? PRICING_MAX.photos : key === "editing_hours" ? PRICING_MAX.editing_hours : PRICING_MAX.delivery_days;
    const integer = key === "athletes" || key === "photos" || key === "delivery_days";
    const n = optionalNumber(trimOrNull(fd.get(`includes_${key}`)), max, { integer });
    if (n === null) fieldErrors[`includes_${key}`] = integer ? "Enter a whole number, 0 or more." : "Enter a number, 0 or more.";
    else if (n !== undefined) includes[key] = n;
  }
  // Video is three-way: the provider says yes, says no, or does not say.
  const video = trimOrNull(fd.get("includes_video"));
  if (video === "yes") includes.video = true;
  else if (video === "no") includes.video = false;
  else if (video !== null && video !== "unknown") fieldErrors.includes_video = "Choose yes, no or not stated.";
  if (checkbox(fd.get("includes_raw_files"))) includes.raw_files = true;
  if (checkbox(fd.get("includes_travel_included"))) includes.travel_included = true;

  if (Object.keys(fieldErrors).length) return { fieldErrors, values: null };
  return {
    fieldErrors,
    values: {
      provider: provider!,
      source_url: sourceUrl,
      checked_on,
      location,
      service_type: serviceType as BookingType,
      price_from: priceFrom as number,
      price_to: priceTo ?? null,
      currency: "QAR",
      includes,
      notes,
    },
  };
}

/** Safe read of photo_price_references.includes (unknown keys and bad types dropped). */
export function priceReferenceIncludes(row: Pick<PhotoPriceReferenceRow, "includes">): PriceReferenceIncludes {
  const raw = row.includes;
  if (!isPlainObject(raw)) return {};
  const out: PriceReferenceIncludes = {};
  for (const key of INCLUDE_NUMBER_KEYS) {
    const v = raw[key];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) out[key] = v;
  }
  for (const key of INCLUDE_BOOLEAN_KEYS) {
    const v = raw[key];
    if (typeof v === "boolean") out[key] = v;
  }
  return out;
}

export function includesSummary(inc: PriceReferenceIncludes): string {
  const parts: string[] = [];
  if (inc.hours !== undefined) parts.push(`${inc.hours} h`);
  if (inc.athletes !== undefined) parts.push(`${inc.athletes} athlete${inc.athletes === 1 ? "" : "s"}`);
  if (inc.photos !== undefined) parts.push(`${inc.photos} photos`);
  if (inc.video === true) parts.push("video");
  if (inc.video === false) parts.push("photo only");
  if (inc.editing_hours !== undefined) parts.push(`${inc.editing_hours} h editing`);
  if (inc.delivery_days !== undefined) parts.push(`${inc.delivery_days}-day delivery`);
  if (inc.raw_files) parts.push("RAW files");
  if (inc.travel_included) parts.push("travel included");
  return parts.join(" · ");
}

// ---------------------------------------------------------------------------
// Quote inputs
// ---------------------------------------------------------------------------

export type QuoteInputs = {
  service_type: BookingType;
  hours: number | null;
  athletes: number | null;
  photos_expected: number | null;
  video: boolean;
  editing_hours: number | null;
  travel_km: number | null;
  travel_cost_qr: number | null;
  video_partner_cost_qr: number | null;
  other_costs_qr: number | null;
  /** The owner's target margin on costs, in percent (0..300). */
  margin_percent: number;
  target_hourly_qr: number | null;
  notes: string | null;
};

export type ParsedQuoteInputs = { fieldErrors: Record<string, string>; values: QuoteInputs | null };

const QUOTE_NUMBER_FIELDS: Array<{ key: keyof QuoteInputs; max: number; integer?: boolean; label: string }> = [
  { key: "hours", max: PRICING_MAX.hours, label: "hours" },
  { key: "athletes", max: PRICING_MAX.athletes, integer: true, label: "athletes" },
  { key: "photos_expected", max: PRICING_MAX.photos, integer: true, label: "photos" },
  { key: "editing_hours", max: PRICING_MAX.editing_hours, label: "editing hours" },
  { key: "travel_km", max: PRICING_MAX.travel_km, label: "distance" },
  { key: "travel_cost_qr", max: PRICING_MAX.price, label: "travel cost" },
  { key: "video_partner_cost_qr", max: PRICING_MAX.price, label: "video partner cost" },
  { key: "other_costs_qr", max: PRICING_MAX.price, label: "other costs" },
  { key: "target_hourly_qr", max: PRICING_MAX.hourly, label: "hourly rate" },
];

/**
 * Validates a plain object of raw inputs (strings from a form, or numbers /
 * booleans from JSON). Both the form action and the stored-JSON reader use
 * this, so a quote row written by anything else is still checked on read.
 */
export function validateQuoteInputs(raw: Record<string, unknown>): ParsedQuoteInputs {
  const fieldErrors: Record<string, string> = {};
  const str = (v: unknown): string | null => (typeof v === "string" ? v.trim() || null : typeof v === "number" ? String(v) : null);
  const serviceType = str(raw.service_type);
  if (!isBookingType(serviceType)) fieldErrors.service_type = "Choose a service type.";

  const numbers: Partial<Record<keyof QuoteInputs, number | null>> = {};
  for (const f of QUOTE_NUMBER_FIELDS) {
    const v = raw[f.key];
    if (v === undefined || v === null || v === "") {
      numbers[f.key] = null;
      continue;
    }
    const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/,/g, "")) : NaN;
    if (!Number.isFinite(n) || n < 0 || n > f.max || (f.integer && !Number.isInteger(n))) fieldErrors[f.key] = f.integer ? `Enter a whole number of ${f.label}, 0 or more.` : `Enter the ${f.label} as a number, 0 or more.`;
    else numbers[f.key] = round2(n);
  }

  let margin = DEFAULT_MARGIN_PERCENT;
  const marginRaw = raw.margin_percent;
  if (marginRaw !== undefined && marginRaw !== null && marginRaw !== "") {
    const n = typeof marginRaw === "number" ? marginRaw : typeof marginRaw === "string" ? Number(marginRaw) : NaN;
    if (!Number.isFinite(n) || n < 0 || n > PRICING_MAX.margin) fieldErrors.margin_percent = `Enter a margin between 0 and ${PRICING_MAX.margin} percent.`;
    else margin = round2(n);
  }

  const videoRaw = raw.video;
  const video = videoRaw === true || videoRaw === "on" || videoRaw === "1" || videoRaw === "true";
  const notes = str(raw.notes);
  if (notes && notes.length > PRICING_MAX.notes) fieldErrors.notes = `Keep the notes under ${PRICING_MAX.notes} characters.`;

  if (Object.keys(fieldErrors).length) return { fieldErrors, values: null };
  return {
    fieldErrors,
    values: {
      service_type: serviceType as BookingType,
      hours: numbers.hours ?? null,
      athletes: numbers.athletes ?? null,
      photos_expected: numbers.photos_expected ?? null,
      video,
      editing_hours: numbers.editing_hours ?? null,
      travel_km: numbers.travel_km ?? null,
      travel_cost_qr: numbers.travel_cost_qr ?? null,
      video_partner_cost_qr: numbers.video_partner_cost_qr ?? null,
      other_costs_qr: numbers.other_costs_qr ?? null,
      margin_percent: margin,
      target_hourly_qr: numbers.target_hourly_qr ?? null,
      notes,
    },
  };
}

export function parseQuoteInputs(fd: FormData): ParsedQuoteInputs {
  const raw: Record<string, unknown> = {};
  for (const key of ["service_type", "hours", "athletes", "photos_expected", "video", "editing_hours", "travel_km", "travel_cost_qr", "video_partner_cost_qr", "other_costs_qr", "margin_percent", "target_hourly_qr", "notes"]) {
    const v = fd.get(key);
    if (typeof v === "string") raw[key] = v;
  }
  return validateQuoteInputs(raw);
}

/** Reads photo_quotes.inputs back; null when the stored JSON is not a valid set of inputs. */
export function quoteInputsFromJson(value: Json | Pick<PhotoQuoteRow, "inputs">): QuoteInputs | null {
  const raw = value && typeof value === "object" && !Array.isArray(value) && "inputs" in value ? (value as Pick<PhotoQuoteRow, "inputs">).inputs : value;
  if (!isPlainObject(raw)) return null;
  const parsed = validateQuoteInputs(raw);
  return parsed.values;
}

/** Amount the owner chose when applying a quote: a positive QAR amount within the schema's range. */
export function parseChosenAmount(raw: unknown): { ok: true; amount: number } | { ok: false; error: string } {
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw.replace(/,/g, "")) : NaN;
  if (!Number.isFinite(n) || n <= 0) return { ok: false, error: "Enter an amount above 0 QAR." };
  if (n > PRICING_MAX.price) return { ok: false, error: `The amount must be ${PRICING_MAX.price.toLocaleString("en-QA")} QAR or less.` };
  return { ok: true, amount: round2(n) };
}
