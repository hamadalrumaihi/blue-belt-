import { describe, expect, it } from "vitest";

import { sameSource, sourceKey } from "@/lib/capture/source-identity";

const PAGE = "https://ajptour.com/en/event/1411/bracket/130617";

describe("sourceKey (owner-neutral source identity)", () => {
  it("ignores case, www, trailing slash, hash, locale prefix and presentation params", () => {
    const key = sourceKey(PAGE);
    expect(key).toBe("ajptour.com|/event/1411/bracket/130617");
    expect(sourceKey(`${PAGE}/`)).toBe(key);
    expect(sourceKey(`${PAGE}#top`)).toBe(key);
    expect(sourceKey(`${PAGE}?tab=2&utm_source=x&lang=ar`)).toBe(key);
    expect(sourceKey("https://WWW.AJPTOUR.com/ar/event/1411/bracket/130617")).toBe(key);
    expect(sourceKey("http://ajptour.com/en/event/1411/bracket/130617")).toBe(key);
  });

  it("keeps bracket / category / division query params so distinct brackets never merge", () => {
    const base = "https://smoothcomp.com/en/event/9000/schedule";
    const a = sourceKey(`${base}?category=12`);
    const b = sourceKey(`${base}?category=13`);
    const c = sourceKey(`${base}?bracketId=7&category=12`);
    expect(a).toBe("smoothcomp.com|/event/9000/schedule|category=12");
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    // Order of params does not matter; repeated identity params are sorted.
    expect(sourceKey(`${base}?category=12&bracketId=7`)).toBe(c);
    expect(sourceKey(`${base}?division_id=4&page=3`)).toBe("smoothcomp.com|/event/9000/schedule|division_id=4");
  });

  it("returns null for anything outside the URL policy", () => {
    expect(sourceKey("https://evil.example/event/1")).toBeNull();
    expect(sourceKey("not a url")).toBeNull();
    expect(sourceKey(null)).toBeNull();
  });
});

describe("sameSource", () => {
  it("compares identities and never matches invalid or different pages", () => {
    expect(sameSource(PAGE, `${PAGE}?tab=1`)).toBe(true);
    expect(sameSource(PAGE, "https://ajptour.com/en/event/1411/bracket/130618")).toBe(false);
    expect(sameSource(PAGE, "https://smoothcomp.com/en/event/1411/bracket/130617")).toBe(false);
    expect(sameSource(`${PAGE}?category=1`, `${PAGE}?category=2`)).toBe(false);
    expect(sameSource(null, PAGE)).toBe(false);
    expect(sameSource("nope", "nope")).toBe(false);
  });
});
