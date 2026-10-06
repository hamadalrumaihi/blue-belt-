import { describe, expect, it } from "vitest";
import { canTransitionGallery, GALLERY_STATUSES, GALLERY_TRANSITIONS, isAllowedGalleryUrl, isGalleryStatus } from "@/lib/galleries/state";

describe("gallery transitions", () => {
  it("walks pending → created → ready → delivered and allows one step back", () => {
    expect(canTransitionGallery("pending", "created")).toBe(true);
    expect(canTransitionGallery("pending", "ready")).toBe(true);
    expect(canTransitionGallery("created", "ready")).toBe(true);
    expect(canTransitionGallery("ready", "delivered")).toBe(true);
    expect(canTransitionGallery("delivered", "ready")).toBe(true);
    expect(canTransitionGallery("ready", "created")).toBe(true);
    expect(canTransitionGallery("created", "pending")).toBe(true);
  });

  it("refuses skipping to delivered, self transitions and backwards jumps", () => {
    expect(canTransitionGallery("pending", "delivered")).toBe(false);
    expect(canTransitionGallery("created", "delivered")).toBe(false);
    expect(canTransitionGallery("delivered", "pending")).toBe(false);
    expect(canTransitionGallery("delivered", "created")).toBe(false);
    for (const s of GALLERY_STATUSES) expect(canTransitionGallery(s, s)).toBe(false);
  });

  it("every status has a transition row and the guard recognises only known statuses", () => {
    for (const s of GALLERY_STATUSES) expect(Array.isArray(GALLERY_TRANSITIONS[s])).toBe(true);
    expect(isGalleryStatus("ready")).toBe(true);
    expect(isGalleryStatus("shipped")).toBe(false);
    expect(isGalleryStatus(null)).toBe(false);
  });
});

describe("isAllowedGalleryUrl", () => {
  it("accepts https pic-time.com and its subdomains", () => {
    expect(isAllowedGalleryUrl("https://pic-time.com/gallery/abc")).toBe(true);
    expect(isAllowedGalleryUrl("https://bluebelt.pic-time.com/-finals/gallery")).toBe(true);
    expect(isAllowedGalleryUrl("  https://Studio.Pic-Time.com/x  ")).toBe(true);
  });

  it("refuses http, look-alike hosts, credentials and garbage", () => {
    expect(isAllowedGalleryUrl("http://bluebelt.pic-time.com/gallery")).toBe(false);
    expect(isAllowedGalleryUrl("https://pic-time.com.evil.example/gallery")).toBe(false);
    expect(isAllowedGalleryUrl("https://notpic-time.com/gallery")).toBe(false);
    expect(isAllowedGalleryUrl("https://user:pw@bluebelt.pic-time.com/gallery")).toBe(false);
    expect(isAllowedGalleryUrl("https://user@bluebelt.pic-time.com/gallery")).toBe(false);
    expect(isAllowedGalleryUrl("javascript:alert(1)")).toBe(false);
    expect(isAllowedGalleryUrl("not a url")).toBe(false);
    expect(isAllowedGalleryUrl("")).toBe(false);
  });

  it("accepts an extra host and its subdomains, case-insensitively, only over https", () => {
    expect(isAllowedGalleryUrl("https://gallery.bluebeltmedia.qa/x", ["gallery.bluebeltmedia.qa"])).toBe(true);
    expect(isAllowedGalleryUrl("https://photos.Bluebeltmedia.QA/x", ["bluebeltmedia.qa"])).toBe(true);
    expect(isAllowedGalleryUrl("https://bluebeltmedia.qa.evil.example/x", ["bluebeltmedia.qa"])).toBe(false);
    expect(isAllowedGalleryUrl("http://gallery.bluebeltmedia.qa/x", ["gallery.bluebeltmedia.qa"])).toBe(false);
    expect(isAllowedGalleryUrl("https://gallery.bluebeltmedia.qa/x")).toBe(false);
  });
});
