/**
 * Pure parsing for the owner-only pricing area: reference prices (what other
 * providers charge) and the job inputs of a quote. The actions file is
 * "use server", so validation lives here and is unit-tested directly.
 * Nothing here touches the network or the database.
 */
import { isBookingType } from "@/lib/bookings/state";
import type { BookingType, Json, PhotoPriceReferenceRow, PhotoQuoteRow, PriceConfidence, PriceMediaType, PriceRegion, PriceSourceType } from "@/lib/supabase/database.types";
import { isPlainObject, isValidCalendarDate } from "@/lib/validation";
import { isValidHttpUrl, trimOrNull } from "@/lib/utils";
import { isMediaScope, isVideoDeliverable, type VideoDeliverable } from "@/lib/catalog";
import { DEFAULT_COST_ASSUMPTIONS } from "./engine/cost-floor";
import type { RequestOverrides } from "./engine/extract";
import { COMPARABLE_SCOPES, isComparableScope, type ComparableScope, type CostAssumptions, type PriceBand } from "./engine/types";

export const PRICING_MAX = { provider: 120, source_url: 500, location: 120, notes: 1000, price: 1_000_000, hours: 24 * 14, athletes: 500, photos: 100_000, editing_hours: 1000, delivery_days: 365, travel_km: 5000, margin: 300, hourly: 100_000, text: 500, staffing: 50, seed_key: 120 } as const;

export const PRICE_SOURCE_TYPES = ["provider_site", "social_post", "search_index", "marketplace", "directory", "private_quote", "other"] as const satisfies readonly PriceSourceType[];
export const PRICE_SOURCE_TYPE_LABEL: Record<PriceSourceType, string> = { provider_site: "Provider's own page", social_post: "Social post", search_index: "Search-index snippet", marketplace: "Marketplace listing", directory: "Directory", private_quote: "Private quote", other: "Other" };
export const PRICE_CONFIDENCES = ["verified", "likely", "unverified"] as const satisfies readonly PriceConfidence[];
export const PRICE_CONFIDENCE_LABEL: Record<PriceConfidence, string> = { verified: "Verified", likely: "Likely", unverified: "Unverified" };
export const PRICE_REGIONS = ["qatar", "gcc", "other"] as const satisfies readonly PriceRegion[];
export const PRICE_REGION_LABEL: Record<PriceRegion, string> = { qatar: "Qatar", gcc: "GCC", other: "Other" };
export const PRICE_MEDIA_TYPES = ["photo", "video", "photo_video", "other"] as const satisfies readonly PriceMediaType[];
export const PRICE_MEDIA_TYPE_LABEL: Record<PriceMediaType, string> = { photo: "Photo", video: "Video", photo_video: "Photo + video", other: "Other" };
export { COMPARABLE_SCOPES };

function oneOf<T extends string>(list: readonly T[], v: unknown): v is T {
  return typeof v === "string" && (list as readonly string[]).includes(v);
}

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
  /** Observation columns (all optional on input; defaults are explicit). */
  observed_on: string;
  source_type: PriceSourceType;
  confidence: PriceConfidence;
  region: PriceRegion;
  media_type: PriceMediaType | null;
  duration_hours: number | null;
  staffing_count: number | null;
  athlete_count: number | null;
  deliverables: string | null;
  editing_revisions: string | null;
  usage_rights: string | null;
  travel_tax_notes: string | null;
  promotion_expires_on: string | null;
  excluded: boolean;
  excluded_reason: string | null;
  comparable_scope: ComparableScope | null;
  seed_key: string | null;
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

/** Today's calendar date (UTC) as YYYY-MM-DD; "not in the future" is judged on the calendar day. */
function ymd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

const REFERENCE_FORM_KEYS = ["provider", "source_url", "checked_on", "observed_on", "location", "service_type", "notes", "price_from", "price_to", "currency", "source_type", "confidence", "region", "media_type", "duration_hours", "staffing_count", "athlete_count", "deliverables", "editing_revisions", "usage_rights", "travel_tax_notes", "promotion_expires_on", "excluded", "excluded_reason", "comparable_scope", "seed_key", "includes_video", "includes_raw_files", "includes_travel_included", ...INCLUDE_NUMBER_KEYS.map((k) => `includes_${k}`)] as const;

export function parsePriceReferenceForm(fd: FormData, now: Date = new Date()): ParsedPriceReferenceForm {
  const raw: Record<string, unknown> = {};
  for (const key of REFERENCE_FORM_KEYS) {
    const v = fd.get(key);
    if (typeof v === "string") raw[key] = v;
  }
  return validatePriceReference(raw, now);
}

function rawString(v: unknown): string | null {
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

function rawNumber(v: unknown, max: number, options: { integer?: boolean } = {}): number | null | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 && v <= max && (!options.integer || Number.isInteger(v)) ? round2(v) : null;
  if (typeof v === "string") return optionalNumber(v.trim(), max, options);
  return null;
}

function rawBool(v: unknown): boolean {
  return v === true || v === "on" || v === "1" || v === "true" || v === "yes";
}

/**
 * Validates one reference record from any source: the owner's form
 * (strings), a pasted JSON/CSV import (strings or JSON values) or the seed
 * file. `includes` may come as a nested object or as `includes_*` keys.
 */
export function validatePriceReference(raw: Record<string, unknown>, now: Date = new Date()): ParsedPriceReferenceForm {
  const fieldErrors: Record<string, string> = {};
  const provider = rawString(raw.provider);
  const sourceUrl = rawString(raw.source_url);
  const checkedOn = rawString(raw.checked_on);
  const observedOn = rawString(raw.observed_on);
  const location = rawString(raw.location);
  const serviceType = rawString(raw.service_type);
  const notes = rawString(raw.notes);
  const today = ymd(now);

  if (!provider) fieldErrors.provider = "Who charges this price?";
  else if (provider.length > PRICING_MAX.provider) fieldErrors.provider = `Keep the provider name under ${PRICING_MAX.provider} characters.`;
  if (sourceUrl && (sourceUrl.length > PRICING_MAX.source_url || !isValidHttpUrl(sourceUrl))) fieldErrors.source_url = "Enter a full http(s) link, or leave it empty.";
  let checked_on = today;
  if (checkedOn) {
    if (!isValidCalendarDate(checkedOn)) fieldErrors.checked_on = "Enter a real date (YYYY-MM-DD).";
    else if (checkedOn > today) fieldErrors.checked_on = "The check date cannot be in the future.";
    else checked_on = checkedOn;
  }
  let observed_on = checked_on;
  if (observedOn) {
    if (!isValidCalendarDate(observedOn)) fieldErrors.observed_on = "Enter a real date (YYYY-MM-DD).";
    else if (observedOn > today) fieldErrors.observed_on = "The observation date cannot be in the future.";
    else observed_on = observedOn;
  }
  if (location && location.length > PRICING_MAX.location) fieldErrors.location = `Keep the location under ${PRICING_MAX.location} characters.`;
  if (!isBookingType(serviceType)) fieldErrors.service_type = "Choose a service type.";
  if (notes && notes.length > PRICING_MAX.notes) fieldErrors.notes = `Keep the notes under ${PRICING_MAX.notes} characters.`;

  const priceFrom = rawNumber(raw.price_from, PRICING_MAX.price);
  if (priceFrom === undefined) fieldErrors.price_from = "Enter the price (QAR).";
  else if (priceFrom === null) fieldErrors.price_from = "Enter an amount in QAR, 0 or more.";
  const priceTo = rawNumber(raw.price_to, PRICING_MAX.price);
  if (priceTo === null) fieldErrors.price_to = "Enter an amount in QAR, or leave it empty.";
  else if (priceTo !== undefined && typeof priceFrom === "number" && priceTo < priceFrom) fieldErrors.price_to = "The upper price cannot be below the lower price.";
  const currencyRaw = rawString(raw.currency);
  const currency = (currencyRaw ?? "QAR").toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) fieldErrors.currency = "Use a three-letter currency code.";

  // Scope: nested `includes` object or flat includes_* keys.
  const includes: PriceReferenceIncludes = {};
  const nested = isPlainObject(raw.includes) ? raw.includes : {};
  for (const key of INCLUDE_NUMBER_KEYS) {
    const max = key === "hours" ? PRICING_MAX.hours : key === "athletes" ? PRICING_MAX.athletes : key === "photos" ? PRICING_MAX.photos : key === "editing_hours" ? PRICING_MAX.editing_hours : PRICING_MAX.delivery_days;
    const integer = key === "athletes" || key === "photos" || key === "delivery_days";
    const n = rawNumber(raw[`includes_${key}`] ?? nested[key], max, { integer });
    if (n === null) fieldErrors[`includes_${key}`] = integer ? "Enter a whole number, 0 or more." : "Enter a number, 0 or more.";
    else if (n !== undefined) includes[key] = n;
  }
  // Video is three-way: the provider says yes, says no, or does not say.
  const video = raw.includes_video !== undefined ? rawString(raw.includes_video) : nested.video === true ? "yes" : nested.video === false ? "no" : null;
  if (video === "yes") includes.video = true;
  else if (video === "no") includes.video = false;
  else if (video !== null && video !== "unknown") fieldErrors.includes_video = "Choose yes, no or not stated.";
  if (rawBool(raw.includes_raw_files ?? nested.raw_files)) includes.raw_files = true;
  if (rawBool(raw.includes_travel_included ?? nested.travel_included)) includes.travel_included = true;

  // Observation columns ---------------------------------------------------------
  const sourceType = rawString(raw.source_type) ?? "other";
  if (!oneOf(PRICE_SOURCE_TYPES, sourceType)) fieldErrors.source_type = "Choose where the price was seen.";
  const confidence = rawString(raw.confidence) ?? "unverified";
  if (!oneOf(PRICE_CONFIDENCES, confidence)) fieldErrors.confidence = "Choose verified, likely or unverified.";
  const region = rawString(raw.region) ?? "qatar";
  if (!oneOf(PRICE_REGIONS, region)) fieldErrors.region = "Choose Qatar, GCC or other.";
  const mediaRaw = rawString(raw.media_type);
  let media_type: PriceMediaType | null = null;
  if (mediaRaw && mediaRaw !== "unknown") {
    if (oneOf(PRICE_MEDIA_TYPES, mediaRaw)) media_type = mediaRaw;
    else fieldErrors.media_type = "Choose photo, video, photo + video or other.";
  } else if (includes.video === true) media_type = "photo_video";
  else if (includes.video === false) media_type = "photo";
  const scopeRaw = rawString(raw.comparable_scope);
  let comparable_scope: ComparableScope | null = null;
  if (scopeRaw && scopeRaw !== "unknown") {
    if (isComparableScope(scopeRaw)) comparable_scope = scopeRaw;
    else fieldErrors.comparable_scope = "Choose a comparable scope.";
  }
  const duration = rawNumber(raw.duration_hours, PRICING_MAX.hours);
  if (duration === null) fieldErrors.duration_hours = "Enter a number of hours, 0 or more.";
  const duration_hours = duration ?? includes.hours ?? null;
  const staffing = rawNumber(raw.staffing_count, PRICING_MAX.staffing, { integer: true });
  if (staffing === null) fieldErrors.staffing_count = "Enter a whole number, 0 or more.";
  const athletesN = rawNumber(raw.athlete_count, PRICING_MAX.athletes, { integer: true });
  if (athletesN === null) fieldErrors.athlete_count = "Enter a whole number, 0 or more.";
  const athlete_count = athletesN ?? includes.athletes ?? null;
  const texts: Record<"deliverables" | "editing_revisions" | "usage_rights" | "travel_tax_notes" | "excluded_reason", string | null> = { deliverables: null, editing_revisions: null, usage_rights: null, travel_tax_notes: null, excluded_reason: null };
  for (const key of Object.keys(texts) as Array<keyof typeof texts>) {
    const v = rawString(raw[key]);
    if (v && v.length > PRICING_MAX.text) fieldErrors[key] = `Keep this under ${PRICING_MAX.text} characters.`;
    texts[key] = v;
  }
  const promo = rawString(raw.promotion_expires_on);
  let promotion_expires_on: string | null = null;
  if (promo) {
    if (!isValidCalendarDate(promo)) fieldErrors.promotion_expires_on = "Enter a real date (YYYY-MM-DD).";
    else promotion_expires_on = promo;
  }
  const excluded = rawBool(raw.excluded);
  if (excluded && !texts.excluded_reason) fieldErrors.excluded_reason = "Say why this observation is excluded.";
  const seedKey = rawString(raw.seed_key);
  if (seedKey && (seedKey.length > PRICING_MAX.seed_key || !/^[a-z0-9][a-z0-9._-]*$/i.test(seedKey))) fieldErrors.seed_key = "Use letters, digits, dots, dashes or underscores.";

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
      currency,
      includes,
      notes,
      observed_on,
      source_type: sourceType as PriceSourceType,
      confidence: confidence as PriceConfidence,
      region: region as PriceRegion,
      media_type,
      duration_hours,
      staffing_count: staffing ?? null,
      athlete_count,
      deliverables: texts.deliverables,
      editing_revisions: texts.editing_revisions,
      usage_rights: texts.usage_rights,
      travel_tax_notes: texts.travel_tax_notes,
      promotion_expires_on,
      excluded,
      excluded_reason: excluded ? texts.excluded_reason : null,
      comparable_scope,
      seed_key: seedKey,
    },
  };
}

/** A reference that must be re-checked before the engine may price with it. */
export function referenceNeedsReverification(ref: Pick<PhotoPriceReferenceRow, "confidence" | "source_type" | "observed_on" | "checked_on" | "promotion_expires_on">, now: Date = new Date(), staleAfterDays = 365): string | null {
  if (ref.confidence === "unverified" || ref.confidence === null) return "Unverified";
  if (ref.source_type === "search_index") return "Search-index evidence";
  const observed = ref.observed_on ?? ref.checked_on;
  const t = Date.parse(`${observed}T00:00:00Z`);
  if (Number.isFinite(t) && (now.getTime() - t) / 86_400_000 > staleAfterDays) return "Older than a year";
  if (ref.promotion_expires_on && ref.promotion_expires_on < ymd(now)) return "Promotion expired";
  return null;
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

// ---------------------------------------------------------------------------
// Assessment inputs (owner edits → new version)
// ---------------------------------------------------------------------------

export type ParsedAssessmentEdit = { fieldErrors: Record<string, string>; values: { overrides: RequestOverrides; costAssumptions: Partial<CostAssumptions>; marginPercent: Partial<PriceBand> } | null };

const LOCATION_KINDS = ["venue", "academy", "studio", "outdoor", "unknown"] as const;

/**
 * The owner's edits to an assessment's public-scope inputs, cost
 * assumptions and margins. Empty fields mean "keep what the engine had";
 * every number is bounded.
 */
export function parseAssessmentEditForm(fd: FormData): ParsedAssessmentEdit {
  const fieldErrors: Record<string, string> = {};
  const overrides: RequestOverrides = {};
  const costAssumptions: Partial<CostAssumptions> = {};
  const marginPercent: Partial<PriceBand> = {};
  const get = (k: string) => trimOrNull(fd.get(k));

  const media = get("media");
  if (media) {
    if (isMediaScope(media)) overrides.media = media;
    else fieldErrors.media = "Choose photo, video or both.";
  }
  const deliverables = fd.getAll("video_deliverables").filter((v): v is string => typeof v === "string");
  if (deliverables.length) {
    const valid = deliverables.filter(isVideoDeliverable) as VideoDeliverable[];
    if (valid.length !== deliverables.length) fieldErrors.video_deliverables = "Unknown video deliverable.";
    else overrides.videoDeliverables = valid;
  }
  const numbers: Array<{ form: string; key: keyof RequestOverrides; max: number; integer?: boolean }> = [
    { form: "hours_on_site", key: "hoursOnSite", max: 24 },
    { form: "days", key: "days", max: 30, integer: true },
    { form: "athlete_count", key: "athleteCount", max: 500, integer: true },
    { form: "simultaneous_mats", key: "simultaneousMats", max: 50, integer: true },
    { form: "expected_images", key: "expectedImages", max: 100_000, integer: true },
    { form: "deadline_days", key: "deadlineDays", max: 365, integer: true },
  ];
  for (const f of numbers) {
    const n = optionalNumber(get(f.form), f.max, { integer: f.integer });
    if (n === null) fieldErrors[f.form] = f.integer ? "Enter a whole number, 0 or more." : "Enter a number, 0 or more.";
    else if (n !== undefined) (overrides as Record<string, unknown>)[f.key] = n;
  }
  const loc = get("location_kind");
  if (loc) {
    if ((LOCATION_KINDS as readonly string[]).includes(loc)) overrides.locationKind = loc as RequestOverrides["locationKind"];
    else fieldErrors.location_kind = "Choose a location kind.";
  }
  for (const key of Object.keys(DEFAULT_COST_ASSUMPTIONS) as Array<keyof CostAssumptions>) {
    const n = optionalNumber(get(`cost_${key}`), key.endsWith("Percent") ? 100 : key === "shooterUtilisation" ? 1 : PRICING_MAX.price);
    if (n === null) fieldErrors[`cost_${key}`] = "Enter a number, 0 or more.";
    else if (n !== undefined) costAssumptions[key] = n;
  }
  for (const k of ["low", "target", "high"] as const) {
    const n = optionalNumber(get(`margin_${k}`), 90);
    if (n === null) fieldErrors[`margin_${k}`] = "Enter a margin between 0 and 90 percent.";
    else if (n !== undefined) marginPercent[k] = n;
  }
  if (marginPercent.low !== undefined && marginPercent.target !== undefined && marginPercent.low > marginPercent.target) fieldErrors.margin_low = "The low margin cannot exceed the target margin.";
  if (marginPercent.target !== undefined && marginPercent.high !== undefined && marginPercent.target > marginPercent.high) fieldErrors.margin_high = "The high margin cannot be below the target margin.";
  if (Object.keys(fieldErrors).length) return { fieldErrors, values: null };
  return { fieldErrors, values: { overrides, costAssumptions, marginPercent } };
}
