import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { IMPORT_CSV_HEADER, parseCsv, parseReferenceImport } from "@/lib/pricing/import";
import { referenceNeedsReverification, validatePriceReference } from "@/lib/pricing/form";
import { seedRows } from "./pricing-seed";

const NOW = new Date("2026-10-15T09:00:00.000Z");

describe("seed dataset", () => {
  it("has 20 valid, distinct observations from 15 Oct 2026, all in Qatar, with the known exclusions and re-verification flags", () => {
    const rows = seedRows();
    expect(rows).toHaveLength(20);
    expect(new Set(rows.map((r) => r.seed_key)).size).toBe(20);
    expect(rows.every((r) => r.region === "qatar" && r.observed_on === "2026-10-15" && r.currency === "QAR")).toBe(true);
    const amoon = rows.find((r) => r.provider === "AMOON")!;
    expect(amoon).toMatchObject({ excluded: true, comparable_scope: "managed_social" });
    expect(amoon.excluded_reason).toMatch(/managed social/i);
    const ghassen = rows.filter((r) => r.provider === "Ghassen Oueslati");
    expect(ghassen).toHaveLength(3);
    expect(ghassen.every((r) => r.source_type === "search_index" && r.confidence === "unverified")).toBe(true);
    expect(rows.filter((r) => r.provider === "Shutter Qatar").every((r) => r.confidence === "unverified")).toBe(true);
    expect(rows.filter((r) => r.comparable_scope === "sports_event_athlete")).toHaveLength(0);
    expect(rows.filter((r) => referenceNeedsReverification(r, NOW)).map((r) => r.provider)).toEqual(expect.arrayContaining(["Shutter Qatar", "Litrato Qatar", "Ghassen Oueslati"]));
    expect(rows.find((r) => r.seed_key?.startsWith("share-agency-video"))?.deliverables).toMatch(/not full reels/i);
  });

  it("the raw seed file carries every field the schema has, so the owner script and the UI import agree", () => {
    const doc = JSON.parse(readFileSync(join(__dirname, "..", "scripts/pricing/seed-references.json"), "utf8"));
    const keys = ["seed_key", "provider", "source_url", "observed_on", "checked_on", "location", "region", "service_type", "comparable_scope", "media_type", "price_from", "price_to", "currency", "duration_hours", "staffing_count", "athlete_count", "includes", "deliverables", "editing_revisions", "usage_rights", "travel_tax_notes", "promotion_expires_on", "source_type", "confidence", "excluded", "excluded_reason", "notes"];
    for (const r of doc.references) for (const k of keys) expect(r, `${r.seed_key} has ${k}`).toHaveProperty(k);
  });
});

describe("parseReferenceImport", () => {
  it("accepts the seed JSON verbatim", () => {
    const text = readFileSync(join(__dirname, "..", "scripts/pricing/seed-references.json"), "utf8");
    const p = parseReferenceImport(text, NOW);
    expect(p.error).toBeNull();
    expect(p.format).toBe("json");
    expect(p.records.filter((r) => r.values).length).toBe(20);
  });

  it("accepts a CSV with the documented header and reports per-row errors", () => {
    const csv = [IMPORT_CSV_HEADER, 'k1,"Acme, Studio",https://acme.example/p,2026-10-10,Doha,qatar,private_session,portrait_session,photo,800,,QAR,1,,8,,no,"8 edited photos",,,,provider_site,likely,false,,"line one"', "k2,Broken,,2026-10-10,Doha,qatar,wedding,,photo,abc,,,,,,,,,,,,provider_site,likely,true,,"].join("\n");
    const p = parseReferenceImport(csv, NOW);
    expect(p.error).toBeNull();
    expect(p.format).toBe("csv");
    expect(p.records[0].values).toMatchObject({ provider: "Acme, Studio", seed_key: "k1", price_from: 800, duration_hours: 1, includes: { photos: 8, video: false, hours: 1 }, media_type: "photo", comparable_scope: "portrait_session", notes: "line one" });
    expect(p.records[1].values).toBeNull();
    expect(p.records[1].fieldErrors).toMatchObject({ service_type: expect.any(String), price_from: expect.any(String), excluded_reason: expect.any(String) });
  });

  it("rejects empty, malformed and oversized input with a message", () => {
    expect(parseReferenceImport("", NOW).error).toMatch(/paste/i);
    expect(parseReferenceImport("{not json", NOW).error).toMatch(/not a JSON array/i);
    expect(parseReferenceImport("[]", NOW).error).toMatch(/no records/i);
    expect(parseReferenceImport("only,a,header", NOW).error).toMatch(/header row/i);
    expect(parseReferenceImport(JSON.stringify(Array.from({ length: 501 }, () => ({}))), NOW).error).toMatch(/500/);
  });

  it("parseCsv handles quotes, doubled quotes and CRLF", () => {
    expect(parseCsv('a,b\r\n"x, y","say ""hi"""\n')).toEqual([["a", "b"], ["x, y", 'say "hi"']]);
  });
});

describe("validatePriceReference (observation fields)", () => {
  it("defaults observed_on to the check date, confidence to unverified, region to Qatar; derives media from includes.video", () => {
    const r = validatePriceReference({ provider: "X", service_type: "club", price_from: 500, includes: { video: true, hours: 2 } }, NOW);
    expect(r.values).toMatchObject({ observed_on: "2026-10-15", checked_on: "2026-10-15", confidence: "unverified", region: "qatar", source_type: "other", media_type: "photo_video", duration_hours: 2, excluded: false, excluded_reason: null, comparable_scope: null, seed_key: null });
  });

  it("requires a reason when excluded and validates every enum and date", () => {
    const r = validatePriceReference({ provider: "X", service_type: "club", price_from: 500, excluded: true, source_type: "rumour", confidence: "sure", region: "mars", media_type: "hologram", comparable_scope: "nope", observed_on: "2026-13-01", promotion_expires_on: "x", seed_key: "has space", staffing_count: 1.5, currency: "QARR" }, NOW);
    expect(r.values).toBeNull();
    expect(Object.keys(r.fieldErrors).sort()).toEqual(["comparable_scope", "confidence", "currency", "excluded_reason", "media_type", "observed_on", "promotion_expires_on", "region", "seed_key", "source_type", "staffing_count"]);
  });
});
