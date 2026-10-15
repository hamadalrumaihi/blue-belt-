import { describe, expect, it } from "vitest";
import { computeCostFloor, DEFAULT_COST_ASSUMPTIONS, resolveCostAssumptions } from "@/lib/pricing/engine/cost-floor";
import { extractPricingRequest } from "@/lib/pricing/engine/extract";
import type { PricingRequest } from "@/lib/pricing/engine/types";

const NOW = new Date("2026-10-15T09:00:00.000Z");

function team(athletes: number, mats = 2, hours = 8, extra: Record<string, unknown> = {}): PricingRequest {
  return extractPricingRequest({ bookingType: "club", details: { athlete_count: athletes, simultaneous_mats: mats, hours_on_site: hours, wants_photographer: true, competition_date: "2026-11-20", ...extra } }, NOW);
}

describe("computeCostFloor", () => {
  it("costs every component exactly once, keeps the payment fee out, and lists every default", () => {
    const c = computeCostFloor(team(10));
    const keys = c.lines.map((l) => l.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(expect.arrayContaining(["shooting", "prep", "travel_time", "travel_cost", "culling", "editing_photo", "admin", "overhead", "equipment"]));
    expect(keys.some((k) => /fee/i.test(k))).toBe(false);
    expect(c.subtotal).toBe(Math.round(c.lines.reduce((s, l) => s + l.amount, 0) * 100) / 100);
    expect(c.total).toBe(Math.round((c.subtotal + c.contingency) * 100) / 100);
    expect(c.contingency).toBe(Math.round(c.subtotal * 0.05 * 100) / 100);
    for (const key of Object.keys(DEFAULT_COST_ASSUMPTIONS)) expect(c.assumptions.find((a) => a.key === key)).toMatchObject({ source: "default" });
    for (const line of c.lines) expect(line.basis.length).toBeGreaterThan(5);
  });

  it("marks owner overrides and ignores bad values", () => {
    const { assumptions, list } = resolveCostAssumptions({ ownerHourlyQr: 200, prepHoursPerDay: -1, paymentFeePercent: Number.NaN });
    expect(assumptions.ownerHourlyQr).toBe(200);
    expect(assumptions.prepHoursPerDay).toBe(DEFAULT_COST_ASSUMPTIONS.prepHoursPerDay);
    expect(list.find((a) => a.key === "ownerHourlyQr")).toMatchObject({ source: "owner", value: 200 });
    expect(list.find((a) => a.key === "prepHoursPerDay")).toMatchObject({ source: "default" });
  });

  it("team pricing is not linear in athletes: fixed day costs, crew steps, and never two fights per athlete", () => {
    const c5 = computeCostFloor(team(5));
    const c10 = computeCostFloor(team(10));
    const c40 = computeCostFloor(team(40));
    expect(c10.total).toBeLessThan(c5.total * 2);
    expect(c40.total / 40).toBeLessThan(c5.total / 5);
    expect(c40.workload.expectedImages).toBe(40 * DEFAULT_COST_ASSUMPTIONS.imagesPerAthlete * 1);
    expect(DEFAULT_COST_ASSUMPTIONS.matchesPerAthlete).toBe(1);
    // 40 athletes × 1 match × 8 min = 320 match-minutes; one shooter covers 8 h × 60 × 0.7 = 336 → crew by mats (2 ÷ 2 = 1).
    expect(c40.staffing.shooters).toBe(1);
    const c100 = computeCostFloor(team(100, 4));
    expect(c100.staffing.shooters).toBeGreaterThanOrEqual(2);
    expect(c100.lines.find((l) => l.key === "second_shooter")?.amount).toBe((c100.staffing.shooters - 1) * DEFAULT_COST_ASSUMPTIONS.secondShooterDayQr);
    expect(c100.staffing.basis).toMatch(/match-minutes|photographer/);
  });

  it("costs full-match filming, edited highlights and reels differently and only when requested", () => {
    const base = team(10, 2, 8, { wants_videographer: true });
    const full = computeCostFloor({ ...base, videoDeliverables: ["full_match"] });
    const highlights = computeCostFloor({ ...base, videoDeliverables: ["edited_highlights"] });
    const reels = computeCostFloor({ ...base, videoDeliverables: ["reels"] });
    const photoOnly = computeCostFloor({ ...base, media: "photo", videoDeliverables: [] });
    expect(full.lines.map((l) => l.key)).toContain("video_full_match");
    expect(full.lines.map((l) => l.key)).not.toContain("video_highlights");
    expect(highlights.lines.map((l) => l.key)).toContain("video_highlights");
    expect(reels.lines.map((l) => l.key)).toContain("video_reels");
    expect(photoOnly.lines.some((l) => l.key.startsWith("video_") || l.key === "partner_video")).toBe(false);
    // Full matches need a camera per mat (2 videographers); highlights need one.
    expect(full.staffing.videographers).toBe(2);
    expect(highlights.staffing.videographers).toBe(1);
    expect(full.lines.find((l) => l.key === "partner_video")?.amount).toBe(2 * DEFAULT_COST_ASSUMPTIONS.partnerVideographerDayQr);
    expect(new Set([full.total, highlights.total, reels.total, photoOnly.total]).size).toBe(4);
    expect(full.workload.video.fullMatchFootageHours).toBe(16);
    expect(highlights.workload.video.highlights).toBe(1);
  });

  it("uses the request's own image count when given and warns on a tight deadline", () => {
    const c = computeCostFloor({ ...team(10), expectedImages: 300, deadlineDays: 1 });
    expect(c.workload.expectedImages).toBe(300);
    expect(c.lines.find((l) => l.key === "editing_photo")?.hours).toBe(Math.round((300 * DEFAULT_COST_ASSUMPTIONS.editingMinutesPerImage) / 60 * 100) / 100);
    expect(c.warnings.some((w) => /deadline/i.test(w))).toBe(true);
    expect(c.assumptions.some((a) => a.key === "expected_images")).toBe(false);
  });

  it("a portrait session costs a session's images, one shooter, no mats", () => {
    const c = computeCostFloor(extractPricingRequest({ bookingType: "private_session", details: { requested_date: "2026-11-02" } }, NOW));
    expect(c.workload.expectedImages).toBe(DEFAULT_COST_ASSUMPTIONS.imagesPerPortraitSession);
    expect(c.staffing).toMatchObject({ shooters: 1, videographers: 0, crew: 1 });
    expect(c.lines.find((l) => l.key === "shooting")?.hours).toBe(1.5);
  });
});
