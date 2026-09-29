import type { MatchStatus, Platform } from "@/lib/types";

/**
 * Outcome of a watch attempt. The UI maps these to copy:
 *  OK                        -> matches found
 *  NO_MATCHES                -> "Schedule not published yet."
 *  ATHLETE_NOT_FOUND         -> athlete name not on page
 *  REQUIRES_BROWSER_WATCHER  -> page is JS-rendered / bot-challenged; needs Playwright worker
 *  FETCH_ERROR / PARSE_ERROR -> "Live schedule unavailable. Open source page."
 *  INVALID_URL / UNSUPPORTED_HOST -> configuration problem on the client record
 */
export type WatchStatus =
  | "OK"
  | "NO_MATCHES"
  | "ATHLETE_NOT_FOUND"
  | "REQUIRES_BROWSER_WATCHER"
  | "FETCH_ERROR"
  | "PARSE_ERROR"
  | "INVALID_URL"
  | "UNSUPPORTED_HOST";

/** Normalized match shape shared by every adapter. */
export interface NormalizedMatch {
  athlete: string | null;
  opponent: string | null;
  mat: string | null;
  /** ISO 8601 or null. */
  scheduledAt: string | null;
  /** ISO 8601 or null. */
  estimatedAt: string | null;
  matchNumber: string | null;
  matchOrder: number | null;
  status: MatchStatus;
  sourceUrl: string;
  /** Stable id from the platform when available (used to upsert). */
  externalMatchId: string | null;
  /** Untouched extracted fields for debugging; stored in raw_snapshot. */
  raw: Record<string, unknown>;
}

export interface WatchResult {
  platform: Platform;
  status: WatchStatus;
  /** Athlete name the adapter believes the page is about, if any. */
  athlete: string | null;
  matches: NormalizedMatch[];
  sourceUrl: string;
  fetchedAt: string;
  /** Human-readable explanation for non-OK statuses. */
  message?: string;
  /** Which extraction strategy produced the matches (for diagnostics). */
  strategy?: string;
}

export interface WatchContext {
  url: URL;
  /** Name of the client we are looking for, used to pick the right rows. */
  athleteName?: string | null;
  /** IANA timezone used to resolve wall-clock times from the page. */
  timezone: string;
  /** YYYY-MM-DD of the event, used as the base date for HH:MM values. */
  eventDate?: string | null;
  now: Date;
}

export interface WatcherAdapter {
  platform: Platform;
  /** True when this adapter owns the host. */
  canHandle(url: URL): boolean;
  /** Parses already-fetched HTML into a normalized result. Must not throw. */
  parse(html: string, ctx: WatchContext): WatchResult;
}
