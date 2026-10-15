import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Testimonials } from "@/components/public/Testimonials";

describe("native website testimonials", () => {
  it("renders nothing at all when there are no reviews: a sales page never asks for one", () => {
    const html = renderToStaticMarkup(createElement(Testimonials, { reviews: [] }));
    expect(html).toBe("");
  });

  it("renders Arabic headings when asked", () => {
    const html = renderToStaticMarkup(createElement(Testimonials, { reviews: [{ name: "Coach", quote: "Great", role: null }], locale: "ar" }));
    expect(html).toContain("من على البساط");
    expect(html).not.toContain("Share your experience");
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
    expect(html).not.toContain("Share your experience");
    expect(html).not.toContain("rating");
    expect(html).toContain('tabindex="0"');
  });

  it("uses the native section on the homepage without mounting the vendor embed", () => {
    const page = readFileSync(new URL("../src/app/(public)/page.tsx", import.meta.url), "utf8");
    expect(page).toContain("<Testimonials reviews={testimonials}");
    expect(page).not.toContain("PictimeTestimonials");
  });
});
