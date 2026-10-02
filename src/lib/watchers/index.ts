import "server-only";
import { DEFAULT_TIMEZONE } from "@/lib/time";
import { ajpAdapter } from "./ajp";
import { browserFetchHtml, isBrowserWorkerConfigured, preferBrowserWorker } from "./browser-fetch";
import { safeFetchHtml } from "./safe-fetch";
import { smoothcompAdapter } from "./smoothcomp";
import type { WatchContext, WatchResult, WatcherAdapter } from "./types";
import { validateSourceUrl } from "./url-policy";

const ADAPTERS: WatcherAdapter[] = [ajpAdapter, smoothcompAdapter];

export type WatchOptions = {
  athleteName?: string | null;
  timezone?: string | null;
  eventDate?: string | null;
  now?: Date;
};

/**
 * Validates, fetches and parses a source URL. Never throws: every failure
 * mode is expressed as a WatchResult status so one bad athlete cannot take
 * down a batch refresh.
 *
 * Fetch strategy:
 *   1. plain HTTPS fetch (fast, cheap) unless WATCHER_PREFER_BROWSER=1
 *   2. if the page is a bot challenge / JS shell and the Playwright worker is
 *      configured, render it there and parse the rendered HTML instead
 */
export async function watchUrl(rawUrl: string | null | undefined, options: WatchOptions = {}): Promise<WatchResult> {
  const result = await watchUrlInner(rawUrl, options);
  // One line per attempt in the server logs (Vercel runtime logs) so field
  // problems can be diagnosed without exposing anything to the client.
  console.log(`[watch] ${result.status} strategy=${result.strategy ?? "-"} matches=${result.matches.length} ${hostOf(result.sourceUrl)}${result.message ? ` :: ${result.message}` : ""}`);
  return result;
}

function hostOf(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname}`;
  } catch {
    return url;
  }
}

async function watchUrlInner(rawUrl: string | null | undefined, options: WatchOptions): Promise<WatchResult> {
  const now = options.now ?? new Date();
  const fetchedAt = now.toISOString();
  const policy = validateSourceUrl(rawUrl);
  if (!policy.ok) {
    return { platform: "OTHER", status: policy.code, athlete: options.athleteName ?? null, matches: [], sourceUrl: rawUrl ?? "", fetchedAt, message: policy.message };
  }

  const adapter = ADAPTERS.find((a) => a.canHandle(policy.url));
  if (!adapter) {
    return { platform: policy.platform, status: "UNSUPPORTED_HOST", athlete: options.athleteName ?? null, matches: [], sourceUrl: policy.url.toString(), fetchedAt, message: "No adapter for this host." };
  }

  const ctx = (finalUrl: string): WatchContext => ({
    url: new URL(finalUrl),
    athleteName: options.athleteName ?? null,
    timezone: options.timezone || DEFAULT_TIMEZONE,
    eventDate: options.eventDate ?? null,
    now,
  });

  let plain: WatchResult | null = null;
  if (!preferBrowserWorker()) {
    const fetched = await safeFetchHtml(policy.url);
    if (!fetched.ok) {
      plain = { platform: adapter.platform, status: "FETCH_ERROR", athlete: options.athleteName ?? null, matches: [], sourceUrl: policy.url.toString(), fetchedAt, message: fetched.message };
    } else {
      plain = adapter.parse(fetched.html, ctx(fetched.finalUrl));
    }
    if (plain.status !== "REQUIRES_BROWSER_WATCHER" || !isBrowserWorkerConfigured()) {
      return { ...plain, strategy: plain.strategy ? `http:${plain.strategy}` : "http" };
    }
  }

  // Browser path.
  const rendered = await browserFetchHtml(policy.url);
  if (!rendered.ok) {
    const fallback = plain ?? { platform: adapter.platform, athlete: options.athleteName ?? null, matches: [], sourceUrl: policy.url.toString(), fetchedAt };
    return {
      ...fallback,
      status: rendered.code === "CHALLENGE_NOT_CLEARED" ? "REQUIRES_BROWSER_WATCHER" : "FETCH_ERROR",
      message: rendered.code === "CHALLENGE_NOT_CLEARED" ? "Browser worker could not clear the site's bot challenge." : rendered.message,
      strategy: "browser",
    };
  }
  const result = adapter.parse(rendered.html, ctx(rendered.finalUrl));
  return { ...result, strategy: `browser:${result.strategy ?? "none"}` };
}

export { validateSourceUrl } from "./url-policy";
export type { NormalizedMatch, WatchResult, WatchStatus } from "./types";
