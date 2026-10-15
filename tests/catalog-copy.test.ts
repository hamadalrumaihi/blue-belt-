import { describe, expect, it } from "vitest";
import { allCatalogCopy, AUDIENCE_COPY, cleanPublicDescription, MEDIA_SCOPE_COPY, mediaCategoryLabel, SERVICE_COPY, VIDEO_DELIVERABLE_COPY } from "@/lib/catalog/copy";
import { applyFaqOverrides, buildFaqJsonLd, FAQ_CATEGORIES, FAQ_ITEMS, faqById, faqsForService, featuredFaqs, filterFaqs, normalizeForSearch, OPEN_POLICY_QUESTIONS } from "@/lib/catalog/faq";
import { AUDIENCES, MEDIA_SCOPES, SERVICE_DEFINITIONS, SERVICES, VIDEO_DELIVERABLES } from "@/lib/catalog/index";
import { BOOK_UI, UI } from "@/lib/i18n/ui";

const ARABIC = /[؀-ۿ]/;
const EM_DASH = "—";

function strings(value: string | string[]): string[] {
  return Array.isArray(value) ? value : [value];
}

describe("catalog copy", () => {
  it("has English and Arabic for every audience, service, media scope, video deliverable and category, with no empty strings", () => {
    const entries = allCatalogCopy();
    expect(entries.length).toBeGreaterThan(80);
    for (const { path, value } of entries) {
      expect(value.en, path).toBeDefined();
      expect(value.ar, `${path} has no Arabic`).toBeDefined();
      const en = strings(value.en);
      const ar = strings(value.ar as string | string[]);
      expect(en.length, path).toBeGreaterThan(0);
      expect(ar.length, path).toBe(en.length);
      for (const s of en) {
        expect(s.trim().length, path).toBeGreaterThan(0);
        expect(s, `${path} English contains Arabic`).not.toMatch(ARABIC);
      }
      for (const s of ar) {
        expect(s.trim().length, path).toBeGreaterThan(0);
        expect(s, `${path} Arabic is not Arabic`).toMatch(ARABIC);
      }
    }
  });

  it("covers every catalog key", () => {
    for (const a of AUDIENCES) expect(AUDIENCE_COPY[a].title.en).toBeTruthy();
    for (const s of SERVICES) expect(SERVICE_COPY[s].title.en).toBeTruthy();
    for (const m of MEDIA_SCOPES) expect(MEDIA_SCOPE_COPY[m].title.en).toBeTruthy();
    for (const v of VIDEO_DELIVERABLES) expect(VIDEO_DELIVERABLE_COPY[v].description.en).toBeTruthy();
  });

  it("gives every service the full section set and only known FAQ ids", () => {
    for (const key of SERVICES) {
      const c = SERVICE_COPY[key];
      for (const section of ["intendedClient", "whatWeShoot", "photoDeliverables", "videoDeliverables", "needFromYou", "bookingSteps", "paymentSteps", "permittedUse", "limitations"] as const) {
        expect(c[section].en.length, `${key}.${section}`).toBeGreaterThan(1);
        expect(c[section].ar?.length, `${key}.${section}`).toBe(c[section].en.length);
      }
      expect(c.faqIds.length).toBeGreaterThan(3);
      for (const id of c.faqIds) expect(faqById(id), `${key} references unknown FAQ ${id}`).not.toBeNull();
      expect(faqsForService(key, c.faqIds)).toHaveLength(c.faqIds.length);
      expect(c.metaDescription.en.length).toBeLessThanOrEqual(170);
    }
  });

  it("names the video deliverables explicitly and defaults to no music", () => {
    expect(VIDEO_DELIVERABLE_COPY.full_match.description.en).toMatch(/start to finish|first grip/i);
    expect(VIDEO_DELIVERABLE_COPY.edited_highlights.description.en).toMatch(/without music/i);
    expect(VIDEO_DELIVERABLE_COPY.reels.description.en).toMatch(/without music/i);
    expect(VIDEO_DELIVERABLE_COPY.raw_footage.description.en).toMatch(/unedited|as shot/i);
    for (const key of SERVICES) {
      for (const d of SERVICE_DEFINITIONS[key].videoDeliverables) expect(VIDEO_DELIVERABLE_COPY[d]).toBeDefined();
    }
  });

  it("states only approved policies and never a price, a phone number, a promise or a vendor name", () => {
    const all = [...allCatalogCopy().flatMap(({ value }) => [...strings(value.en), ...strings((value.ar ?? value.en) as string | string[])]), ...FAQ_ITEMS.flatMap((f) => [f.question.en, f.answer.en, f.question.ar ?? "", f.answer.ar ?? ""])];
    const text = all.join("\n");
    expect(text).not.toContain(EM_DASH);
    expect(text).not.toMatch(/\d+\s?QAR|QAR\s?\d+|ريال/);
    expect(text).not.toMatch(/\bguaranteed\b/i);
    expect(text).not.toMatch(/set your price/i);
    expect(text).not.toMatch(/pic-?time|fatoorah|docusign|whatsapp business/i);
    expect(text).not.toMatch(/\+?974[\s-]?\d{4}[\s-]?\d{4}/);
    expect(text).not.toMatch(/within 24 hours|same day delivery/i);
    // The approved policies are present, in both languages.
    expect(SERVICE_COPY.tournament_athlete.paymentSteps.en.join(" ")).toMatch(/50% deposit/);
    expect(SERVICE_COPY.tournament_athlete.paymentSteps.ar?.join(" ")).toMatch(/50%/);
    expect(SERVICE_COPY.tournament_athlete.limitations.en.join(" ")).toMatch(/cannot promise every match/i);
    expect(SERVICE_COPY.tournament_athlete.bookingSteps.en.join(" ")).toMatch(/not a confirmed booking/i);
  });

  it("strips the pricing placeholder from database descriptions", () => {
    expect(cleanPublicDescription("Set your price.")).toBeNull();
    expect(cleanPublicDescription("One athlete, one day. Set your price. Photos only.")).toBe("One athlete, one day. Photos only.");
    expect(cleanPublicDescription("  Edited photos in a gallery  ")).toBe("Edited photos in a gallery");
    expect(cleanPublicDescription(null)).toBeNull();
  });

  it("labels media categories in both languages and humanises unknown ones", () => {
    expect(mediaCategoryLabel("tournament_action", "en")).toBe("Tournament action");
    expect(mediaCategoryLabel("tournament_action", "ar")).toMatch(ARABIC);
    expect(mediaCategoryLabel("open_mat", "en")).toBe("Open mat");
  });
});

describe("FAQ", () => {
  it("has unique ids, a known category, and English and Arabic for every question and answer", () => {
    const ids = FAQ_ITEMS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const f of FAQ_ITEMS) {
      expect(FAQ_CATEGORIES).toContain(f.category);
      expect(f.question.en.trim()).not.toBe("");
      expect(f.answer.en.trim()).not.toBe("");
      expect(f.question.ar, `${f.id} question has no Arabic`).toMatch(ARABIC);
      expect(f.answer.ar, `${f.id} answer has no Arabic`).toMatch(ARABIC);
      expect(f.question.en).not.toMatch(ARABIC);
      expect(f.answer.en).not.toMatch(ARABIC);
    }
    expect(FAQ_ITEMS.length).toBeGreaterThanOrEqual(25);
  });

  it("covers the brief's question list", () => {
    for (const id of ["photo-vs-video", "full-match-vs-highlights", "gi-nogi-divisions", "wins-losses-elimination", "one-match-no-match", "athlete-identification", "simultaneous-mats", "booking-child", "team-roster", "coach-academy-content", "organizer-access", "venue-restrictions", "private-sessions", "training-location", "sponsor-club-usage", "delivery-timing", "revisions", "raw-files", "watermarks-downloads", "find-buy-photos", "missing-photos", "payment-status", "payment-check", "client-login", "cancellation", "no-show", "privacy-publication"]) {
      expect(faqById(id), id).not.toBeNull();
    }
    expect(featuredFaqs(4)).toHaveLength(4);
  });

  it("answers unsettled policies conservatively and lists them for the owner", () => {
    expect(faqById("revisions")?.answer.en).toMatch(/written quote/i);
    expect(faqById("cancellation")?.answer.en).toMatch(/written quote/i);
    expect(faqById("private-sessions")?.answer.en).toMatch(/staffing is confirmed/i);
    expect(faqById("delivery-timing")?.answer.en).toMatch(/as agreed/i);
    const ids = OPEN_POLICY_QUESTIONS.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ["turnaround", "revisions", "cancellation", "no-show", "response-time", "female-staffing", "usage-licence"]) expect(ids).toContain(id);
    for (const q of OPEN_POLICY_QUESTIONS) {
      expect(q.question.trim()).not.toBe("");
      expect(q.where.trim()).not.toBe("");
    }
  });

  it("searches both languages and filters by category", () => {
    expect(normalizeForSearch("  Édited  HIGHLIGHTS ")).toBe("edited highlights");
    expect(normalizeForSearch("أبرزُ اللقطاتِ")).toBe("ابرز اللقطات");
    expect(filterFaqs(FAQ_ITEMS, "highlights").map((f) => f.id)).toContain("full-match-vs-highlights");
    expect(filterFaqs(FAQ_ITEMS, "اللقطات").map((f) => f.id)).toContain("full-match-vs-highlights");
    expect(filterFaqs(FAQ_ITEMS, "", "payment").every((f) => f.category === "payment")).toBe(true);
    expect(filterFaqs(FAQ_ITEMS, "", "payment").length).toBeGreaterThan(2);
    expect(filterFaqs(FAQ_ITEMS, "zzzz-nothing")).toEqual([]);
    expect(filterFaqs(FAQ_ITEMS, "")).toHaveLength(FAQ_ITEMS.length);
  });

  it("merges the owner's published overrides: same id replaces in place, new ids are appended, Arabic falls back to English", () => {
    const merged = applyFaqOverrides(FAQ_ITEMS, [
      { id: "revisions", question_en: "Revisions?", answer_en: "Two rounds are included.", question_ar: null, answer_ar: null, category: "delivery", published: true, updated_at: null },
      { id: "parking", question_en: "Where do we park?", answer_en: "At the venue.", question_ar: "أين نوقف السيارة؟", answer_ar: "في الصالة.", category: "tournaments", published: true, updated_at: null },
    ]);
    expect(merged).toHaveLength(FAQ_ITEMS.length + 1);
    const index = FAQ_ITEMS.findIndex((f) => f.id === "revisions");
    expect(merged[index]).toMatchObject({ id: "revisions", category: "delivery", question: { en: "Revisions?" }, answer: { en: "Two rounds are included." } });
    expect(merged[index].answer.ar).toBeUndefined();
    expect(merged.at(-1)).toMatchObject({ id: "parking", category: "coverage", question: { ar: "أين نوقف السيارة؟" } });
    expect(applyFaqOverrides(FAQ_ITEMS, [])).toEqual([...FAQ_ITEMS]);
  });

  it("builds FAQPage structured data in either language from the same items", () => {
    const en = buildFaqJsonLd("en");
    const ar = buildFaqJsonLd("ar");
    expect(en["@type"]).toBe("FAQPage");
    expect(en.inLanguage).toBe("en");
    expect(ar.inLanguage).toBe("ar");
    const enQ = en.mainEntity as Array<{ name: string; acceptedAnswer: { text: string } }>;
    const arQ = ar.mainEntity as Array<{ name: string; acceptedAnswer: { text: string } }>;
    expect(enQ).toHaveLength(FAQ_ITEMS.length);
    expect(arQ).toHaveLength(FAQ_ITEMS.length);
    expect(enQ[0].name).toBe(FAQ_ITEMS[0].question.en);
    expect(arQ[0].name).toBe(FAQ_ITEMS[0].question.ar);
    expect(JSON.stringify(en)).not.toMatch(/pic-?time|fatoorah|docusign/i);
  });
});

describe("interface strings", () => {
  it("have Arabic for every English string", () => {
    const missing: string[] = [];
    const walk = (node: unknown, path: string) => {
      if (!node || typeof node !== "object") return;
      const obj = node as Record<string, unknown>;
      if (typeof obj.en === "string") {
        if (typeof obj.ar !== "string" || !obj.ar.trim()) missing.push(path);
        else if (!ARABIC.test(obj.ar)) missing.push(`${path} (not Arabic)`);
        else if (!obj.en.trim()) missing.push(`${path} (empty English)`);
        return;
      }
      for (const [k, v] of Object.entries(obj)) walk(v, `${path}.${k}`);
    };
    walk(UI, "UI");
    walk(BOOK_UI, "BOOK_UI");
    expect(missing).toEqual([]);
    expect(BOOK_UI.done.next).toHaveLength(3);
  });
});
