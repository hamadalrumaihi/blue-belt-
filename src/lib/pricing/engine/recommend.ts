/**
 * Recommendation: a low / target / high price band from the cost floor at
 * three margins, reconciled against the market range.
 *
 * MARGIN, NOT MARKUP. A margin m is profit as a share of the PRICE, so with a
 * payment fee f (also a share of the price):
 *     price × (1 − m − f) = cost   ⇒   price = cost / (1 − m − f)
 * "Cost × (1 + 30%)" is a 30% MARKUP, which is only a 23% margin. The legacy
 * suggest.ts flow uses markup and says so; this module never does.
 *
 * Large teams are priced from event hours, mats, roster distribution,
 * staffing and output workload (the cost floor), with the team total and the
 * effective per-athlete figure both shown. It never assumes two fights per
 * athlete. Capacity conflicts come in as data (queried elsewhere, injected).
 * Pure and deterministic.
 */
import type { Alternative, CapacityCheck, CostAssumptions, CostFloor, Flag, MarketComparison, PriceBand, PricingRequest, Recommendation } from "./types";
import { round2 } from "./types";

export const DEFAULT_MARGINS: PriceBand = { low: 20, target: 35, high: 50 };

export type RecommendOptions = {
  marginPercent?: Partial<PriceBand>;
  /** Share of the price taken by the payment provider (from the cost assumptions). */
  feePercent: number;
  capacity?: CapacityCheck | null;
  /** Re-costs a changed request (and/or changed assumptions) for the scope alternatives. */
  costFor?: (req: PricingRequest, assumptionOverrides?: Partial<CostAssumptions>) => CostFloor;
};

/** price = cost / (1 − margin − fee); null when the margin + fee leave nothing to cover the cost. */
export function priceForMargin(cost: number, marginPercent: number, feePercent: number): number | null {
  const denominator = 1 - marginPercent / 100 - feePercent / 100;
  if (denominator <= 0.05) return null;
  return Math.round(cost / denominator);
}

function band(cost: number, margins: PriceBand, fee: number): PriceBand | null {
  const low = priceForMargin(cost, margins.low, fee);
  const target = priceForMargin(cost, margins.target, fee);
  const high = priceForMargin(cost, margins.high, fee);
  return low === null || target === null || high === null ? null : { low, target, high };
}

function changed(base: PricingRequest, patch: Partial<PricingRequest>): PricingRequest {
  return { ...base, ...patch, assumptions: base.assumptions, missingInputs: base.missingInputs, criticalMissing: base.criticalMissing };
}

export function recommend(req: PricingRequest, market: MarketComparison, cost: CostFloor, opts: RecommendOptions): Recommendation {
  const margins: PriceBand = { ...DEFAULT_MARGINS, ...opts.marginPercent };
  const fee = Math.max(0, opts.feePercent);
  const flags: Flag[] = [];
  const steps: string[] = [];
  const capacity: CapacityCheck = opts.capacity ?? { date: req.eventDate, conflicts: [], tentative: [] };

  const costBased = band(cost.total, margins, fee);
  if (!costBased) {
    flags.push({ code: "margin_infeasible", severity: "blocker", message: `A ${margins.high}% margin plus a ${fee}% fee leaves nothing to cover the cost. Lower the margins.` });
  }
  const cb: PriceBand = costBased ?? { low: Math.round(cost.total), target: Math.round(cost.total), high: Math.round(cost.total) };
  steps.push(`Cost floor ${cost.total} QAR (every line once, contingency included; payment fee excluded).`);
  steps.push(`Price = cost ÷ (1 − margin − fee): at ${margins.low}% / ${margins.target}% / ${margins.high}% margin and a ${fee}% fee → ${cb.low} / ${cb.target} / ${cb.high} QAR. (A 30% markup would be only a 23% margin.)`);

  // Market reconciliation ------------------------------------------------------------
  let recommended: PriceBand = { ...cb };
  let reconciliation: Recommendation["marketReconciliation"];
  if (!market.range) {
    reconciliation = { status: "no_market", note: "No active comparable evidence in Qatar for this scope; the band is cost-based only." };
    steps.push(reconciliation.note);
  } else {
    const m = market.range;
    const unitNote = m.unit === "flat" ? " (flat prices, not scaled to the job)" : "";
    if (m.high < cb.low) {
      reconciliation = { status: "above_market", note: `Even the minimum-margin price (${cb.low} QAR) is above the highest comparable advertised price (${m.high} QAR${unitNote}). This brief is unprofitable at market rates as scoped.` };
      flags.push({ code: "unprofitable_at_market", severity: "warning", message: reconciliation.note });
    } else if (m.low > cb.high) {
      reconciliation = { status: "below_market", note: `Comparable providers advertise from ${m.low} QAR, above your high-margin price (${cb.high} QAR). Price toward the market, not the floor.` };
      recommended = { low: Math.max(cb.target, m.low), target: Math.max(cb.high, m.median), high: Math.max(cb.high, m.high) };
      flags.push({ code: "below_market", severity: "info", message: reconciliation.note });
    } else {
      reconciliation = { status: "within", note: `Market ${m.low} to ${m.high} QAR (median ${m.median}${unitNote}, ${m.count} observation${m.count === 1 ? "" : "s"}) overlaps the cost-based band.` };
      recommended = { low: Math.max(cb.low, Math.min(m.low, cb.target)), target: Math.min(Math.max(cb.target, m.median), Math.max(cb.high, m.median)), high: Math.max(cb.high, m.high) };
    }
    steps.push(reconciliation.note);
    if (market.confidence === "low") flags.push({ code: "market_low_confidence", severity: "info", message: "Market evidence is thin or partly unverified; weight the cost floor more." });
  }
  recommended = { low: Math.round(recommended.low), target: Math.round(recommended.target), high: Math.round(recommended.high) };

  const profitAtTarget = round2(recommended.target * (1 - fee / 100) - cost.total);
  const marginAtTarget = recommended.target > 0 ? round2((profitAtTarget / recommended.target) * 100) : 0;
  steps.push(`At the target ${recommended.target} QAR: profit ${profitAtTarget} QAR after the fee, a ${marginAtTarget}% margin.`);
  if (profitAtTarget < 0) flags.push({ code: "unprofitable", severity: "warning", message: "The target price does not cover the cost floor." });

  // Feasibility ------------------------------------------------------------------------
  if (req.criticalMissing.length) flags.push({ code: "needs_detail", severity: "warning", message: `Missing: ${req.criticalMissing.join(", ")}. Ask before quoting; the band rests on assumptions.` });
  if (capacity.conflicts.length) flags.push({ code: "capacity_conflict", severity: "blocker", message: `${capacity.conflicts.length} confirmed booking${capacity.conflicts.length === 1 ? "" : "s"} on ${capacity.date}: this job needs extra crew or another date.` });
  if (capacity.tentative.length) flags.push({ code: "capacity_tentative", severity: "info", message: `${capacity.tentative.length} tentative booking${capacity.tentative.length === 1 ? "" : "s"} on the same date.` });
  if (cost.staffing.crew > 1) flags.push({ code: "crew_required", severity: "info", message: `Staffing: ${cost.staffing.basis}.` });
  for (const w of cost.warnings) flags.push({ code: "cost_warning", severity: "warning", message: w });

  // Team pricing: total and effective per-athlete, never linear ------------------------------
  let team: Recommendation["team"] = null;
  if (req.athleteCount && req.athleteCount > 1) {
    team = { athletes: req.athleteCount, total: recommended.target, perAthlete: round2(recommended.target / req.athleteCount), basis: `Team total from ${cost.workload.shootHours} h on site, ${req.simultaneousMats ?? 1} mat(s), ${cost.staffing.crew} crew and ${cost.workload.expectedImages} expected images; ${recommended.target} ÷ ${req.athleteCount} athletes.` };
    steps.push(team.basis);
  }

  // Alternatives (scope changes, re-costed; never market-adjusted) ------------------------------
  const alternatives: Alternative[] = [];
  if (opts.costFor) {
    const add = (key: string, label: string, changes: string[], patch: Partial<PricingRequest>, assumptionOverrides?: Partial<CostAssumptions>) => {
      const c = opts.costFor!(changed(req, patch), assumptionOverrides);
      const b = band(c.total, margins, fee);
      if (b) alternatives.push({ key, label, changes, costTotal: c.total, band: b });
    };
    if (req.media === "photo_video") add("photo_only", "Photos only", ["Drop the video deliverables"], { media: "photo", videoDeliverables: [] });
    if (req.videoDeliverables.includes("full_match")) add("highlights_only", "Highlights instead of full matches", ["Edited highlights replace full-match films"], { videoDeliverables: ["edited_highlights", ...req.videoDeliverables.filter((d) => d !== "full_match" && d !== "edited_highlights")] });
    if (req.hoursOnSite && req.hoursOnSite >= 4) add("half_day", "Half the time on site", [`${round2(req.hoursOnSite / 2)} h instead of ${req.hoursOnSite} h`], { hoursOnSite: round2(req.hoursOnSite / 2) });
    const images = cost.workload.expectedImages;
    if (images >= 20) add("fewer_images", "Fewer delivered images", [`${Math.round(images / 2)} instead of ${images}`], { expectedImages: Math.round(images / 2) });
    if ((req.simultaneousMats ?? 1) > 1 && req.media !== "video") add("more_crew", "One photographer per mat", ["More crew, fuller coverage, higher cost"], {}, { matsPerShooter: 1 });
  }

  return { costBased: cb, marginPercent: margins, feePercent: fee, recommended, profitAtTarget, marginAtTarget, marketReconciliation: reconciliation, flags, team, alternatives, capacity, steps };
}
