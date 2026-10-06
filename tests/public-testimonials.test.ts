import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PICTIME_RESIZE_SCRIPT, PICTIME_TESTIMONIALS_SRC, PictimeTestimonials } from "@/components/public/PictimeTestimonials";

describe("Pic-Time testimonials embed", () => {
  it("renders the Pic-Time iframe with the studio's testimonials URL, a title and a sandbox", () => {
    const html = renderToStaticMarkup(createElement(PictimeTestimonials, { fallback: createElement("p", null, "fallback copy") }));
    expect(html).toContain('id="pictimeIntegration"');
    expect(html).toContain('name="pictimeIntegration"');
    expect(html).toContain(`src="${PICTIME_TESTIMONIALS_SRC.replace(/&/g, "&amp;")}"`);
    expect(html).toContain('title="Client testimonials from Pic-Time"');
    expect(html).toMatch(/sandbox="[^"]*allow-scripts[^"]*"/);
    expect(html).toContain("width:100%");
    // Loading skeleton first; the fallback is not shown until Pic-Time fails to answer.
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain("fallback copy");
    // No inline script / arbitrary HTML: the resize helper is attached from a fixed URL on load.
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onload=");
  });

  it("uses only the two Pic-Time origins and the home page embeds it", () => {
    expect(new URL(PICTIME_TESTIMONIALS_SRC).origin).toBe("https://bluebeltmedia.pic-time.com");
    expect(new URL(PICTIME_RESIZE_SCRIPT).origin).toBe("https://pictimecloudaf-pub-g3csanfebyefg3dm.a02.azurefd.net");
    const page = readFileSync(new URL("../src/app/(public)/page.tsx", import.meta.url), "utf8");
    expect(page).toContain("<PictimeTestimonials");
    expect(page).toContain("fallback=");
  });
});
