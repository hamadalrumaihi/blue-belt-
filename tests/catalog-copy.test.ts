import { describe, expect, it } from "vitest";
import { allCatalogCopy, AUDIENCE_COPY, cleanPublicDescription, MEDIA_SCOPE_COPY, mediaCategoryLabel, PAYMENT_POLICY, PROJECT_CATEGORY_COPY, SERVICE_COPY, VIDEO_DELIVERABLE_COPY } from "@/lib/catalog/copy";
import { applyFaqOverrides, buildFaqJsonLd, competitionFaqs, FAQ_CATEGORIES, FAQ_ITEMS, faqById, faqsForService, featuredFaqs, filterFaqs, normalizeForSearch, OPEN_POLICY_QUESTIONS } from "@/lib/catalog/faq";
import { AUDIENCES, MEDIA_SCOPES, PROJECT_CATEGORIES, PROJECT_CATEGORY_DEFINITIONS, SERVICE_DEFINITIONS, SERVICES, VIDEO_DELIVERABLES } from "@/lib/catalog/index";
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

  it("names the video deliverables explicitly, defaults to no music, and never offers raw footage", () => {
    expect(VIDEO_DELIVERABLE_COPY.full_match.description.en).toMatch(/start to finish|first grip/i);
    expect(VIDEO_DELIVERABLE_COPY.edited_highlights.description.en).toMatch(/without music/i);
    expect(VIDEO_DELIVERABLE_COPY.reels.description.en).toMatch(/without music/i);
    expect(VIDEO_DELIVERABLES).not.toContain("raw_footage");
    expect(Object.keys(VIDEO_DELIVERABLE_COPY)).not.toContain("raw_footage");
    for (const key of SERVICES) {
      expect(SERVICE_DEFINITIONS[key].videoDeliverables).not.toContain("raw_footage");
      for (const d of SERVICE_DEFINITIONS[key].videoDeliverables) expect(VIDEO_DELIVERABLE_COPY[d]).toBeDefined();
      // Every service tells the customer, in both languages, that raw footage is not provided.
      expect(SERVICE_COPY[key].videoDeliverables.en.join(" ")).toMatch(/raw footage[^.]*not provided/i);
      expect(SERVICE_COPY[key].videoDeliverables.ar?.join(" ")).toMatch(/الخام/);
    }
  });

  it("describes the six project categories in both languages and routes the quoted ones to the inquiry form", () => {
    expect(PROJECT_CATEGORIES).toEqual(["tournament_event", "athlete", "clubs_teams", "photography", "videography", "custom"]);
    for (const c of PROJECT_CATEGORIES) {
      expect(PROJECT_CATEGORY_COPY[c].items.en.length).toBeGreaterThan(3);
      expect(PROJECT_CATEGORY_COPY[c].items.ar?.length).toBe(PROJECT_CATEGORY_COPY[c].items.en.length);
    }
    expect(PROJECT_CATEGORY_DEFINITIONS.photography.services).toEqual([]);
    expect(PROJECT_CATEGORY_DEFINITIONS.videography.services).toEqual([]);
    expect(PROJECT_CATEGORY_DEFINITIONS.custom).toMatchObject({ services: [], inquiry: "commercial_creative" });
    expect(PROJECT_CATEGORY_DEFINITIONS.tournament_event.services[0]).toBe("tournament_athlete");
    expect(PROJECT_CATEGORY_DEFINITIONS.clubs_teams.inquiry).toBe("club_team");
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
    // Payment stays flexible: no fixed deposit share anywhere in the offer copy, and the approved sentence is what every service says.
    expect(text).not.toMatch(/50\s?%/);
    expect(text).not.toMatch(/raw footage can be booked|the unedited recordings, for your own editor/i);
    expect(PAYMENT_POLICY.en).toBe("Submitting an inquiry or booking request does not require payment. Once the scope and pricing are confirmed, a deposit or full advance payment may be required to secure your booking, as specified in your quotation or agreement.");
    expect(SERVICE_COPY.tournament_athlete.paymentSteps.en.join(" ")).toMatch(/deposit or full advance payment may be required/);
    expect(SERVICE_COPY.tournament_athlete.paymentSteps.ar?.join(" ")).toMatch(/عربون أو دفعة مقدمة كاملة/);
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
    // A short list on purpose: the competition essentials plus payment and public galleries. Everything else goes through Contact & Inquiries.
    expect(FAQ_ITEMS.length).toBeLessThanOrEqual(14);
  });

  it("keeps the ten competition conditions, in the brief's order, plus payment and public galleries, and drops the removed topics", () => {
    expect(competitionFaqs().map((f) => f.id)).toEqual(["wins-losses", "one-match-no-match", "athlete-identification", "every-match", "club-team-coverage", "separate-bookings", "raw-footage", "venue-access", "no-show", "postponed-cancelled"]);
    for (const id of ["payment", "public-gallery"]) expect(faqById(id), id).not.toBeNull();
    for (const removed of ["training-location", "revisions", "watermarks-downloads", "missing-photos", "client-login", "contact-method", "private-sessions", "sponsor-club-usage", "organizer-access"]) expect(faqById(removed), removed).toBeNull();
    expect(featuredFaqs(4)).toHaveLength(4);
  });

  it("preserves the customer protections and the meaning of each condition", () => {
    const en = (id: string) => faqById(id)!.answer.en;
    expect(en("wins-losses")).toMatch(/regardless of the result/i);
    expect(en("wins-losses")).toMatch(/does not promise a particular number of matches/i);
    expect(en("one-match-no-match")).toMatch(/single match still counts as a booking/i);
    expect(en("one-match-no-match")).toMatch(/cannot promise that warm-up or podium footage will always exist/i);
    expect(en("athlete-identification")).toMatch(/registered name, academy and division/i);
    expect(en("every-match")).toMatch(/cannot promise every match/i);
    expect(en("every-match")).toMatch(/does not automatically mean/i);
    expect(en("club-team-coverage")).toMatch(/roster/i);
    expect(en("club-team-coverage")).toMatch(/crew size and image counts per athlete are not promised/i);
    expect(en("separate-bookings")).toMatch(/One individual athlete is one booking/);
    expect(en("separate-bookings")).toMatch(/not automatically applied to a team/i);
    expect(en("raw-footage")).toMatch(/^No\./);
    expect(en("raw-footage")).toMatch(/RAW photo files and unedited source material are not included or provided/);
    expect(en("venue-access")).toMatch(/cannot be promised without the necessary permission/i);
    expect(en("no-show")).toMatch(/written quotation and booking agreement/i);
    expect(en("postponed-cancelled")).toMatch(/cannot promise automatic rescheduling/i);
    expect(en("payment")).toContain(PAYMENT_POLICY.en);
    expect(en("public-gallery")).toMatch(/depends on whether a gallery was created and published/i);
    expect(faqById("raw-footage")!.answer.ar).toMatch(/RAW/);
  });

  it("lists the unsettled policies for the owner", () => {
    const ids = OPEN_POLICY_QUESTIONS.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ["deposit-structure", "turnaround", "cancellation", "no-show", "usage-licence", "custom-projects"]) expect(ids).toContain(id);
    for (const q of OPEN_POLICY_QUESTIONS) {
      expect(q.question.trim()).not.toBe("");
      expect(q.where.trim()).not.toBe("");
    }
  });

  it("searches both languages and filters by category", () => {
    expect(normalizeForSearch("  Édited  HIGHLIGHTS ")).toBe("edited highlights");
    expect(normalizeForSearch("أبرزُ اللقطاتِ")).toBe("ابرز اللقطات");
    expect(filterFaqs(FAQ_ITEMS, "unedited").map((f) => f.id)).toContain("raw-footage");
    expect(filterFaqs(FAQ_ITEMS, "الخام").map((f) => f.id)).toContain("raw-footage");
    expect(filterFaqs(FAQ_ITEMS, "", "payment").every((f) => f.category === "payment")).toBe(true);
    expect(filterFaqs(FAQ_ITEMS, "", "payment").length).toBe(1);
    expect(filterFaqs(FAQ_ITEMS, "zzzz-nothing")).toEqual([]);
    expect(filterFaqs(FAQ_ITEMS, "")).toHaveLength(FAQ_ITEMS.length);
  });

  it("merges the owner's published overrides: same id replaces in place, new ids are appended, Arabic falls back to English", () => {
    const merged = applyFaqOverrides(FAQ_ITEMS, [
      { id: "no-show", question_en: "No-show?", answer_en: "Half the fee is retained.", question_ar: null, answer_ar: null, category: "delivery", published: true, updated_at: null },
      { id: "parking", question_en: "Where do we park?", answer_en: "At the venue.", question_ar: "أين نوقف السيارة؟", answer_ar: "في الصالة.", category: "tournaments", published: true, updated_at: null },
    ]);
    expect(merged).toHaveLength(FAQ_ITEMS.length + 1);
    const index = FAQ_ITEMS.findIndex((f) => f.id === "no-show");
    expect(merged[index]).toMatchObject({ id: "no-show", category: "booking", competition: true, question: { en: "No-show?" }, answer: { en: "Half the fee is retained." } });
    expect(merged[index].answer.ar).toBeUndefined();
    expect(merged.at(-1)).toMatchObject({ id: "parking", category: "coverage", competition: true, question: { ar: "أين نوقف السيارة؟" } });
    expect(competitionFaqs(merged).map((f) => f.id)).toContain("parking");
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
