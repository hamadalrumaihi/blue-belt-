/**
 * Quote suggestion from the owner's reference prices. Pure and deterministic:
 * no I/O, `now` is injected. The result is a breakdown the owner reads and
 * edits; nothing here is ever shown to a customer.
 *
 * How it works
 *   1. Keep the references that are comparable: same service type, priced in
 *      QAR, and either the same video scope or no video information.
 *   2. Normalise each one to the job's size (per hour when both sides list
 *      hours, per athlete when both list athletes, otherwise flat).
 *   3. Baseline = median of the normalised low and high prices.
 *   4. Add the job's own costs (editing, travel, video partner, other) plus
 *      the owner's margin on those costs.
 *   5. Confidence is low with fewer than two comparable references or when
 *      the scope differs on video or athlete count; the UI then asks for an
 *      owner review.
 */
import { BOOKING_TYPE_LABEL, formatQr } from "@/lib/bookings/state";
import type { PhotoPriceReferenceRow } from "@/lib/supabase/database.types";
import { priceReferenceIncludes, type QuoteInputs } from "./form";

/** Travel costed per kilometre when the owner gives a distance but no cost. Shown in the steps. */
export const TRAVEL_QR_PER_KM = 1.5;
/** A reference older than this is flagged as stale. */
export const STALE_AFTER_DAYS = 365;

export type BaselineMethod = "per_hour" | "per_athlete" | "flat";

export type ComparableReference = {
  id: string;
  provider: string;
  /** How this reference was scaled to the job. */
  method: BaselineMethod;
  /** The reference's own low / high price (QAR). */
  priceFrom: number;
  priceTo: number;
  /** The reference's own scope, when listed. */
  refHours: number | null;
  refAthletes: number | null;
  /** Per-hour or per-athlete unit price (null for flat). */
  unitFrom: number | null;
  unitTo: number | null;
  /** Scaled to the job's size (QAR). */
  normalisedFrom: number;
  normalisedTo: number;
  /** Where the reference's scope differs from the job (plain English). */
  scopeDiff: string[];
  stale: boolean;
};

export type NotComparableReference = { id: string; provider: string; reason: string };

export type QuoteBaseline = { method: BaselineMethod; from: number; to: number; min: number; max: number; count: number };

export type QuoteCosts = {
  /** Shooting time at the target hourly rate; only used when no baseline exists. */
  shooting: number;
  editing: number;
  travel: number;
  videoPartner: number;
  other: number;
  total: number;
};

export type QuoteConfidence = "low" | "medium" | "high";

export type QuoteSuggestion = {
  comparable: ComparableReference[];
  notComparable: NotComparableReference[];
  baseline: QuoteBaseline | null;
  costs: QuoteCosts;
  marginPercent: number;
  margin: number;
  suggestedFrom: number;
  suggestedTo: number;
  steps: string[];
  confidence: QuoteConfidence;
  warnings: string[];
};

const DAY_MS = 86_400_000;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : round2((sorted[mid - 1] + sorted[mid]) / 2);
}

function daysOld(checkedOn: string, now: Date): number {
  const t = Date.parse(`${checkedOn}T00:00:00Z`);
  if (!Number.isFinite(t)) return 0;
  return Math.floor((now.getTime() - t) / DAY_MS);
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function fmtHours(h: number): string {
  return `${h % 1 === 0 ? h : h.toFixed(1)} h`;
}

/** Which scaling the job allows, in order of preference. */
function preferredMethod(inputs: QuoteInputs): BaselineMethod {
  if (inputs.hours && inputs.hours > 0) return "per_hour";
  if (inputs.athletes && inputs.athletes > 0) return "per_athlete";
  return "flat";
}

export function suggestQuote(refs: PhotoPriceReferenceRow[], inputs: QuoteInputs, now: Date = new Date()): QuoteSuggestion {
  const warnings: string[] = [];
  const steps: string[] = [];
  const comparable: ComparableReference[] = [];
  const notComparable: NotComparableReference[] = [];
  const method = preferredMethod(inputs);

  // 1. Comparability ----------------------------------------------------------
  for (const ref of refs) {
    const inc = priceReferenceIncludes(ref);
    if (ref.service_type !== inputs.service_type) {
      notComparable.push({ id: ref.id, provider: ref.provider, reason: `Different service: ${BOOKING_TYPE_LABEL[ref.service_type] ?? ref.service_type}.` });
      continue;
    }
    if ((ref.currency || "QAR").toUpperCase() !== "QAR") {
      notComparable.push({ id: ref.id, provider: ref.provider, reason: `Priced in ${ref.currency}, not QAR.` });
      continue;
    }
    if (inc.video === true && !inputs.video) {
      notComparable.push({ id: ref.id, provider: ref.provider, reason: "Includes video; this job is photo only." });
      continue;
    }
    if (inc.video === false && inputs.video) {
      notComparable.push({ id: ref.id, provider: ref.provider, reason: "Photo only; this job needs video." });
      continue;
    }

    const priceFrom = round2(Number(ref.price_from) || 0);
    const priceTo = ref.price_to === null || ref.price_to === undefined ? priceFrom : round2(Number(ref.price_to));
    const scopeDiff: string[] = [];
    // A photo-only job is the common case; a reference that does not mention
    // video is fine for it. For a video job the silence is a real gap.
    if (inc.video === undefined && inputs.video) scopeDiff.push("Video not stated; this job needs video.");

    let refMethod: BaselineMethod = "flat";
    let unitFrom: number | null = null;
    let unitTo: number | null = null;
    let normalisedFrom = priceFrom;
    let normalisedTo = priceTo;
    if (method === "per_hour" && inc.hours && inc.hours > 0) {
      refMethod = "per_hour";
      unitFrom = round2(priceFrom / inc.hours);
      unitTo = round2(priceTo / inc.hours);
      normalisedFrom = round2(unitFrom * inputs.hours!);
      normalisedTo = round2(unitTo * inputs.hours!);
      if (inc.athletes !== undefined && inputs.athletes !== null && inc.athletes !== inputs.athletes) scopeDiff.push(`Covers ${plural(inc.athletes, "athlete")}; this job has ${inputs.athletes}.`);
    } else if ((method === "per_hour" || method === "per_athlete") && inc.athletes && inc.athletes > 0 && inputs.athletes && inputs.athletes > 0) {
      refMethod = "per_athlete";
      unitFrom = round2(priceFrom / inc.athletes);
      unitTo = round2(priceTo / inc.athletes);
      normalisedFrom = round2(unitFrom * inputs.athletes);
      normalisedTo = round2(unitTo * inputs.athletes);
      if (method === "per_hour") scopeDiff.push("No hours listed; scaled per athlete instead.");
    } else {
      if (method === "per_hour") scopeDiff.push("No hours listed; taken as a flat price.");
      else if (method === "per_athlete") scopeDiff.push("No athlete count listed; taken as a flat price.");
      if (inc.athletes !== undefined && inputs.athletes !== null && inc.athletes !== inputs.athletes) scopeDiff.push(`Covers ${plural(inc.athletes, "athlete")}; this job has ${inputs.athletes}.`);
    }
    if (inc.photos !== undefined && inputs.photos_expected !== null && inc.photos < inputs.photos_expected) scopeDiff.push(`Delivers ${inc.photos} photos; this job expects ${inputs.photos_expected}.`);
    if (inc.travel_included === false && (inputs.travel_km || inputs.travel_cost_qr)) scopeDiff.push("Travel not included.");

    const age = daysOld(ref.checked_on, now);
    const stale = age > STALE_AFTER_DAYS;
    if (stale) warnings.push(`${ref.provider}: price last checked ${plural(age, "day")} ago. Re-check it before relying on it.`);
    comparable.push({ id: ref.id, provider: ref.provider, method: refMethod, priceFrom, priceTo, refHours: inc.hours ?? null, refAthletes: inc.athletes ?? null, unitFrom, unitTo, normalisedFrom, normalisedTo, scopeDiff, stale });
  }

  // 2. Baseline ---------------------------------------------------------------
  let baseline: QuoteBaseline | null = null;
  if (comparable.length) {
    const lows = comparable.map((c) => c.normalisedFrom);
    const highs = comparable.map((c) => c.normalisedTo);
    const methods = comparable.map((c) => c.method);
    const baselineMethod: BaselineMethod = methods.every((m) => m === methods[0]) ? methods[0] : method;
    baseline = { method: baselineMethod, from: median(lows), to: median(highs), min: Math.min(...lows), max: Math.max(...highs), count: comparable.length };
  }

  const jobLabel = [BOOKING_TYPE_LABEL[inputs.service_type], inputs.hours ? fmtHours(inputs.hours) : null, inputs.athletes ? plural(inputs.athletes, "athlete") : null, inputs.video ? "photo + video" : "photo only"].filter(Boolean).join(", ");
  steps.push(`Job: ${jobLabel}.`);
  if (baseline) {
    for (const c of comparable) {
      if (c.method === "per_hour") steps.push(`${c.provider}: ${formatQr(c.priceFrom)}${c.priceTo !== c.priceFrom ? ` to ${formatQr(c.priceTo)}` : ""} for ${fmtHours(c.refHours ?? 0)} = ${formatQr(c.unitFrom)}${c.unitTo !== c.unitFrom ? ` to ${formatQr(c.unitTo)}` : ""} per hour, so ${fmtHours(inputs.hours!)} = ${formatQr(c.normalisedFrom)}${c.normalisedTo !== c.normalisedFrom ? ` to ${formatQr(c.normalisedTo)}` : ""}.`);
      else if (c.method === "per_athlete") steps.push(`${c.provider}: ${formatQr(c.priceFrom)}${c.priceTo !== c.priceFrom ? ` to ${formatQr(c.priceTo)}` : ""} for ${plural(c.refAthletes ?? 0, "athlete")} = ${formatQr(c.unitFrom)}${c.unitTo !== c.unitFrom ? ` to ${formatQr(c.unitTo)}` : ""} per athlete, so ${plural(inputs.athletes!, "athlete")} = ${formatQr(c.normalisedFrom)}${c.normalisedTo !== c.normalisedFrom ? ` to ${formatQr(c.normalisedTo)}` : ""}.`);
      else steps.push(`${c.provider}: ${formatQr(c.priceFrom)}${c.priceTo !== c.priceFrom ? ` to ${formatQr(c.priceTo)}` : ""} taken as a flat price.`);
    }
    steps.push(`Market baseline (median of ${plural(comparable.length, "comparable reference")}): ${formatQr(baseline.from)} to ${formatQr(baseline.to)}; the full spread is ${formatQr(baseline.min)} to ${formatQr(baseline.max)}.`);
  } else {
    steps.push("No comparable reference prices, so the suggestion is built from costs and margin only.");
    warnings.push("No comparable reference prices for this job. Add some, or treat the figure as a cost-plus floor.");
  }

  // 3. Costs ------------------------------------------------------------------
  const baselineHourly = baseline && inputs.hours && inputs.hours > 0 ? round2(baseline.from / inputs.hours) : null;
  const hourly = inputs.target_hourly_qr ?? baselineHourly;

  let shooting = 0;
  if (!baseline && inputs.hours && inputs.hours > 0) {
    if (inputs.target_hourly_qr) {
      shooting = round2(inputs.hours * inputs.target_hourly_qr);
      steps.push(`Shooting: ${fmtHours(inputs.hours)} × ${formatQr(inputs.target_hourly_qr)} per hour (your target rate) = ${formatQr(shooting)}.`);
    } else warnings.push("Set a target hourly rate so the shooting time can be costed.");
  }

  let editing = 0;
  if (inputs.editing_hours && inputs.editing_hours > 0) {
    if (hourly) {
      editing = round2(inputs.editing_hours * hourly);
      steps.push(`Editing: ${fmtHours(inputs.editing_hours)} × ${formatQr(hourly)} per hour (${inputs.target_hourly_qr ? "your target rate" : "the baseline hourly rate"}) = ${formatQr(editing)}.`);
    } else warnings.push("Editing hours were given but there is no hourly rate to cost them. Set a target hourly rate.");
  }

  let travel = 0;
  if (inputs.travel_cost_qr && inputs.travel_cost_qr > 0) {
    travel = round2(inputs.travel_cost_qr);
    steps.push(`Travel: ${formatQr(travel)} as entered.`);
  } else if (inputs.travel_km && inputs.travel_km > 0) {
    travel = round2(inputs.travel_km * TRAVEL_QR_PER_KM);
    steps.push(`Travel: ${inputs.travel_km} km × ${formatQr(TRAVEL_QR_PER_KM)} per km = ${formatQr(travel)}.`);
  }

  const videoPartner = inputs.video_partner_cost_qr && inputs.video_partner_cost_qr > 0 ? round2(inputs.video_partner_cost_qr) : 0;
  if (videoPartner) steps.push(`Video partner: ${formatQr(videoPartner)}.`);
  if (inputs.video && !videoPartner && !comparable.some((c) => c.scopeDiff.length === 0)) warnings.push("This job needs video but no video partner cost was entered and no reference states video. Check the video side of the price.");

  const other = inputs.other_costs_qr && inputs.other_costs_qr > 0 ? round2(inputs.other_costs_qr) : 0;
  if (other) steps.push(`Other costs: ${formatQr(other)}.`);

  const costTotal = round2(shooting + editing + travel + videoPartner + other);
  if (costTotal > 0) steps.push(`Costs: ${formatQr(costTotal)} in total.`);

  // 4. Margin + suggestion ------------------------------------------------------
  const margin = round2(costTotal * (inputs.margin_percent / 100));
  if (costTotal > 0) steps.push(`Margin: ${inputs.margin_percent}% of ${formatQr(costTotal)} = ${formatQr(margin)}.`);

  const suggestedFrom = Math.round((baseline ? baseline.from : 0) + costTotal + margin);
  const suggestedTo = Math.round((baseline ? baseline.to : 0) + costTotal + margin);
  steps.push(baseline ? `Suggested: baseline ${formatQr(baseline.from)} to ${formatQr(baseline.to)} + costs ${formatQr(costTotal)} + margin ${formatQr(margin)} = ${formatQr(suggestedFrom)} to ${formatQr(suggestedTo)}.` : `Suggested: costs ${formatQr(costTotal)} + margin ${formatQr(margin)} = ${formatQr(suggestedFrom)}.`);
  if (suggestedFrom <= 0) warnings.push("The suggestion is 0 QAR: there is nothing to price from. Add reference prices or costs.");

  // 5. Confidence ---------------------------------------------------------------
  const scopeFlag = comparable.some((c) => c.scopeDiff.some((d) => /video|athlete/i.test(d)));
  let confidence: QuoteConfidence;
  if (comparable.length < 2 || scopeFlag) confidence = "low";
  else if (comparable.length >= 4 && !comparable.some((c) => c.stale || c.scopeDiff.length)) confidence = "high";
  else confidence = "medium";

  return {
    comparable,
    notComparable,
    baseline,
    costs: { shooting, editing, travel, videoPartner, other, total: costTotal },
    marginPercent: inputs.margin_percent,
    margin,
    suggestedFrom,
    suggestedTo,
    steps,
    confidence,
    warnings,
  };
}

export const CONFIDENCE_LABEL: Record<QuoteConfidence, string> = { low: "Low confidence: needs owner review", medium: "Medium confidence", high: "High confidence" };

/** Midpoint of the suggested range, whole QAR (what the apply form prefills). */
export function suggestedMidpoint(s: Pick<QuoteSuggestion, "suggestedFrom" | "suggestedTo">): number {
  return Math.round((s.suggestedFrom + s.suggestedTo) / 2);
}

/** Reads a stored calculation back; null when it is not a suggestion this module wrote. */
export function suggestionFromJson(value: unknown): QuoteSuggestion | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.comparable) || !Array.isArray(v.notComparable) || !Array.isArray(v.steps) || !Array.isArray(v.warnings)) return null;
  if (typeof v.suggestedFrom !== "number" || typeof v.suggestedTo !== "number" || !v.costs || typeof v.costs !== "object") return null;
  if (v.confidence !== "low" && v.confidence !== "medium" && v.confidence !== "high") return null;
  return v as unknown as QuoteSuggestion;
}
