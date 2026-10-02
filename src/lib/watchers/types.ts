import type { MatchStatus, Platform } from "@/lib/types";

/**
 * Coarse outcome of a watch attempt (persisted as photo_athletes.last_watch_status).
 *  OK                        -> matches found
 *  NO_MATCHES                -> page read fine, no schedule rows (not published yet)
 *  ATHLETE_NOT_FOUND         -> page lists competitors, none is this athlete
 *  REQUIRES_BROWSER_WATCHER  -> bot challenge / JS shell not cleared; needs the browser worker
 *  FETCH_ERROR / PARSE_ERROR -> source or parser problem; last-known data stays visible
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

/**
 * Fine-grained reason (persisted as photo_athletes.last_watch_code) so the UI
 * can say *why* a refresh failed instead of one generic message.
 */
export type WatchCode =
  // successes
  | "MATCHES_FOUND"
  | "SCHEDULE_NOT_PUBLISHED"
  | "NO_MATCH_ROWS"
  | "ATHLETE_NOT_FOUND"
  // browser worker
  | "BROWSER_CHALLENGE"
  | "BROWSER_JS_SHELL"
  | "BROWSER_WORKER_NOT_CONFIGURED"
  | "BROWSER_WORKER_UNREACHABLE"
  | "BROWSER_WORKER_TIMEOUT"
  | "BROWSER_WORKER_ERROR"
  | "BROWSER_WORKER_RESTARTING"
  | "BROWSER_PROXY_ERROR"
  // plain fetch
  | "SOURCE_TIMEOUT"
  | "SOURCE_HTTP_ERROR"
  | "SOURCE_NETWORK"
  | "SOURCE_TOO_LARGE"
  | "REDIRECT_BLOCKED"
  // parser / config
  | "PARSE_FAILED"
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

/** Safe-to-persist facts about how a page was fetched (no HTML, no secrets). */
export interface WatchDiagnostics {
  /** "http", "browser", "http:table", "browser:embedded-json", … */
  strategy: string;
  /** HTTP status of the final response, when known. */
  sourceStatus: number | null;
  /** URL after redirects (same allow-list as the input). */
  finalUrl: string | null;
  elapsedMs: number;
  /** Error code reported by the browser worker, when it was used. */
  workerCode?: string;
  /** Number of fetch attempts made (retries included). */
  attempts?: number;
}

export interface WatchResult {
  platform: Platform;
  status: WatchStatus;
  /** Fine-grained reason; always set by watchUrl. */
  code?: WatchCode;
  /** Athlete name the adapter believes the page is about, if any. */
  athlete: string | null;
  matches: NormalizedMatch[];
  sourceUrl: string;
  fetchedAt: string;
  /** Human-readable explanation for non-OK statuses. */
  message?: string;
  /** Which extraction strategy produced the matches (for diagnostics). */
  strategy?: string;
  diagnostics?: WatchDiagnostics;
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

/** Statuses after which a retry (without a config change) cannot help. */
export const NON_RETRYABLE_STATUSES: ReadonlySet<WatchStatus> = new Set(["INVALID_URL", "UNSUPPORTED_HOST", "PARSE_ERROR"]);
