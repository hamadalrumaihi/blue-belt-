import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CompetitionFaq } from "@/components/public/CompetitionFaq";
import { Testimonials } from "@/components/public/Testimonials";
import { competitionFaqs } from "@/lib/catalog/faq";

describe("Before you book: competition coverage", () => {
  it("renders every competition condition as an expandable question in either language, with an inquiry link", () => {
    const en = renderToStaticMarkup(createElement(CompetitionFaq, { items: competitionFaqs(), locale: "en", from: "/book" }));
    expect(en).toContain('id="before-you-book"');
    expect(en).toContain("Do you shoot losses as well as wins?");
    expect(en).toContain("Do you provide raw footage or unedited files?");
    expect((en.match(/<details/g) ?? []).length).toBe(10);
    expect(en).toContain("/contact?type=booking_question&amp;from=%2Fbook");
    const ar = renderToStaticMarkup(createElement(CompetitionFaq, { items: competitionFaqs(), locale: "ar" }));
    expect(ar).toContain("هل تصورون الخسارة كما تصورون الفوز؟");
    expect(ar).not.toContain("Do you shoot losses");
    expect(renderToStaticMarkup(createElement(CompetitionFaq, { items: [], locale: "en" }))).toBe("");
  });

  it("sits on the booking page and the competition service pages, and the old FAQ explorer is gone", () => {
    const book = readFileSync(new URL("../src/app/(public)/book/page.tsx", import.meta.url), "utf8");
    const service = readFileSync(new URL("../src/app/(public)/services/[slug]/page.tsx", import.meta.url), "utf8");
    const how = readFileSync(new URL("../src/app/(public)/how-it-works/page.tsx", import.meta.url), "utf8");
    expect(book).toContain("<CompetitionFaq");
    expect(service).toContain("<CompetitionFaq");
    expect(how).not.toContain("FaqExplorer");
    expect(how).toContain("before-you-book");
  });
});

describe("testimonials conversion block", () => {
  it("attributes an unnamed review to Client, keeps Arabic as Arabic, and follows the reviews with Your story could be next", () => {
    const html = renderToStaticMarkup(createElement(Testimonials, { reviews: [{ name: "", quote: "ماشاءالله تبارك الله الصور مافيها ولا ملاحظه خيال والكوالتي ممتاز", role: null }], locale: "en" }));
    expect(html).toContain("ماشاءالله تبارك الله الصور مافيها ولا ملاحظه خيال والكوالتي ممتاز");
    expect(html).toContain(">Client<");
    expect(html).toContain('dir="auto"');
    expect(html).toContain("Your story could be next.");
    expect(html).toContain("Work with us");
    expect(html).toContain("/contact?from=%2Ftestimonials");
    expect(html).not.toMatch(/★|rating|stars/i);
    const compact = renderToStaticMarkup(createElement(Testimonials, { reviews: [{ name: "Coach", quote: "Great", role: null }], locale: "ar", compact: true }));
    expect(compact).not.toContain("قصتك قد تكون التالية");
    expect(compact).toContain("Great");
  });
});
