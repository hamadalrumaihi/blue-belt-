import { parseGeneric } from "./ajp";
import type { WatcherAdapter } from "./types";

/**
 * Smoothcomp (smoothcomp.com) adapter.
 *
 * Smoothcomp event and schedule pages are also served behind a Cloudflare
 * challenge for plain HTTP clients (verified while building), and their
 * bracket UI is client-rendered. The shared pipeline handles both cases and
 * reports REQUIRES_BROWSER_WATCHER; kept as a separate adapter so platform
 * specific selectors can be added without touching AJP.
 */
export const smoothcompAdapter: WatcherAdapter = {
  platform: "SMOOTHCOMP",

  canHandle(url) {
    const h = url.hostname.toLowerCase();
    return h === "smoothcomp.com" || h.endsWith(".smoothcomp.com");
  },

  parse(html, ctx) {
    return parseGeneric(html, ctx, "SMOOTHCOMP");
  },
};
