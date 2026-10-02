import { describe, expect, it } from "vitest";
import { buildBookmarklet, buildShortcutScript, parsePendingImport, urlFromHtml } from "@/lib/pending-import";

describe("pending import helpers", () => {
  it("builds a bookmarklet that posts url + html to the hand-over endpoint of the given origin", () => {
    const code = buildBookmarklet("https://tournament-watcher.vercel.app");
    expect(code.startsWith("javascript:(function(){")).toBe(true);
    expect(code).toContain('f.action="https://tournament-watcher.vercel.app/api/import/receive"');
    expect(code).toContain('f.enctype="multipart/form-data"');
    expect(code).toContain('i("url",location.href)');
    expect(code).toContain('i("html",document.documentElement.outerHTML)');
    expect(code).not.toContain("\n");
  });

  it("derives the iOS Shortcut script from the same body and ends with completion()", () => {
    const script = buildShortcutScript("https://app.example");
    expect(script.startsWith("javascript:")).toBe(false);
    expect(script).toContain("/api/import/receive");
    expect(script.trim().endsWith('completion("sent");')).toBe(true);
  });

  it("parses only well-formed pending payloads", () => {
    expect(parsePendingImport(null)).toBeNull();
    expect(parsePendingImport("{")).toBeNull();
    expect(parsePendingImport(JSON.stringify({ url: "https://a", html: 1 }))).toBeNull();
    expect(parsePendingImport(JSON.stringify({ url: "https://a", html: "<p>", receivedAt: "t" }))).toEqual({ url: "https://a", html: "<p>", receivedAt: "t" });
  });

  it("guesses the page URL from canonical or og:url tags", () => {
    expect(urlFromHtml('<html><head><link rel="canonical" href="https://ajptour.com/en/event/1/bracket/2"></head></html>')).toBe("https://ajptour.com/en/event/1/bracket/2");
    expect(urlFromHtml('<html><head><meta property="og:url" content="https://smoothcomp.com/en/event/9"></head></html>')).toBe("https://smoothcomp.com/en/event/9");
    expect(urlFromHtml("<html></html>")).toBeNull();
  });
});
