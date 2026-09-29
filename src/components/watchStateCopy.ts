/** Maps a watcher status to the copy the photographer sees. */
export function watchStateCopy(status: string | null | undefined, message?: string | null): string {
  switch (status) {
    case "OK":
      return "Live schedule loaded.";
    case "NO_MATCHES":
      return "Schedule not published yet.";
    case "ATHLETE_NOT_FOUND":
      return message ?? "Athlete not found on the source page. Check the profile URL.";
    case "REQUIRES_BROWSER_WATCHER":
      return "Live schedule unavailable (source needs a browser). Open source page.";
    case "FETCH_ERROR":
    case "PARSE_ERROR":
    case "ERROR":
      return "Live schedule unavailable. Open source page.";
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
  return Boolean(status) && status !== "OK" && status !== "NO_MATCHES";
}
