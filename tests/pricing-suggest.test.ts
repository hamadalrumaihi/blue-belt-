import { describe, expect, it } from "vitest";
import { DEFAULT_MARGIN_PERCENT, type QuoteInputs } from "@/lib/pricing/form";
import { STALE_AFTER_DAYS, suggestedMidpoint, suggestionFromJson, suggestQuote, TRAVEL_QR_PER_KM } from "@/lib/pricing/suggest";
import type { PhotoPriceReferenceRow } from "@/lib/supabase/database.types";

const NOW = new Date("2026-10-06T09:00:00.000Z");
const OWNER = "11111111-1111-4111-8111-111111111111";

let seq = 0;
function ref(overrides: Partial<PhotoPriceReferenceRow> = {}): PhotoPriceReferenceRow {
  seq += 1;
  return {
    id: `aaaaaaaa-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    owner_id: OWNER,
    provider: `Provider ${seq}`,
    source_url: null,
    checked_on: "2026-09-01",
    location: "Doha",
    service_type: "tournament_athlete",
    price_from: 400,
    price_to: null,
    currency: "QAR",
    includes: {},
    notes: null,
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

function inputs(overrides: Partial<QuoteInputs> = {}): QuoteInputs {
  return {
    service_type: "tournament_athlete",
    hours: null,
    athletes: null,
    photos_expected: null,
    video: false,
    editing_hours: null,
    travel_km: null,
    travel_cost_qr: null,
    video_partner_cost_qr: null,
    other_costs_qr: null,
    margin_percent: DEFAULT_MARGIN_PERCENT,
    target_hourly_qr: null,
    notes: null,
    ...overrides,
  };
}

describe("comparability", () => {
  it("keeps same-type QAR references whose video scope matches or is unknown, and explains every exclusion", () => {
    const refs = [
      ref({ provider: "Same, no video info" }),
      ref({ provider: "Same, photo only", includes: { video: false } }),
      ref({ provider: "Same, with video", includes: { video: true } }),
      ref({ provider: "Other type", service_type: "club" }),
      ref({ provider: "Dollars", currency: "USD" }),
    ];
    const photo = suggestQuote(refs, inputs({ video: false }), NOW);
    expect(photo.comparable.map((c) => c.provider)).toEqual(["Same, no video info", "Same, photo only"]);
    expect(photo.notComparable).toEqual([
      expect.objectContaining({ provider: "Same, with video", reason: expect.stringMatching(/includes video/i) }),
      expect.objectContaining({ provider: "Other type", reason: expect.stringMatching(/different service/i) }),
      expect.objectContaining({ provider: "Dollars", reason: expect.stringMatching(/USD, not QAR/) }),
    ]);

    const video = suggestQuote(refs, inputs({ video: true }), NOW);
    expect(video.comparable.map((c) => c.provider)).toEqual(["Same, no video info", "Same, with video"]);
    expect(video.notComparable.find((n) => n.provider === "Same, photo only")?.reason).toMatch(/photo only/i);
    // A reference that does not state video is flagged when the job needs video.
    expect(video.comparable[0].scopeDiff).toEqual([expect.stringMatching(/video not stated/i)]);
    expect(video.comparable[1].scopeDiff).toEqual([]);
  });

  it("is case-insensitive on the currency and treats a missing currency as QAR", () => {
    const out = suggestQuote([ref({ currency: "qar" }), ref({ currency: "" })], inputs(), NOW);
    expect(out.comparable).toHaveLength(2);
    expect(out.notComparable).toEqual([]);
  });
});

describe("normalisation", () => {
  it("scales per hour when both the job and the reference list hours", () => {
    const out = suggestQuote([ref({ price_from: 600, price_to: 900, includes: { hours: 3 } })], inputs({ hours: 5 }), NOW);
    const c = out.comparable[0];
    expect(c).toMatchObject({ method: "per_hour", unitFrom: 200, unitTo: 300, normalisedFrom: 1000, normalisedTo: 1500, refHours: 3 });
    expect(out.baseline).toEqual({ method: "per_hour", from: 1000, to: 1500, min: 1000, max: 1500, count: 1 });
    expect(out.suggestedFrom).toBe(1000);
    expect(out.suggestedTo).toBe(1500);
    expect(out.steps.join("\n")).toContain("200 QAR to 300 QAR per hour");
  });

  it("falls back to per athlete, then flat, and says so in scopeDiff", () => {
    const refs = [ref({ provider: "Per athlete", price_from: 300, includes: { athletes: 2 } }), ref({ provider: "Flat", price_from: 500 })];
    const out = suggestQuote(refs, inputs({ hours: 4, athletes: 3 }), NOW);
    const perAthlete = out.comparable.find((c) => c.provider === "Per athlete")!;
    expect(perAthlete).toMatchObject({ method: "per_athlete", unitFrom: 150, normalisedFrom: 450, normalisedTo: 450 });
    expect(perAthlete.scopeDiff).toContain("No hours listed; scaled per athlete instead.");
    const flat = out.comparable.find((c) => c.provider === "Flat")!;
    expect(flat).toMatchObject({ method: "flat", unitFrom: null, normalisedFrom: 500 });
    expect(flat.scopeDiff).toContain("No hours listed; taken as a flat price.");
    // Mixed methods: the baseline carries the job's preferred method.
    expect(out.baseline?.method).toBe("per_hour");
  });

  it("uses the median of lows and highs as the baseline and the extremes as the spread", () => {
    const refs = [ref({ price_from: 500, price_to: 700 }), ref({ price_from: 600, price_to: 800 }), ref({ price_from: 900 })];
    const out = suggestQuote(refs, inputs(), NOW);
    expect(out.baseline).toEqual({ method: "flat", from: 600, to: 800, min: 500, max: 900, count: 3 });
    expect(out.steps.some((s) => s.includes("median of 3 comparable references") && s.includes("600 QAR to 800 QAR") && s.includes("500 QAR to 900 QAR"))).toBe(true);
    const even = suggestQuote([ref({ price_from: 100 }), ref({ price_from: 300 })], inputs(), NOW);
    expect(even.baseline).toMatchObject({ from: 200, to: 200 });
  });

  it("flags athlete-count and photo-count differences", () => {
    const out = suggestQuote([ref({ includes: { hours: 2, athletes: 1, photos: 50 } })], inputs({ hours: 2, athletes: 3, photos_expected: 120 }), NOW);
    expect(out.comparable[0].scopeDiff).toEqual(["Covers 1 athlete; this job has 3.", "Delivers 50 photos; this job expects 120."]);
    expect(out.confidence).toBe("low");
  });
});

describe("costs and margin", () => {
  it("adds editing at the target rate, travel from distance, partner and other costs, then the margin, and mentions each in the steps", () => {
    const refs = [ref({ price_from: 1000, includes: { hours: 2 } }), ref({ price_from: 1200, includes: { hours: 2 } })];
    const out = suggestQuote(refs, inputs({ hours: 2, editing_hours: 3, target_hourly_qr: 100, travel_km: 40, video_partner_cost_qr: 500, other_costs_qr: 50, margin_percent: 20 }), NOW);
    expect(out.costs).toEqual({ shooting: 0, editing: 300, travel: 60, videoPartner: 500, other: 50, total: 910 });
    expect(out.margin).toBe(182);
    expect(out.baseline).toMatchObject({ from: 1100, to: 1100 });
    expect(out.suggestedFrom).toBe(1100 + 910 + 182);
    expect(out.suggestedTo).toBe(out.suggestedFrom);
    const text = out.steps.join("\n");
    expect(text).toContain("Editing: 3 h × 100 QAR per hour (your target rate) = 300 QAR.");
    expect(text).toContain(`Travel: 40 km × ${TRAVEL_QR_PER_KM} QAR per km = 60 QAR.`);
    expect(text).toContain("Video partner: 500 QAR.");
    expect(text).toContain("Other costs: 50 QAR.");
    expect(text).toContain("Margin: 20% of 910 QAR = 182 QAR.");
    expect(text).toContain("Suggested: baseline 1,100 QAR to 1,100 QAR + costs 910 QAR + margin 182 QAR = 2,192 QAR to 2,192 QAR.");
  });

  it("costs editing at the baseline hourly rate when no target rate is set, and an entered travel cost beats the distance", () => {
    const out = suggestQuote([ref({ price_from: 800, includes: { hours: 4 } })], inputs({ hours: 4, editing_hours: 2, travel_km: 100, travel_cost_qr: 75 }), NOW);
    expect(out.costs.editing).toBe(400);
    expect(out.costs.travel).toBe(75);
    expect(out.steps.join("\n")).toContain("(the baseline hourly rate)");
    expect(out.steps.join("\n")).toContain("Travel: 75 QAR as entered.");
  });

  it("builds a cost-plus figure when nothing is comparable, and warns", () => {
    const out = suggestQuote([ref({ service_type: "club" })], inputs({ hours: 3, target_hourly_qr: 200, editing_hours: 1, margin_percent: 50 }), NOW);
    expect(out.baseline).toBeNull();
    expect(out.costs).toMatchObject({ shooting: 600, editing: 200, total: 800 });
    expect(out.margin).toBe(400);
    expect(out.suggestedFrom).toBe(1200);
    expect(out.suggestedTo).toBe(1200);
    expect(out.warnings).toContain("No comparable reference prices for this job. Add some, or treat the figure as a cost-plus floor.");
    expect(out.confidence).toBe("low");
  });

  it("warns when editing hours or shooting time cannot be costed", () => {
    const out = suggestQuote([], inputs({ hours: 2, editing_hours: 2 }), NOW);
    expect(out.warnings).toEqual(expect.arrayContaining([expect.stringMatching(/target hourly rate so the shooting/i), expect.stringMatching(/editing hours were given/i), expect.stringMatching(/0 QAR/)]));
    expect(out.suggestedFrom).toBe(0);
  });
});

describe("confidence and warnings", () => {
  it("is low below two comparable references, medium for a few, high for four or more clean ones", () => {
    const clean = (n: number) => Array.from({ length: n }, () => ref({ includes: { hours: 2, video: false } }));
    expect(suggestQuote(clean(1), inputs({ hours: 2 }), NOW).confidence).toBe("low");
    expect(suggestQuote(clean(2), inputs({ hours: 2 }), NOW).confidence).toBe("medium");
    expect(suggestQuote(clean(4), inputs({ hours: 2 }), NOW).confidence).toBe("high");
    // Four refs but one is stale → medium.
    const withStale = [...clean(3), ref({ includes: { hours: 2, video: false }, checked_on: "2024-01-01" })];
    expect(suggestQuote(withStale, inputs({ hours: 2 }), NOW).confidence).toBe("medium");
    // Video scope unknown on a video job → low even with many refs.
    expect(suggestQuote(clean(4).map((r) => ({ ...r, includes: { hours: 2 } })), inputs({ hours: 2, video: true }), NOW).confidence).toBe("low");
  });

  it("warns about references older than a year, with the age in days", () => {
    const stale = ref({ provider: "Old", checked_on: "2025-06-01" });
    const fresh = ref({ provider: "Fresh", checked_on: "2026-09-30" });
    const out = suggestQuote([stale, fresh], inputs(), NOW);
    expect(out.comparable.find((c) => c.provider === "Old")?.stale).toBe(true);
    expect(out.comparable.find((c) => c.provider === "Fresh")?.stale).toBe(false);
    expect(out.warnings).toEqual([expect.stringMatching(/^Old: price last checked \d+ days ago/)]);
    // Exactly at the boundary is not stale; one day past is.
    const boundary = new Date(Date.parse("2025-06-01T00:00:00Z") + STALE_AFTER_DAYS * 86_400_000);
    expect(suggestQuote([stale], inputs(), boundary).comparable[0].stale).toBe(false);
    expect(suggestQuote([stale], inputs(), new Date(boundary.getTime() + 86_400_000)).comparable[0].stale).toBe(true);
  });

  it("warns when a video job has neither a partner cost nor a reference that states video", () => {
    const out = suggestQuote([ref({ includes: {} })], inputs({ video: true }), NOW);
    expect(out.warnings.some((w) => /video partner cost/.test(w))).toBe(true);
    const covered = suggestQuote([ref({ includes: { video: true } })], inputs({ video: true }), NOW);
    expect(covered.warnings.some((w) => /video partner cost/.test(w))).toBe(false);
  });
});

describe("determinism and serialisation", () => {
  it("returns the same result for the same inputs regardless of reference order", () => {
    const refs = [ref({ price_from: 300, includes: { hours: 1 } }), ref({ price_from: 900, price_to: 1200, includes: { hours: 3 } }), ref({ price_from: 450, includes: { hours: 1.5 } })];
    const a = suggestQuote(refs, inputs({ hours: 2, editing_hours: 1, margin_percent: 30 }), NOW);
    const b = suggestQuote(refs, inputs({ hours: 2, editing_hours: 1, margin_percent: 30 }), NOW);
    const c = suggestQuote([...refs].reverse(), inputs({ hours: 2, editing_hours: 1, margin_percent: 30 }), NOW);
    expect(a).toEqual(b);
    expect(c.baseline).toEqual(a.baseline);
    expect(c.suggestedFrom).toBe(a.suggestedFrom);
    expect(c.suggestedTo).toBe(a.suggestedTo);
  });

  it("survives a JSON round trip and exposes the midpoint", () => {
    const out = suggestQuote([ref({ price_from: 500, price_to: 700 })], inputs(), NOW);
    const back = suggestionFromJson(JSON.parse(JSON.stringify(out)));
    expect(back).toEqual(out);
    expect(suggestedMidpoint(out)).toBe(600);
    expect(suggestionFromJson({ nope: true })).toBeNull();
    expect(suggestionFromJson(null)).toBeNull();
  });

  it("never emits an em dash in anything the owner reads", () => {
    const out = suggestQuote([ref({ price_from: 500, price_to: 700, includes: { hours: 2 }, checked_on: "2024-01-01" }), ref({ currency: "USD" })], inputs({ hours: 3, editing_hours: 1, travel_km: 10, video: true }), NOW);
    const text = [...out.steps, ...out.warnings, ...out.notComparable.map((n) => n.reason), ...out.comparable.flatMap((c) => c.scopeDiff)].join("\n");
    expect(text).not.toContain("—");
  });
});
