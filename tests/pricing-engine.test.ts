import { describe, expect, it } from "vitest";
import { assess, assessmentColumns, assessmentFromRow, statusFor } from "@/lib/pricing/engine";
import { applyRequestOverrides, extractPricingRequest, locationKindFrom, pricingRequestFromJson } from "@/lib/pricing/engine/extract";
import { requestFingerprint } from "@/lib/pricing/engine/fingerprint";
import type { PhotoPricingAssessmentRow } from "@/lib/supabase/database.types";
import { seedRows } from "./pricing-seed";

const NOW = new Date("2026-10-15T09:00:00.000Z");

const PRIVATE = { athlete_name: "Secret Athlete", club_name: "Secret Club", notes: "call me on +974 5555 1234", request: "my e-mail is x@y.z", location: "Secret Hall, Doha", location_preference: "Secret Academy gym", instagram: "secret", academy: "Secret Academy", event_name: "Secret Open" };

describe("extractPricingRequest", () => {
  it("reads only public-scope keys and never copies a name, note, venue string or handle", () => {
    const req = extractPricingRequest({ bookingType: "club", details: { ...PRIVATE, athlete_count: 12, wants_photographer: true, wants_videographer: true, competition_date: "2026-11-20" }, usageType: "club_team" }, NOW);
    const text = JSON.stringify(req);
    for (const v of Object.values(PRIVATE)) expect(text).not.toContain(v);
    expect(req).toMatchObject({ service: "team_tournament", bookingType: "club", media: "photo_video", athleteCount: 12, eventDate: "2026-11-20", usage: "club_team", locationKind: "academy", days: 1 });
    // Video deliverables were not stated: a visible default, not a silent one.
    expect(req.videoDeliverables).toEqual(["edited_highlights"]);
    expect(req.missingInputs).toContain("video_deliverables");
  });

  it("marks the inputs that make a team price indefensible as critical", () => {
    const req = extractPricingRequest({ bookingType: "club", details: { wants_photographer: true } }, NOW);
    expect(req.criticalMissing).toEqual(expect.arrayContaining(["athlete_count", "hours_on_site"]));
    expect(req.athleteCount).toBeNull();
    expect(req.hoursOnSite).toBe(8);
    expect(req.assumptions.find((a) => a.key === "hours_on_site")).toMatchObject({ value: 8, source: "default" });
  });

  it("maps legacy service_kind values and the session window to hours", () => {
    const req = extractPricingRequest({ bookingType: "tournament_athlete", details: { service_kind: "tournament_athlete_photo_video", gi: "gi" }, sessionAt: "2026-11-01T06:00:00.000Z", sessionEndAt: "2026-11-01T09:30:00.000Z" }, NOW);
    expect(req).toMatchObject({ service: "tournament_athlete", media: "photo_video", hoursOnSite: 3.5, athleteCount: 1, simultaneousMats: 1 });
    expect(req.criticalMissing).toEqual([]);
  });

  it("prefers the new catalog keys (service, media, video_deliverables) and falls back to the package", () => {
    const a = extractPricingRequest({ bookingType: "private_session", details: { service: "athlete_portrait", media: "video", video_deliverables: ["reels", "full_match"] } }, NOW);
    expect(a.media).toBe("video");
    // full_match is not offered for portraits: dropped, reels kept.
    expect(a.videoDeliverables).toEqual(["reels"]);
    const b = extractPricingRequest({ bookingType: "training_session", details: {}, service: { includes_video: true, duration_minutes: 90 } }, NOW);
    expect(b).toMatchObject({ media: "photo_video", hoursOnSite: 1.5 });
  });

  it("derives a location KIND from keywords without keeping the text", () => {
    expect(locationKindFrom("Our studio in West Bay")).toBe("studio");
    expect(locationKindFrom("Evolve academy, Al Sadd")).toBe("academy");
    expect(locationKindFrom("Corniche outdoor shoot")).toBe("outdoor");
    expect(locationKindFrom("Lusail Sports Arena")).toBe("venue");
    expect(locationKindFrom("somewhere")).toBe("unknown");
    expect(locationKindFrom(null)).toBe("unknown");
  });
});

describe("fingerprint", () => {
  it("is stable across key order and derived fields, and changes with the scope", () => {
    const a = extractPricingRequest({ bookingType: "club", details: { athlete_count: 12, wants_photographer: true, competition_date: "2026-11-20" } }, NOW);
    const b = extractPricingRequest({ bookingType: "club", details: { competition_date: "2026-11-20", wants_photographer: true, athlete_count: 12, notes: "different note" } }, NOW);
    expect(requestFingerprint(a)).toBe(requestFingerprint(b));
    expect(requestFingerprint(a)).toMatch(/^[0-9a-f]{32}$/);
    const c = extractPricingRequest({ bookingType: "club", details: { athlete_count: 13, wants_photographer: true, competition_date: "2026-11-20" } }, NOW);
    expect(requestFingerprint(c)).not.toBe(requestFingerprint(a));
    // Assumption lists are derived: stripping them does not change the hash.
    expect(requestFingerprint({ ...a, assumptions: [], missingInputs: [] })).toBe(requestFingerprint(a));
  });
});

describe("assess (composition)", () => {
  const request = extractPricingRequest({ bookingType: "club", details: { athlete_count: 12, wants_photographer: true, competition_date: "2026-11-20", hours_on_site: 8, simultaneous_mats: 3 }, usageType: "club_team" }, NOW);

  it("produces the three outputs separately plus a confidence, deterministically", () => {
    const refs = seedRows();
    const a1 = assess({ request, references: refs, now: NOW });
    const a2 = assess({ request, references: refs, now: NOW });
    expect(a1).toEqual(a2);
    expect(a1.market.primaryScope).toBe("event_coverage_hourly");
    expect(a1.costFloor.total).toBeGreaterThan(0);
    expect(a1.recommendation.recommended.low).toBeLessThanOrEqual(a1.recommendation.recommended.target);
    expect(a1.recommendation.recommended.target).toBeLessThanOrEqual(a1.recommendation.recommended.high);
    expect(a1.recommendation.team).toMatchObject({ athletes: 12 });
    expect(statusFor(a1)).toBe("ready");
    expect(a1.references.every((id) => refs.some((r) => r.id === id))).toBe(true);
  });

  it("is needs_detail with critical inputs missing and low confidence", () => {
    const thin = extractPricingRequest({ bookingType: "club", details: { wants_photographer: true } }, NOW);
    const a = assess({ request: thin, references: seedRows(), now: NOW });
    expect(statusFor(a)).toBe("needs_detail");
    expect(a.confidence).toBe("low");
    expect(a.missingInputs).toEqual(expect.arrayContaining(["athlete_count", "hours_on_site"]));
    expect(a.recommendation.flags.some((f) => f.code === "needs_detail")).toBe(true);
  });

  it("round-trips through the row columns and drops anything that is not public scope", () => {
    const a = assess({ request, references: seedRows(), now: NOW });
    const cols = assessmentColumns(a);
    const row = { ...cols, request_snapshot: { ...(cols.request_snapshot as unknown as Record<string, unknown>), customer_email: "leak@example.com" }, reference_ids: cols.reference_ids, missing_inputs: cols.missing_inputs, confidence: cols.confidence, computed_at: cols.computed_at } as unknown as PhotoPricingAssessmentRow;
    const back = assessmentFromRow(row);
    expect(back).not.toBeNull();
    expect(JSON.stringify(back!.request)).not.toContain("leak@example.com");
    expect(back!.recommendation.recommended).toEqual(a.recommendation.recommended);
    expect(back!.costFloor.total).toBe(a.costFloor.total);
    expect(assessmentFromRow({ ...row, market: null })).toBeNull();
    expect(pricingRequestFromJson({ service: "nope" })).toBeNull();
  });

  it("snapshot immutability: a new version from overrides never changes the first", () => {
    const refs = seedRows();
    const v1 = assess({ request, references: refs, now: NOW });
    const frozen = JSON.stringify(v1);
    const v2req = applyRequestOverrides(v1.request, { hoursOnSite: 4, simultaneousMats: 1 });
    const v2 = assess({ request: v2req, references: refs, now: new Date("2026-10-16T09:00:00.000Z") });
    expect(JSON.stringify(v1)).toBe(frozen);
    expect(v2.request.hoursOnSite).toBe(4);
    expect(v2.request.assumptions.find((s) => s.key === "hours_on_site")).toMatchObject({ source: "owner", value: 4 });
    expect(v2.costFloor.total).toBeLessThan(v1.costFloor.total);
    expect(requestFingerprint(v2.request)).not.toBe(requestFingerprint(v1.request));
  });
});
