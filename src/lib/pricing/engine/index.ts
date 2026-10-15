/**
 * The pricing engine entry point: composes extraction, market comparison,
 * cost floor and recommendation into one immutable Assessment snapshot.
 * Pure: references, capacity data and `now` are injected; nothing here reads
 * the database or the network. The snapshot is what gets stored per
 * version and what the owner's page renders.
 */
import type { PhotoPricingAssessmentRow } from "@/lib/supabase/database.types";
import { isPlainObject } from "@/lib/validation";
import { computeCostFloor, DEFAULT_COST_ASSUMPTIONS, resolveCostAssumptions } from "./cost-floor";
import { pricingRequestFromJson } from "./extract";
import { compareMarket, type ReferenceRow } from "./market";
import { DEFAULT_MARGINS, recommend } from "./recommend";
import type { Assessment, CapacityCheck, CostAssumptions, CostFloor, MarketComparison, PriceBand, PricingRequest, Recommendation } from "./types";

export const ENGINE_VERSION = 1;

export type AssessInput = {
  request: PricingRequest;
  references: ReferenceRow[];
  costAssumptions?: Partial<CostAssumptions> | null;
  marginPercent?: Partial<PriceBand> | null;
  capacity?: CapacityCheck | null;
  now: Date;
};

export function assess(input: AssessInput): Assessment {
  const { request, references, now } = input;
  const { assumptions } = resolveCostAssumptions(input.costAssumptions);
  const market = compareMarket(references, request, now);
  const costFloor = computeCostFloor(request, input.costAssumptions ?? null);
  const recommendation = recommend(request, market, costFloor, {
    marginPercent: input.marginPercent ?? undefined,
    feePercent: assumptions.paymentFeePercent,
    capacity: input.capacity ?? null,
    costFor: (req, overrides) => computeCostFloor(req, { ...(input.costAssumptions ?? {}), ...(overrides ?? {}) }),
  });
  const missingInputs = [...new Set([...request.criticalMissing, ...request.missingInputs])];
  const confidence: Assessment["confidence"] = request.criticalMissing.length ? "low" : market.confidence === "high" && recommendation.flags.every((f) => f.severity === "info") ? "high" : market.range ? (market.confidence === "low" ? "low" : "medium") : "low";
  return {
    engineVersion: ENGINE_VERSION,
    computedAt: now.toISOString(),
    request,
    references: market.groups.flatMap((g) => g.items.map((i) => i.id)),
    costAssumptions: assumptions,
    market,
    costFloor,
    recommendation,
    missingInputs,
    confidence,
  };
}

/** The assessment's status from its content: critical inputs missing → needs_detail. */
export function statusFor(a: Assessment): "ready" | "needs_detail" {
  return a.request.criticalMissing.length ? "needs_detail" : "ready";
}

/** The columns an assessment row stores (the snapshot split into its JSON columns). */
export function assessmentColumns(a: Assessment) {
  return {
    request_snapshot: a.request,
    reference_ids: a.references,
    cost_assumptions: a.costAssumptions,
    market: a.market,
    cost_floor: a.costFloor,
    recommendation: a.recommendation,
    missing_inputs: a.missingInputs,
    confidence: a.confidence,
    computed_at: a.computedAt,
  };
}

/** Reads a stored row back into an Assessment; null when its JSON is not an engine snapshot. */
export function assessmentFromRow(row: Pick<PhotoPricingAssessmentRow, "request_snapshot" | "reference_ids" | "cost_assumptions" | "market" | "cost_floor" | "recommendation" | "missing_inputs" | "confidence" | "computed_at">): Assessment | null {
  const request = pricingRequestFromJson(row.request_snapshot);
  if (!request || !isPlainObject(row.market) || !isPlainObject(row.cost_floor) || !isPlainObject(row.recommendation)) return null;
  const market = row.market as unknown as MarketComparison;
  const costFloor = row.cost_floor as unknown as CostFloor;
  const recommendation = row.recommendation as unknown as Recommendation;
  if (!Array.isArray(market.groups) || !Array.isArray(costFloor.lines) || !isPlainObject(recommendation.recommended)) return null;
  const costAssumptions = isPlainObject(row.cost_assumptions) ? { ...DEFAULT_COST_ASSUMPTIONS, ...(row.cost_assumptions as Partial<CostAssumptions>) } : DEFAULT_COST_ASSUMPTIONS;
  return {
    engineVersion: ENGINE_VERSION,
    computedAt: row.computed_at ?? "",
    request,
    references: row.reference_ids ?? [],
    costAssumptions,
    market,
    costFloor,
    recommendation,
    missingInputs: row.missing_inputs ?? [],
    confidence: row.confidence ?? "low",
  };
}

export { DEFAULT_COST_ASSUMPTIONS, DEFAULT_MARGINS };
export type { Assessment, CapacityCheck, CostAssumptions, PricingRequest } from "./types";
