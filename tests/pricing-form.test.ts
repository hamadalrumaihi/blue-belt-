import { describe, expect, it } from "vitest";
import { DEFAULT_MARGIN_PERCENT, includesSummary, parseChosenAmount, parsePriceReferenceForm, parseQuoteInputs, priceReferenceIncludes, quoteInputsFromJson, validateQuoteInputs } from "@/lib/pricing/form";

const NOW = new Date("2026-10-06T09:00:00.000Z");

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe("parsePriceReferenceForm", () => {
  it("parses a full reference with includes", () => {
    const r = parsePriceReferenceForm(
      fd({ provider: " Doha Sports Photo ", source_url: "https://example.com/prices", checked_on: "2026-09-30", location: "Doha", service_type: "tournament_athlete", price_from: "1,200", price_to: "1500.50", includes_hours: "4", includes_athletes: "1", includes_photos: "80", includes_video: "no", includes_editing_hours: "2.5", includes_delivery_days: "7", includes_raw_files: "on", notes: "Weekend rate" }),
      NOW,
    );
    expect(r.fieldErrors).toEqual({});
    expect(r.values).toEqual({
      provider: "Doha Sports Photo",
      source_url: "https://example.com/prices",
      checked_on: "2026-09-30",
      location: "Doha",
      service_type: "tournament_athlete",
      price_from: 1200,
      price_to: 1500.5,
      currency: "QAR",
      includes: { hours: 4, athletes: 1, photos: 80, video: false, editing_hours: 2.5, delivery_days: 7, raw_files: true },
      notes: "Weekend rate",
    });
  });

  it("defaults the check date to today and leaves unstated scope out", () => {
    const r = parsePriceReferenceForm(fd({ provider: "X", service_type: "club", price_from: "0", includes_video: "unknown" }), NOW);
    expect(r.fieldErrors).toEqual({});
    expect(r.values).toMatchObject({ checked_on: "2026-10-06", price_from: 0, price_to: null, source_url: null, location: null, notes: null, includes: {} });
  });

  it("rejects a missing provider, a bad link, a future or impossible date, a bad type, a negative price and a range upside down", () => {
    const r = parsePriceReferenceForm(fd({ provider: "", source_url: "ftp://x", checked_on: "2026-10-07", service_type: "wedding", price_from: "-1", price_to: "abc", includes_hours: "x", includes_athletes: "1.5", includes_video: "maybe" }), NOW);
    expect(r.values).toBeNull();
    expect(r.fieldErrors).toMatchObject({ provider: expect.any(String), source_url: expect.any(String), checked_on: expect.stringMatching(/future/), service_type: expect.any(String), price_from: expect.any(String), price_to: expect.any(String), includes_hours: expect.any(String), includes_athletes: expect.stringMatching(/whole number/), includes_video: expect.any(String) });
    expect(parsePriceReferenceForm(fd({ provider: "X", service_type: "club", price_from: "500", price_to: "400" }), NOW).fieldErrors.price_to).toMatch(/below the lower/);
    expect(parsePriceReferenceForm(fd({ provider: "X", service_type: "club", price_from: "500", checked_on: "2026-02-30" }), NOW).fieldErrors.checked_on).toMatch(/real date/);
    expect(parsePriceReferenceForm(fd({ provider: "X", service_type: "club" }), NOW).fieldErrors.price_from).toMatch(/enter the price/i);
  });

  it("caps the lengths", () => {
    const r = parsePriceReferenceForm(fd({ provider: "p".repeat(121), service_type: "club", price_from: "1", location: "l".repeat(121), notes: "n".repeat(1001), source_url: `https://example.com/${"a".repeat(500)}` }), NOW);
    expect(r.fieldErrors).toMatchObject({ provider: expect.stringMatching(/120/), location: expect.stringMatching(/120/), notes: expect.stringMatching(/1000/), source_url: expect.any(String) });
  });
});

describe("priceReferenceIncludes / includesSummary", () => {
  it("drops unknown keys and wrong types, keeps three-way video", () => {
    expect(priceReferenceIncludes({ includes: { hours: 3, athletes: "2", video: false, raw_files: "yes", travel_included: true, extra: 1 } })).toEqual({ hours: 3, video: false, travel_included: true });
    expect(priceReferenceIncludes({ includes: null })).toEqual({});
    expect(priceReferenceIncludes({ includes: [1] })).toEqual({});
  });

  it("summarises the scope in plain words without em dashes", () => {
    const s = includesSummary({ hours: 2, athletes: 1, photos: 60, video: true, editing_hours: 1, delivery_days: 5, raw_files: true, travel_included: true });
    expect(s).toBe("2 h · 1 athlete · 60 photos · video · 1 h editing · 5-day delivery · RAW files · travel included");
    expect(includesSummary({ video: false })).toBe("photo only");
    expect(includesSummary({})).toBe("");
  });
});

describe("parseQuoteInputs / validateQuoteInputs", () => {
  it("parses a full job and defaults the margin", () => {
    const r = parseQuoteInputs(fd({ service_type: "club", hours: "6", athletes: "12", photos_expected: "300", video: "on", editing_hours: "4", travel_km: "35", video_partner_cost_qr: "800", other_costs_qr: "100", target_hourly_qr: "250", notes: "Two mats" }));
    expect(r.fieldErrors).toEqual({});
    expect(r.values).toEqual({ service_type: "club", hours: 6, athletes: 12, photos_expected: 300, video: true, editing_hours: 4, travel_km: 35, travel_cost_qr: null, video_partner_cost_qr: 800, other_costs_qr: 100, margin_percent: DEFAULT_MARGIN_PERCENT, target_hourly_qr: 250, notes: "Two mats" });
  });

  it("accepts numbers and booleans from JSON (stored inputs) as well as strings", () => {
    const r = validateQuoteInputs({ service_type: "private_session", hours: 1.5, video: true, margin_percent: 0, travel_cost_qr: "120" });
    expect(r.values).toMatchObject({ service_type: "private_session", hours: 1.5, video: true, margin_percent: 0, travel_cost_qr: 120, athletes: null });
    expect(quoteInputsFromJson({ service_type: "custom", margin_percent: 10 })).toMatchObject({ service_type: "custom", margin_percent: 10 });
    expect(quoteInputsFromJson({ inputs: { service_type: "custom" } })).toMatchObject({ service_type: "custom" });
    expect(quoteInputsFromJson({ service_type: "nope" })).toBeNull();
    expect(quoteInputsFromJson("x")).toBeNull();
  });

  it("rejects a bad type, negative or non-integer counts, an out-of-range margin and long notes", () => {
    const r = parseQuoteInputs(fd({ service_type: "x", hours: "-1", athletes: "2.5", photos_expected: "abc", editing_hours: "1e9", margin_percent: "301", notes: "n".repeat(1001) }));
    expect(r.values).toBeNull();
    expect(r.fieldErrors).toMatchObject({ service_type: expect.any(String), hours: expect.any(String), athletes: expect.stringMatching(/whole number/), photos_expected: expect.any(String), editing_hours: expect.any(String), margin_percent: expect.stringMatching(/0 and 300/), notes: expect.stringMatching(/1000/) });
    expect(validateQuoteInputs({ service_type: "club", margin_percent: -1 }).fieldErrors.margin_percent).toBeTruthy();
    expect(validateQuoteInputs({ service_type: "club", margin_percent: 300 }).values?.margin_percent).toBe(300);
  });
});

describe("parseChosenAmount", () => {
  it("accepts a positive amount (with commas) and refuses zero, negatives, junk and absurd values", () => {
    expect(parseChosenAmount("1,250.5")).toEqual({ ok: true, amount: 1250.5 });
    expect(parseChosenAmount(900)).toEqual({ ok: true, amount: 900 });
    for (const bad of ["0", "-5", "abc", "", 0, -1, NaN, Infinity]) expect(parseChosenAmount(bad)).toMatchObject({ ok: false, error: expect.stringMatching(/above 0/) });
    expect(parseChosenAmount(1_000_001)).toMatchObject({ ok: false, error: expect.stringMatching(/or less/) });
  });
});
