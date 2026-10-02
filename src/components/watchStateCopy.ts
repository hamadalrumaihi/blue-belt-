import { describeFailure, isWatchFailure as isFailure } from "@/lib/source-health";

/**
 * Maps a watcher status (+ fine-grained code) to the copy the photographer
 * sees. The code wins when present: it names the real reason (worker
 * unreachable, bot challenge, parser problem…) instead of a generic line.
 */
export function watchStateCopy(status: string | null | undefined, message?: string | null, code?: string | null): string {
  if (code && code !== "SKIPPED" && code !== "MATCHES_FOUND") return describeFailure(code, message);
  switch (status) {
    case "OK":
      return "Live schedule loaded.";
    case "NO_MATCHES":
      return message ?? "Schedule not published yet.";
    case "ATHLETE_NOT_FOUND":
      return message ?? "Athlete not found on the source page. Check the profile URL.";
    case "REQUIRES_BROWSER_WATCHER":
      return message ? `Live schedule unavailable: ${message} Open source page.` : "Live schedule unavailable (source needs a browser). Open source page.";
    case "FETCH_ERROR":
    case "PARSE_ERROR":
    case "ERROR":
      return message ? `Live schedule unavailable: ${message} Open source page.` : "Live schedule unavailable. Open source page.";
    case "INVALID_URL":
    case "UNSUPPORTED_HOST":
      return message ?? "Source URL is not a supported AJP / Smoothcomp link.";
    case null:
    case undefined:
    case "":
      return "Not checked yet. Tap refresh.";
    default:
      return message ?? "Unable to refresh.";
  }
}

export function isWatchFailure(status: string | null | undefined): boolean {
  return isFailure(status);
}
