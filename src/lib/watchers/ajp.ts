import {
  filterForAthlete,
  isBotChallenge,
  load,
  looksLikeJsShell,
  matchesFromCards,
  matchesFromEmbeddedJson,
  matchesFromTables,
  pageTitle,
  scheduleNotPublished,
  sortMatches,
} from "./extract";
import type { WatchContext, WatchResult, WatcherAdapter } from "./types";

/**
 * AJP Tour (ajptour.com) adapter.
 *
 * Known reality (verified while building): the public listing pages render
 * server-side, but event, schedule and athlete pages sit behind a Cloudflare
 * JavaScript challenge for non-browser clients. When that happens we return
 * REQUIRES_BROWSER_WATCHER so a Playwright worker can take over later.
 * The extraction order below is deliberately generic so a markup change on
 * AJP's side degrades to NO_MATCHES instead of crashing.
 */
export const ajpAdapter: WatcherAdapter = {
  platform: "AJP",

  canHandle(url) {
    const h = url.hostname.toLowerCase();
    return h === "ajptour.com" || h.endsWith(".ajptour.com");
  },

  parse(html, ctx) {
    return parseGeneric(html, ctx, "AJP");
  },
};

/** Shared parse pipeline used by both AJP and Smoothcomp. */
export function parseGeneric(html: string, ctx: WatchContext, platform: "AJP" | "SMOOTHCOMP"): WatchResult {
  const base = {
    platform,
    athlete: ctx.athleteName ?? null,
    sourceUrl: ctx.url.toString(),
    fetchedAt: ctx.now.toISOString(),
  };

  try {
    if (isBotChallenge(html)) {
      return {
        ...base,
        status: "REQUIRES_BROWSER_WATCHER",
        matches: [],
        message: "The source is protected by a browser challenge. A Playwright worker is required for live data.",
      };
    }

    const $ = load(html);
    const title = pageTitle($);

    const strategies: Array<[string, () => ReturnType<typeof matchesFromTables>]> = [
      ["embedded-json", () => matchesFromEmbeddedJson($, html, ctx)],
      ["table", () => matchesFromTables($, ctx)],
      ["cards", () => matchesFromCards($, ctx)],
    ];

    for (const [name, run] of strategies) {
      const found = run();
      if (!found.length) continue;
      const { matches, filtered } = filterForAthlete(found, ctx);
      // A page listing many competitors where none mention the athlete.
      if (ctx.athleteName && !filtered && found.length > 3) {
        return {
          ...base,
          status: "ATHLETE_NOT_FOUND",
          matches: [],
          strategy: name,
          message: `Found ${found.length} schedule rows but none mention ${ctx.athleteName}. Check the profile URL.`,
        };
      }
      return { ...base, status: "OK", matches: sortMatches(matches), strategy: name, message: title || undefined };
    }

    if (looksLikeJsShell($)) {
      return {
        ...base,
        status: "REQUIRES_BROWSER_WATCHER",
        matches: [],
        message: "The page renders its schedule with JavaScript. A Playwright worker is required for live data.",
      };
    }

    return {
      ...base,
      status: "NO_MATCHES",
      matches: [],
      message: scheduleNotPublished($)
        ? "Schedule not published yet."
        : "No match information found on the page yet.",
    };
  } catch (err) {
    return {
      ...base,
      status: "PARSE_ERROR",
      matches: [],
      message: err instanceof Error ? err.message : "Could not parse the source page.",
    };
  }
}
