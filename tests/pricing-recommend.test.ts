import { describe, expect, it } from "vitest";
import { computeCostFloor } from "@/lib/pricing/engine/cost-floor";
import { extractPricingRequest } from "@/lib/pricing/engine/extract";
import { compareMarket, type ReferenceRow } from "@/lib/pricing/engine/market";
import { DEFAULT_MARGINS, priceForMargin, recommend } from "@/lib/pricing/engine/recommend";
import type { MarketComparison, PricingRequest } from "@/lib/pricing/engine/types";

const NOW = new Date("2026-10-15T09:00:00.000Z");

function request(o: Partial<PricingRequest> = {}): PricingRequest {
  return { ...extractPricingRequest({ bookingType: "custom", details: { coverage: "photo", hours_on_site: 8, simultaneous_mats: 2, competition_date: "2026-11-20" } }, NOW), ...o };
}

function noMarket(req: PricingRequest): MarketComparison {
  return compareMarket([], req, NOW);
}

function allInclusive(price: number): ReferenceRow {
  // One verified reference whose price already includes travel, editing and delivery for the same 8 h scope.
  return { id: "00000000-0000-4000-8000-000000000777", provider: "All-in", service_type: "custom", price_from: price, price_to: null, currency: "QAR", includes: { hours: 8, travel_included: true, editing_hours: 10, photos: 150 }, observed_on: "2026-10-01", checked_on: "2026-10-01", source_type: "provider_site", confidence: "verified", region: "qatar", media_type: "photo", duration_hours: 8, athlete_count: null, promotion_expires_on: null, excluded: false, excluded_reason: null, comparable_scope: "event_coverage_hourly", superseded_by: null };
}

describe("margin vs markup", () => {
  it("price = cost / (1 − margin − fee); a 30% markup is not a 30% margin", () => {
    expect(priceForMargin(1000, 30, 0)).toBe(1429);
    expect(priceForMargin(1000, 30, 2.5)).toBe(1481);
    expect(priceForMargin(1000, 0, 0)).toBe(1000);
    expect(1000 * 1.3).toBe(1300); // the markup figure the legacy flow produces
    expect(priceForMargin(1000, 95, 2.5)).toBeNull();
    const req = request();
    const cost = computeCostFloor(req);
    const r = recommend(req, noMarket(req), cost, { feePercent: 2.5 });
    expect(r.costBased.target).toBe(Math.round(cost.total / (1 - 0.35 - 0.025)));
    // Profit at the target reproduces the margin, net of the fee.
    expect(Math.abs(r.marginAtTarget - DEFAULT_MARGINS.target)).toBeLessThan(0.2);
    expect(r.marketReconciliation.status).toBe("no_market");
    expect(r.steps.some((s) => /markup/i.test(s))).toBe(true);
  });

  it("blocks margins that leave nothing for the cost", () => {
    const req = request();
    const r = recommend(req, noMarket(req), computeCostFloor(req), { feePercent: 10, marginPercent: { high: 90 } });
    expect(r.flags.find((f) => f.code === "margin_infeasible")?.severity).toBe("blocker");
  });
});

describe("market reconciliation (no double counting)", () => {
  it("an all-inclusive reference within the band sets the target as-is: costs are never added on top of a market price", () => {
    const req = request();
    const cost = computeCostFloor(req);
    const market = compareMarket([allInclusive(cost.total * 1.6)], req, NOW);
    expect(market.range?.median).toBe(Math.round(cost.total * 1.6 * 100) / 100);
    const r = recommend(req, market, cost, { feePercent: 2.5 });
    expect(r.marketReconciliation.status).toBe("within");
    expect(r.recommended.target).toBe(Math.round(market.range!.median));
    // Nothing from the cost floor (travel, editing) was stacked on the market median.
    expect(r.recommended.target).toBeLessThan(market.range!.median + cost.lines.find((l) => l.key === "travel_cost")!.amount);
  });

  it("flags a brief as unprofitable when the market ceiling sits below the minimum-margin price, and offers alternatives", () => {
    const req = request();
    const cost = computeCostFloor(req);
    const market = compareMarket([allInclusive(cost.total * 0.5)], req, NOW);
    const r = recommend(req, market, cost, { feePercent: 2.5, costFor: (q, o) => computeCostFloor(q, o) });
    expect(r.marketReconciliation.status).toBe("above_market");
    expect(r.flags.some((f) => f.code === "unprofitable_at_market")).toBe(true);
    expect(r.recommended.low).toBe(r.costBased.low);
    const keys = r.alternatives.map((a) => a.key);
    expect(keys).toEqual(expect.arrayContaining(["half_day", "fewer_images", "more_crew"]));
    const half = r.alternatives.find((a) => a.key === "half_day")!;
    expect(half.costTotal).toBeLessThan(cost.total);
    expect(half.band.target).toBeLessThan(r.costBased.target);
    const crew = r.alternatives.find((a) => a.key === "more_crew")!;
    expect(crew.costTotal).toBeGreaterThan(cost.total);
  });

  it("prices toward the market when providers advertise above the high-margin price", () => {
    const req = request();
    const cost = computeCostFloor(req);
    const market = compareMarket([allInclusive(cost.total * 5)], req, NOW);
    const r = recommend(req, market, cost, { feePercent: 2.5 });
    expect(r.marketReconciliation.status).toBe("below_market");
    expect(r.recommended.target).toBeGreaterThan(r.costBased.high);
    expect(r.recommended.high).toBe(Math.round(market.range!.high));
  });
});

describe("teams, capacity and video alternatives", () => {
  it("shows the team total and the effective per-athlete figure, derived from hours, mats, crew and output", () => {
    const req = extractPricingRequest({ bookingType: "club", details: { athlete_count: 25, simultaneous_mats: 3, hours_on_site: 8, wants_photographer: true, competition_date: "2026-11-20" } }, NOW);
    const cost = computeCostFloor(req);
    const r = recommend(req, noMarket(req), cost, { feePercent: 2.5 });
    expect(r.team).toMatchObject({ athletes: 25, total: r.recommended.target });
    expect(r.team!.perAthlete).toBe(Math.round((r.recommended.target / 25) * 100) / 100);
    expect(r.team!.basis).toMatch(/8 h on site, 3 mat/);
    const smaller = extractPricingRequest({ bookingType: "club", details: { athlete_count: 5, simultaneous_mats: 3, hours_on_site: 8, wants_photographer: true, competition_date: "2026-11-20" } }, NOW);
    const rs = recommend(smaller, noMarket(smaller), computeCostFloor(smaller), { feePercent: 2.5 });
    expect(rs.team!.perAthlete).toBeGreaterThan(r.team!.perAthlete);
    expect(r.recommended.target).toBeLessThan(rs.recommended.target * 5);
  });

  it("a confirmed booking on the same date is a blocker; tentative ones are information", () => {
    const req = request();
    const cost = computeCostFloor(req);
    const r = recommend(req, noMarket(req), cost, { feePercent: 2.5, capacity: { date: "2026-11-20", conflicts: [{ bookingId: "b1", publicRef: "BB-AAAAAA", status: "confirmed", sessionAt: null }], tentative: [{ bookingId: "b2", publicRef: null, status: "awaiting_payment", sessionAt: null }] } });
    expect(r.flags.find((f) => f.code === "capacity_conflict")?.severity).toBe("blocker");
    expect(r.flags.find((f) => f.code === "capacity_tentative")?.severity).toBe("info");
    expect(r.capacity.conflicts).toHaveLength(1);
  });

  it("offers photos-only and highlights-instead-of-full-matches for a photo+video brief", () => {
    const req = request({ media: "photo_video", videoDeliverables: ["full_match", "raw_footage"] });
    const cost = computeCostFloor(req);
    const r = recommend(req, noMarket(req), cost, { feePercent: 2.5, costFor: (q, o) => computeCostFloor(q, o) });
    const keys = r.alternatives.map((a) => a.key);
    expect(keys).toEqual(expect.arrayContaining(["photo_only", "highlights_only"]));
    for (const a of r.alternatives.filter((x) => x.key !== "more_crew")) expect(a.costTotal).toBeLessThan(cost.total);
    expect(r.flags.find((f) => f.code === "crew_required")?.message).toMatch(/videographer/);
  });
});
