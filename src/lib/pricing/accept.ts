/**
 * Accepting an assessment creates (or refreshes) a photo_quotes DRAFT linked
 * to the booking, so the existing "apply to booking" flow sets the amount.
 * The quote stores a compact, typed summary of the assessment it came from;
 * the full snapshot stays on the assessment row (immutable per version).
 * Pure helpers; the action does the writes.
 */
import { isPlainObject } from "@/lib/validation";
import type { Json } from "@/lib/supabase/database.types";
import type { Assessment, PriceBand } from "./engine/types";
import { DEFAULT_MARGIN_PERCENT, type QuoteInputs } from "./form";

export type AcceptedQuoteCalculation = {
  kind: "assessment";
  assessment_id: string;
  version: number;
  recommended: PriceBand;
  cost_total: number;
  market_range: { low: number; high: number; median: number; count: number } | null;
  confidence: Assessment["confidence"];
  margin_percent: number;
  fee_percent: number;
};

export function buildAcceptedQuote(a: Assessment, row: { id: string; version: number }): { inputs: QuoteInputs; calculation: AcceptedQuoteCalculation; suggested_from: number; suggested_to: number } {
  const r = a.request;
  const inputs: QuoteInputs = {
    service_type: r.bookingType,
    hours: r.hoursOnSite !== null ? Math.round(r.hoursOnSite * r.days * 100) / 100 : null,
    athletes: r.athleteCount,
    photos_expected: r.expectedImages ?? (a.costFloor.workload.expectedImages || null),
    video: r.media !== "photo",
    editing_hours: Math.round(a.costFloor.workload.editingHours * 100) / 100 || null,
    travel_km: null,
    travel_cost_qr: null,
    video_partner_cost_qr: a.costFloor.lines.find((l) => l.key === "partner_video")?.amount ?? null,
    other_costs_qr: null,
    margin_percent: a.recommendation.marginPercent.target ?? DEFAULT_MARGIN_PERCENT,
    target_hourly_qr: a.costAssumptions.ownerHourlyQr,
    notes: null,
  };
  const m = a.market.range;
  const calculation: AcceptedQuoteCalculation = {
    kind: "assessment",
    assessment_id: row.id,
    version: row.version,
    recommended: a.recommendation.recommended,
    cost_total: a.costFloor.total,
    market_range: m ? { low: m.low, high: m.high, median: m.median, count: m.count } : null,
    confidence: a.confidence,
    margin_percent: a.recommendation.marginPercent.target,
    fee_percent: a.recommendation.feePercent,
  };
  return { inputs, calculation, suggested_from: a.recommendation.recommended.low, suggested_to: a.recommendation.recommended.high };
}

export function acceptedQuoteFromJson(value: Json | unknown): AcceptedQuoteCalculation | null {
  if (!isPlainObject(value) || value.kind !== "assessment" || typeof value.assessment_id !== "string" || !isPlainObject(value.recommended)) return null;
  const rec = value.recommended;
  if (typeof rec.low !== "number" || typeof rec.target !== "number" || typeof rec.high !== "number") return null;
  return value as unknown as AcceptedQuoteCalculation;
}
