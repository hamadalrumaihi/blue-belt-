/**
 * Pure helpers that turn an athlete's watch bookkeeping into what the
 * photographer should see: is the data fresh, stale, or never loaded, and
 * why the last attempt failed. Shared by the UI and the tests.
 */

export type HealthInput = {
  last_attempt_at?: string | null;
  last_success_at?: string | null;
  last_checked_at?: string | null;
  consecutive_failures?: number | null;
  last_watch_status?: string | null;
  last_watch_code?: string | null;
  last_watch_message?: string | null;
};

export type Freshness = "never" | "fresh" | "aging" | "stale";

export type SourceHealthView = {
  freshness: Freshness;
  /** ISO of the last successful read, or null. */
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  consecutiveFailures: number;
  /** True when the last attempt failed but older data is still shown. */
  showingLastKnown: boolean;
  /** Short status for a badge. */
  label: string;
  /** One-line explanation for the card. */
  detail: string;
};

/** Data older than this is "aging"; older than STALE_MS is "stale". */
export const AGING_MS = 3 * 60_000;
export const STALE_MS = 10 * 60_000;

export const SUCCESS_STATUSES: ReadonlySet<string> = new Set(["OK", "NO_MATCHES", "ATHLETE_NOT_FOUND"]);

export function isWatchFailure(status: string | null | undefined): boolean {
  return Boolean(status) && !SUCCESS_STATUSES.has(status as string);
}

export function sourceHealth(a: HealthInput, now: Date, hasMatches: boolean): SourceHealthView {
  const lastSuccessAt = a.last_success_at ?? (a.last_watch_status && SUCCESS_STATUSES.has(a.last_watch_status) ? a.last_checked_at ?? null : null);
  const lastAttemptAt = a.last_attempt_at ?? a.last_checked_at ?? null;
  const consecutiveFailures = a.consecutive_failures ?? (isWatchFailure(a.last_watch_status) ? 1 : 0);
  const failedLast = isWatchFailure(a.last_watch_status);
  const ageMs = lastSuccessAt ? now.getTime() - new Date(lastSuccessAt).getTime() : null;

  let freshness: Freshness;
  if (ageMs === null || Number.isNaN(ageMs)) freshness = "never";
  else if (ageMs > STALE_MS) freshness = "stale";
  else if (ageMs > AGING_MS) freshness = "aging";
  else freshness = "fresh";

  const showingLastKnown = failedLast && hasMatches;
  const label =
    freshness === "never" ? (failedLast ? "Unavailable" : "Not checked") : freshness === "stale" ? "Stale" : freshness === "aging" ? "Aging" : "Live";

  let detail: string;
  if (freshness === "never") detail = failedLast ? describeFailure(a.last_watch_code, a.last_watch_message) : "Not checked yet. Tap refresh.";
  else if (failedLast) detail = `${describeFailure(a.last_watch_code, a.last_watch_message)} Showing last good data from ${relative(ageMs!)}.`;
  else detail = `Updated ${relative(ageMs!)}.`;

  return { freshness, lastSuccessAt, lastAttemptAt, consecutiveFailures, showingLastKnown, label, detail };
}

function relative(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** Maps a fine-grained watch code to the copy shown on cards. */
export function describeFailure(code: string | null | undefined, message?: string | null): string {
  switch (code) {
    case "BROWSER_CHALLENGE":
      return /interactive|turnstile|captcha/i.test(message ?? "")
        ? "The source asks for a human check (CAPTCHA) the browser worker cannot pass (CHALLENGE_NOT_CLEARED). Open the page yourself and use Import page."
        : "The source is behind a bot challenge the browser worker could not clear (CHALLENGE_NOT_CLEARED). Open the page yourself and use Import page.";
    case "BROWSER_JS_SHELL":
      return "The page needs a browser to render its schedule.";
    case "BROWSER_WORKER_NOT_CONFIGURED":
      return "The page needs a browser and the browser worker is not configured.";
    case "BROWSER_WORKER_UNREACHABLE":
      return "The browser worker is unreachable.";
    case "BROWSER_WORKER_TIMEOUT":
      return "The browser worker timed out rendering the page.";
    case "BROWSER_WORKER_RESTARTING":
      return "The browser worker was restarting; retry in a moment.";
    case "BROWSER_WORKER_ERROR":
      return message ? `Browser worker error: ${message}` : "The browser worker returned an error.";
    case "BROWSER_PROXY_ERROR":
      return message ? `Browser worker proxy problem: ${message}` : "The browser worker's proxy failed.";
    case "SOURCE_TIMEOUT":
      return "The source site did not respond in time.";
    case "SOURCE_HTTP_ERROR":
      return message ? `The source site returned an error (${message}).` : "The source site returned an error.";
    case "SOURCE_NETWORK":
      return "Could not reach the source site.";
    case "SOURCE_TOO_LARGE":
      return "The source page is too large to read.";
    case "REDIRECT_BLOCKED":
      return "The source redirected to an unsupported site.";
    case "PARSE_FAILED":
      return "The page loaded but its schedule could not be read (parser problem).";
    case "ATHLETE_NOT_FOUND":
      return message ?? "The athlete is not listed on this page. Check the profile URL.";
    case "SCHEDULE_NOT_PUBLISHED":
      return "Schedule not published yet.";
    case "NO_MATCH_ROWS":
      return "No match information on the page yet.";
    case "INVALID_URL":
    case "UNSUPPORTED_HOST":
      return message ?? "Source URL is not a supported AJP / Smoothcomp link.";
    case "REFRESH_ERROR":
      return message ? `Refresh failed: ${message}` : "Refresh failed.";
    default:
      return message ?? "Live schedule unavailable. Open source page.";
  }
}
