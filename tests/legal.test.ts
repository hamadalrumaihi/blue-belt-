import { describe, expect, it } from "vitest";
import { buildPrivacy, PRIVACY_TOPIC_IDS } from "@/lib/legal/privacy";
import { buildTerms, CANCELLATION_TIERS, QATAR_CONSUMER_LAW_SENTENCE, TERMS_TOPIC_IDS } from "@/lib/legal/terms";
import type { LegalDocument } from "@/lib/legal/types";
import { PRIVACY_UPDATED_LABEL, PRIVACY_VERSION, TERMS_UPDATED_LABEL, TERMS_VERSION } from "@/lib/legal/versions";
import { DEFAULT_BUSINESS_IDENTITY } from "@/lib/studio/business";

const VENDOR_RE = /pic[\s-]?time|my\s?fatoorah|fatoorah|docusign/i;

function allText(doc: LegalDocument): string {
  return [doc.title, ...doc.intro, ...doc.sections.flatMap((s) => [s.title, ...s.paragraphs, ...(s.bullets ?? [])])].join("\n");
}

function sectionText(doc: LegalDocument, id: string): string {
  const s = doc.sections.find((x) => x.id === id);
  if (!s) throw new Error(`missing section ${id}`);
  return [s.title, ...s.paragraphs, ...(s.bullets ?? [])].join("\n");
}

describe("legal versions", () => {
  it("are dated and match the labels", () => {
    expect(TERMS_VERSION).toBe("2026-10-08");
    expect(PRIVACY_VERSION).toBe("2026-10-08");
    expect(TERMS_UPDATED_LABEL).toBe("8 October 2026");
    expect(PRIVACY_UPDATED_LABEL).toBe("8 October 2026");
    expect(buildTerms().version).toBe(TERMS_VERSION);
    expect(buildPrivacy().version).toBe(PRIVACY_VERSION);
  });
});

describe("terms", () => {
  const doc = buildTerms(DEFAULT_BUSINESS_IDENTITY);
  const text = allText(doc);

  it("say when they were last updated and carry the business identity, never an address", () => {
    expect(doc.intro[0]).toBe("Last updated 8 October 2026.");
    expect(text).toContain("Blue belt media photography, CR 235175, Doha, Qatar");
    expect(text).toContain("bluebeltmediaqatar@gmail.com");
    expect(text).toContain("30200312");
    expect(text).not.toMatch(/street|building|p\.o\. box|zone \d|iban|qid/i);
  });

  it("cover every required topic with a unique anchor", () => {
    const ids = doc.sections.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of TERMS_TOPIC_IDS) expect(ids).toContain(id);
    for (const s of doc.sections) {
      expect(s.id).toMatch(/^[a-z0-9-]+$/);
      expect(s.title.trim()).not.toBe("");
      expect(s.paragraphs.length).toBeGreaterThan(0);
    }
  });

  it("use generic vendor wording only and no em dashes", () => {
    expect(text).not.toMatch(VENDOR_RE);
    expect(text).not.toContain("—");
    expect(text).toContain("payment provider");
    expect(text).toContain("gallery hosting provider");
    expect(text).toContain("electronic signature provider");
  });

  it("state the deposit flow: 50% before confirmation, 50% after delivery, confirmation needs signature and deposit", () => {
    expect(sectionText(doc, "deposit")).toMatch(/50% of the agreed price is due before the booking is confirmed/);
    expect(sectionText(doc, "balance")).toMatch(/remaining 50% becomes due after we deliver/);
    expect(sectionText(doc, "balance")).toMatch(/nothing is charged automatically/i);
    expect(sectionText(doc, "booking-confirmation")).toMatch(/signed the agreement/);
    expect(sectionText(doc, "booking-confirmation")).toMatch(/50% deposit has been paid/);
  });

  it("carry the exact cancellation tiers", () => {
    const c = sectionText(doc, "cancellations");
    expect(CANCELLATION_TIERS).toHaveLength(5);
    for (const tier of CANCELLATION_TIERS) expect(c).toContain(tier);
    expect(c).toMatch(/7 days or more.*moved once to a new date, subject to availability/);
    expect(c).toMatch(/3 to 6 days.*deposit is retained/);
    expect(c).toMatch(/Less than 72 hours.*no-show.*full agreed amount is due/);
    expect(c).toMatch(/cancelled by the organiser.*new date or a credit first/);
    expect(c).toMatch(/Refunds are made where the law requires it or where we have agreed/);
  });

  it("make every cancellation, refund and liability clause subject to mandatory Qatar consumer law and never waive it", () => {
    expect(QATAR_CONSUMER_LAW_SENTENCE).toBe("Nothing in these terms limits any right you have under mandatory Qatar consumer protection law.");
    for (const id of ["deposit", "cancellation-consumer-law", "refunds", "chargebacks", "liability", "force-majeure", "equipment-data-failure"]) {
      expect(sectionText(doc, id), id).toContain(QATAR_CONSUMER_LAW_SENTENCE);
    }
    expect(sectionText(doc, "consumer-rights")).toMatch(/cannot take away/);
    expect(sectionText(doc, "consumer-rights")).toMatch(/Nothing here asks you to waive a mandatory right/);
    expect(text).not.toMatch(/you waive|waive (all|any|your) (rights|claims)/i);
  });

  it("ask for a lawyer's review and make no guarantees", () => {
    expect(text).toMatch(/reviewed by a Qatar-qualified lawyer/);
    expect(text).not.toMatch(/\bguarantee/i);
    expect(text).not.toMatch(/\bwarrant(y|ies)?\b/i);
  });
});

describe("privacy", () => {
  const doc = buildPrivacy(DEFAULT_BUSINESS_IDENTITY);
  const text = allText(doc);

  it("covers every required topic, vendor-free, without em dashes", () => {
    const ids = doc.sections.map((s) => s.id);
    for (const id of PRIVACY_TOPIC_IDS) expect(ids).toContain(id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(text).not.toMatch(VENDOR_RE);
    expect(text).not.toContain("—");
    expect(doc.intro[0]).toBe("Last updated 8 October 2026.");
  });

  it("says card numbers are never stored and only metadata is kept", () => {
    expect(sectionText(doc, "payment-metadata")).toContain("We never store card numbers.");
    expect(sectionText(doc, "payment-metadata")).toMatch(/payment metadata/);
  });

  it("names the identity, the rights contact and the Qatar context", () => {
    expect(text).toContain("Blue belt media photography, CR 235175, Doha, Qatar");
    expect(sectionText(doc, "your-rights")).toContain("bluebeltmediaqatar@gmail.com");
    expect(sectionText(doc, "qatar-context")).toMatch(/Qatar law/);
    expect(sectionText(doc, "analytics")).toMatch(/If analytics are enabled/);
    expect(text).toMatch(/reviewed by a Qatar-qualified lawyer/);
  });
});
