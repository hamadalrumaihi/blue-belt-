import { describe, expect, it } from "vitest";
import { extractPricingRequest } from "@/lib/pricing/engine/extract";
import { compareMarket, referenceScope, STALE_AFTER_DAYS, wantedScopes, type ReferenceRow } from "@/lib/pricing/engine/market";
import type { PricingRequest } from "@/lib/pricing/engine/types";
import { seedRows } from "./pricing-seed";

const NOW = new Date("2026-10-15T09:00:00.000Z");

let seq = 100;
function ref(o: Partial<ReferenceRow> = {}): ReferenceRow {
  seq += 1;
  return { id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`, provider: `P${seq}`, service_type: "custom", price_from: 1000, price_to: null, currency: "QAR", includes: {}, observed_on: "2026-10-01", checked_on: "2026-10-01", source_type: "provider_site", confidence: "verified", region: "qatar", media_type: "photo", duration_hours: 4, athlete_count: null, promotion_expires_on: null, excluded: false, excluded_reason: null, comparable_scope: "event_coverage_hourly", superseded_by: null, ...o };
}

function req(o: Partial<PricingRequest> = {}): PricingRequest {
  return { ...extractPricingRequest({ bookingType: "custom", details: { coverage: "photo", hours_on_site: 8 } }, NOW), ...o };
}

describe("comparability", () => {
  it("excludes different products, other regions, superseded rows, owner exclusions and non-QAR prices, each with its reason", () => {
    const refs = [
      ref({ provider: "Retainer", comparable_scope: "retainer_monthly" }),
      ref({ provider: "Managed social", comparable_scope: "managed_social", excluded: true, excluded_reason: "Different product: managed social." }),
      ref({ provider: "Dubai", region: "gcc" }),
      ref({ provider: "London", region: "other" }),
      ref({ provider: "Old obs", superseded_by: "00000000-0000-4000-8000-000000000001" }),
      ref({ provider: "Dollars", currency: "USD" }),
      ref({ provider: "Portrait", comparable_scope: "portrait_session" }),
      ref({ provider: "Video only", media_type: "video" }),
      ref({ provider: "Good" }),
    ];
    const m = compareMarket(refs, req(), NOW);
    const reasons = Object.fromEntries(m.excluded.map((e) => [e.provider, e.reason]));
    expect(reasons.Retainer).toMatch(/different product/i);
    expect(reasons["Managed social"]).toMatch(/managed social/i);
    expect(reasons.London).toMatch(/outside qatar/i);
    expect(reasons["Old obs"]).toMatch(/superseded/i);
    expect(reasons.Dollars).toMatch(/USD, not QAR/);
    expect(reasons.Portrait).toMatch(/different scope/i);
    expect(reasons["Video only"]).toMatch(/video only/i);
    expect(m.excluded.map((e) => e.provider)).not.toContain("Good");
    // GCC evidence is a separate group, never merged into the Qatar range.
    expect(m.groups.find((g) => g.region === "gcc")?.items.map((i) => i.provider)).toEqual(["Dubai"]);
    expect(m.range).toMatchObject({ count: 1, low: 2000, high: 2000 });
    expect(m.notes.some((n) => /gcc/i.test(n))).toBe(true);
  });

  it("lists unverified, search-index, stale and expired evidence as needing re-verification and never prices with it", () => {
    const refs = [
      ref({ provider: "Unverified", confidence: "unverified" }),
      ref({ provider: "Search index", source_type: "search_index" }),
      ref({ provider: "Stale", observed_on: "2025-01-01" }),
      ref({ provider: "Expired promo", promotion_expires_on: "2026-10-01" }),
      ref({ provider: "Fresh", observed_on: "2026-10-10" }),
    ];
    const m = compareMarket(refs, req(), NOW);
    expect(m.needsReverification.map((n) => n.provider).sort()).toEqual(["Expired promo", "Search index", "Stale", "Unverified"]);
    expect(m.needsReverification.find((n) => n.provider === "Stale")?.reason).toMatch(new RegExp(`${STALE_AFTER_DAYS - 1}|\\d+ days ago`));
    expect(m.range?.count).toBe(1);
    expect(m.groups[0].items.map((i) => i.provider)).toEqual(["Fresh"]);
  });

  it("normalises per hour only when the reference states a duration, and flattens a mixed group honestly", () => {
    const m = compareMarket([ref({ provider: "4h", price_from: 2000, duration_hours: 4 }), ref({ provider: "8h", price_from: 3000, duration_hours: 8 })], req(), NOW);
    const g = m.groups[0];
    expect(g.unit).toBe("per_hour");
    // 2000/4 = 500/h → 4000 for 8 h; 3000/8 = 375/h → 3000 for 8 h.
    expect(g.items.map((i) => [i.unitFrom, i.scaledFrom])).toEqual([[500, 4000], [375, 3000]]);
    expect(m.range).toMatchObject({ low: 3000, high: 4000, unit: "per_hour" });

    const mixed = compareMarket([ref({ provider: "4h", price_from: 2000, duration_hours: 4 }), ref({ provider: "No duration", price_from: 2500, duration_hours: null, includes: {} })], req(), NOW);
    expect(mixed.groups[0].unit).toBe("flat");
    expect(mixed.groups[0].items.find((i) => i.provider === "No duration")?.notes[0]).toMatch(/flat/i);
  });

  it("normalises per edited image for content packages and never mixes them with session prices", () => {
    const content = req({ service: "training_content", bookingType: "training_session", media: "photo", expectedImages: 20, hoursOnSite: 2 });
    const refs = [
      ref({ provider: "10 images", service_type: "training_session", comparable_scope: "content_package_images", price_from: 1000, includes: { photos: 10 }, duration_hours: null }),
      ref({ provider: "Studio session", service_type: "private_session", comparable_scope: "portrait_session", price_from: 950, duration_hours: 0.75 }),
    ];
    const m = compareMarket(refs, content, NOW);
    expect(m.primaryScope).toBe("content_package_images");
    expect(m.range).toMatchObject({ unit: "per_image", low: 2000, high: 2000, count: 1 });
    expect(m.excluded.find((e) => e.provider === "Studio session")?.reason).toMatch(/different scope/i);
  });

  it("a photo+video job compares photo+video evidence as primary and single-media evidence as components", () => {
    const both = req({ media: "photo_video", videoDeliverables: ["edited_highlights"] });
    const refs = [ref({ provider: "Photo+film", media_type: "photo_video", price_from: 6500, duration_hours: 8 }), ref({ provider: "Photo only", media_type: "photo", price_from: 3000, duration_hours: 8 })];
    const m = compareMarket(refs, both, NOW);
    expect(m.wanted.map((w) => `${w.scope}:${w.media}:${w.role}`)).toContain("event_coverage_hourly:photo:component");
    expect(m.groups.find((g) => g.role === "primary")?.items.map((i) => i.provider)).toEqual(["Photo+film"]);
    expect(m.groups.find((g) => g.role === "component" && g.media === "photo")?.items.map((i) => i.provider)).toEqual(["Photo only"]);
  });

  it("infers the scope from the service type only when no label exists", () => {
    expect(referenceScope({ comparable_scope: "portrait_session", service_type: "custom", media_type: null })).toEqual({ scope: "portrait_session", inferred: false });
    expect(referenceScope({ comparable_scope: null, service_type: "tournament_athlete", media_type: null })).toEqual({ scope: "sports_event_athlete", inferred: true });
    expect(referenceScope({ comparable_scope: "bogus", service_type: "training_session", media_type: "video" })).toEqual({ scope: "video_production", inferred: true });
    expect(wantedScopes(req({ service: "tournament_athlete", bookingType: "tournament_athlete" }))[0]).toMatchObject({ scope: "sports_event_athlete", role: "primary" });
  });
});

describe("seeded Qatar evidence (15 Oct 2026)", () => {
  it("never produces a BJJ per-athlete range and keeps every scope apart", () => {
    const refs = seedRows();
    const athlete = compareMarket(refs, req({ service: "tournament_athlete", bookingType: "tournament_athlete", athleteCount: 1, hoursOnSite: 4 }), NOW);
    expect(athlete.range).toBeNull();
    expect(athlete.notes.some((n) => /no defensible public qatar bjj/i.test(n))).toBe(true);
    const amoon = athlete.excluded.find((e) => e.provider === "AMOON");
    expect(amoon?.reason).toMatch(/managed social/i);
    expect(athlete.excluded.filter((e) => e.provider === "Glown" && /retainer/i.test(e.reason))).toHaveLength(2);
    // Ghassen (search index) and Shutter/Litrato (unverified) must be re-verified, so the event range is empty too.
    const event = compareMarket(refs, req(), NOW);
    expect(event.needsReverification.map((n) => n.provider)).toEqual(expect.arrayContaining(["Ghassen Oueslati", "Litrato Qatar"]));
    expect(event.range?.count ?? 0).toBeLessThanOrEqual(1);
    for (const g of event.groups) expect(new Set(g.items.map((i) => i.unit)).size).toBe(1);
  });

  it("prices a content session only from the content-package scope (Glown, Share), per edited image", () => {
    const content = req({ service: "training_content", bookingType: "training_session", media: "photo", expectedImages: 20, hoursOnSite: 2 });
    const m = compareMarket(seedRows(), content, NOW);
    const primary = m.groups.find((g) => g.role === "primary")!;
    expect(primary.items.map((i) => i.provider).sort()).toEqual(["Glown", "Glown", "Share Agency"]);
    expect(primary.unit).toBe("per_image");
    // 1000/10 → 100/image → 2000 for 20; 2000/30 → 66.67 → 1333.33; 6000/12 → 500 → 10000.
    expect(primary.items.map((i) => i.scaledFrom).sort((a, b) => a - b)).toEqual([1333.33, 2000, 10000]);
    expect(m.excluded.some((e) => e.provider === "Panoramaworks")).toBe(true);
  });
});
