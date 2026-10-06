import { describe, expect, it } from "vitest";
import { galleryHostsOf, parseGalleryForm, parseGalleryHosts } from "@/lib/galleries/form";

const BOOKING = "44444444-4444-4444-8444-444444444444";

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe("parseGalleryForm", () => {
  it("requires a name and trims everything", () => {
    const { fieldErrors } = parseGalleryForm(fd({ name: "   " }));
    expect(fieldErrors.name).toMatch(/name/i);
    const ok = parseGalleryForm(fd({ name: "  Doha Open — Finals  ", pictime_url: " https://bb.pic-time.com/doha ", pictime_project_id: " P-1 ", notes: " note " }));
    expect(ok.fieldErrors).toEqual({});
    expect(ok.values).toEqual({ name: "Doha Open — Finals", pictime_url: "https://bb.pic-time.com/doha", pictime_project_id: "P-1", booking_id: null, client_id: null, event_id: null, notes: "note" });
  });

  it("enforces lengths", () => {
    const long = parseGalleryForm(fd({ name: "x".repeat(121), pictime_project_id: "p".repeat(81), notes: "n".repeat(1001) }));
    expect(long.fieldErrors.name).toMatch(/120/);
    expect(long.fieldErrors.pictime_project_id).toMatch(/80/);
    expect(long.fieldErrors.notes).toMatch(/1000/);
  });

  it("validates the gallery URL against the host policy, with extra hosts from settings", () => {
    expect(parseGalleryForm(fd({ name: "G", pictime_url: "http://bb.pic-time.com/x" })).fieldErrors.pictime_url).toBeTruthy();
    expect(parseGalleryForm(fd({ name: "G", pictime_url: "https://evil.example/x" })).fieldErrors.pictime_url).toBeTruthy();
    expect(parseGalleryForm(fd({ name: "G", pictime_url: "https://gallery.bluebelt.qa/x" })).fieldErrors.pictime_url).toBeTruthy();
    expect(parseGalleryForm(fd({ name: "G", pictime_url: "https://gallery.bluebelt.qa/x" }), { extraHosts: ["bluebelt.qa"] }).fieldErrors).toEqual({});
    // Empty URL is fine (gallery not created in Pic-Time yet).
    expect(parseGalleryForm(fd({ name: "G", pictime_url: "" })).values.pictime_url).toBeNull();
  });

  it("accepts only real uuids for booking / client / event", () => {
    expect(parseGalleryForm(fd({ name: "G", booking_id: "nope" })).fieldErrors.booking_id).toMatch(/booking/i);
    expect(parseGalleryForm(fd({ name: "G", client_id: "nope" })).fieldErrors.client_id).toMatch(/client/i);
    expect(parseGalleryForm(fd({ name: "G", event_id: "nope" })).fieldErrors.event_id).toMatch(/event/i);
    const ok = parseGalleryForm(fd({ name: "G", booking_id: BOOKING, client_id: "", event_id: "" }));
    expect(ok.fieldErrors).toEqual({});
    expect(ok.values.booking_id).toBe(BOOKING);
    expect(ok.values.client_id).toBeNull();
  });
});

describe("galleryHostsOf", () => {
  it("reads a clean string array from studio settings and ignores anything else", () => {
    expect(galleryHostsOf(null)).toEqual([]);
    expect(galleryHostsOf({})).toEqual([]);
    expect(galleryHostsOf({ galleryHosts: "bluebelt.qa" })).toEqual([]);
    expect(galleryHostsOf({ galleryHosts: [" Gallery.Bluebelt.QA ", 42, "bad host!", "photos.example"] })).toEqual(["gallery.bluebelt.qa", "photos.example"]);
    expect(galleryHostsOf([1, 2])).toEqual([]);
  });
});

describe("custom Pic-Time domain in the gallery form", () => {
  const fd = (url: string) => {
    const f = new FormData();
    f.set("name", "Dalob finals");
    f.set("pictime_url", url);
    return f;
  };
  it("accepts the studio's custom domain with no Settings entry and keeps the url verbatim", () => {
    const out = parseGalleryForm(fd("https://galleries.bluebelt.media/client/dalob"));
    expect(out.fieldErrors).toEqual({});
    expect(out.values.pictime_url).toBe("https://galleries.bluebelt.media/client/dalob");
  });
  it("names both allowed domains in the error for a rejected link", () => {
    const out = parseGalleryForm(fd("http://galleries.bluebelt.media/client/dalob"));
    expect(out.fieldErrors.pictime_url).toContain("pic-time.com");
    expect(out.fieldErrors.pictime_url).toContain("galleries.bluebelt.media");
    expect(parseGalleryForm(fd("https://galleries.bluebelt.media.evil.example/client/dalob")).fieldErrors.pictime_url).toBeDefined();
  });
});

describe("parseGalleryHosts (Settings → extra gallery domains)", () => {
  it("splits, lower-cases, strips schemes/paths and de-duplicates", () => {
    expect(parseGalleryHosts("Photos.Example.com, https://cdn.example.org/x\n photos.example.com")).toEqual({ hosts: ["photos.example.com", "cdn.example.org"] });
    expect(parseGalleryHosts("")).toEqual({ hosts: [] });
    expect(parseGalleryHosts(null)).toEqual({ hosts: [] });
  });
  it("points at the first bad entry and caps the list", () => {
    expect(parseGalleryHosts("ok.example.com, not a host").error).toContain("not");
    expect(parseGalleryHosts(Array.from({ length: 11 }, (_, i) => `h${i}.example.com`).join(",")).error).toContain("10");
  });
});
