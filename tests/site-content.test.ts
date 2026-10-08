import { describe, expect, it } from "vitest";
import { DEFAULT_PICTIME_GALLERY_URL, normalizePictimeGalleryUrl, readPictimeGalleryUrl, readPortfolio, readTestimonials } from "@/lib/studio/site-content";

describe("readTestimonials", () => {
  it("returns nothing for missing, malformed or non-object settings", () => {
    expect(readTestimonials(null)).toEqual([]);
    expect(readTestimonials("x")).toEqual([]);
    expect(readTestimonials([])).toEqual([]);
    expect(readTestimonials({})).toEqual([]);
    expect(readTestimonials({ testimonials: "nope" })).toEqual([]);
    expect(readTestimonials({ testimonials: [null, 1, "s", { quote: "only quote" }, { name: "only name" }, { quote: "  ", name: "Blank" }] })).toEqual([]);
  });

  it("trims, caps lengths, makes role optional and keeps at most six", () => {
    const long = "q".repeat(700);
    const items = Array.from({ length: 8 }, (_, i) => ({ quote: ` ${long} `, name: ` Name ${i} `, role: i % 2 ? " Coach " : "" }));
    const out = readTestimonials({ testimonials: items });
    expect(out).toHaveLength(6);
    expect(out[0]).toEqual({ quote: "q".repeat(600), name: "Name 0", role: null });
    expect(out[1].role).toBe("Coach");
    expect(readTestimonials({ testimonials: [{ quote: "Great", name: "n".repeat(100), role: 5 }] })[0]).toEqual({ quote: "Great", name: "n".repeat(80), role: null });
  });
});

describe("readPortfolio", () => {
  it("keeps only https links with a title, and https covers", () => {
    const out = readPortfolio({
      portfolio: [
        { title: " Doha Open ", url: " https://bluebeltmedia.pic-time.com/doha-open ", cover: "https://cdn.pic-time.com/c.jpg" },
        { title: "No cover", url: "https://galleries.bluebelt.media/x", cover: "http://insecure.example/c.jpg" },
        { title: "Http", url: "http://bluebeltmedia.pic-time.com/x" },
        { title: "", url: "https://bluebeltmedia.pic-time.com/empty" },
        { title: "Bad", url: "javascript:alert(1)" },
        { title: "Missing url" },
        "string",
      ],
    });
    expect(out).toEqual([
      { title: "Doha Open", url: "https://bluebeltmedia.pic-time.com/doha-open", cover: "https://cdn.pic-time.com/c.jpg" },
      { title: "No cover", url: "https://galleries.bluebelt.media/x", cover: null },
    ]);
  });

  it("returns nothing for bad shapes and caps at 24 entries", () => {
    expect(readPortfolio(null)).toEqual([]);
    expect(readPortfolio({ portfolio: {} })).toEqual([]);
    const many = Array.from({ length: 30 }, (_, i) => ({ title: `G${i}`, url: `https://example.com/${i}` }));
    expect(readPortfolio({ portfolio: many })).toHaveLength(24);
    expect(readPortfolio({ portfolio: [{ title: "t".repeat(200), url: "https://example.com" }] })[0].title).toHaveLength(120);
  });
});

describe("normalizePictimeGalleryUrl / readPictimeGalleryUrl", () => {
  it("accepts https links on pic-time.com and galleries.bluebelt.media only", () => {
    expect(normalizePictimeGalleryUrl("https://galleries.bluebelt.media/client")).toBe("https://galleries.bluebelt.media/client");
    expect(normalizePictimeGalleryUrl("https://bluebeltmedia.pic-time.com/client")).toBe("https://bluebeltmedia.pic-time.com/client");
    expect(normalizePictimeGalleryUrl("http://galleries.bluebelt.media/client")).toBeNull();
    expect(normalizePictimeGalleryUrl("https://photos.example.com/client")).toBeNull();
    expect(normalizePictimeGalleryUrl("https://user:pw@galleries.bluebelt.media/client")).toBeNull();
    expect(normalizePictimeGalleryUrl("")).toBeNull();
    expect(normalizePictimeGalleryUrl(undefined)).toBeNull();
    expect(normalizePictimeGalleryUrl("https://galleries.bluebelt.media/" + "a".repeat(2100))).toBeNull();
  });

  it("drops the headless embed parameter and any fragment", () => {
    expect(normalizePictimeGalleryUrl("https://galleries.bluebelt.media/client?headless=true#top")).toBe("https://galleries.bluebelt.media/client");
    expect(normalizePictimeGalleryUrl("https://galleries.bluebelt.media/client?headless=TRUE")).toBe("https://galleries.bluebelt.media/client");
  });

  it("reads the setting with the default as fallback", () => {
    expect(readPictimeGalleryUrl(null)).toBe(DEFAULT_PICTIME_GALLERY_URL);
    expect(readPictimeGalleryUrl({ galleryHosts: [] })).toBe(DEFAULT_PICTIME_GALLERY_URL);
    expect(readPictimeGalleryUrl({ pictimeGalleryUrl: "https://galleries.bluebelt.media/client?headless=true" })).toBe(DEFAULT_PICTIME_GALLERY_URL);
    expect(readPictimeGalleryUrl({ pictimeGalleryUrl: "https://bluebeltmedia.pic-time.com/client" })).toBe("https://bluebeltmedia.pic-time.com/client");
    expect(DEFAULT_PICTIME_GALLERY_URL).not.toContain("headless");
  });
});
