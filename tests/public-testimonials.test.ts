import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Testimonials } from "@/components/public/Testimonials";

describe("native website testimonials", () => {
  it("shows a working contact invitation instead of an empty embed when there are no reviews", () => {
    const html = renderToStaticMarkup(createElement(Testimonials, { reviews: [] }));
    expect(html).toContain("Shot with us? Tell us how it went.");
    expect(html).toContain('href="/contact"');
    expect(html).not.toContain("<blockquote");
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("<script");
    expect(html).not.toMatch(/pic-?time/i);
  });

  it("renders supplied reviews safely, supports Arabic, and never invents a rating", () => {
    const html = renderToStaticMarkup(createElement(Testimonials, { reviews: [
      { name: "هزاع", quote: "صور جميلة", role: "Athlete" },
      { name: "Coach", quote: '<script>alert("test")</script>', role: null },
    ] }));
    expect(html).toContain("صور جميلة");
    expect(html).toContain("هزاع");
    expect(html).toContain('dir="auto"');
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("Shot with us?");
    expect(html).not.toContain("rating");
    expect(html).toContain('tabindex="0"');
  });

  it("uses the native section on the homepage without mounting the vendor embed", () => {
    const page = readFileSync(new URL("../src/app/(public)/page.tsx", import.meta.url), "utf8");
    expect(page).toContain("<Testimonials reviews={testimonials}");
    expect(page).not.toContain("PictimeTestimonials");
  });
});
