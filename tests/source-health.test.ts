import { describe, expect, it } from "vitest";
import { AGING_MS, STALE_MS, SUCCESS_STATUSES, describeFailure, isWatchFailure, sourceHealth } from "@/lib/source-health";

const NOW = new Date("2026-03-14T07:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

describe("sourceHealth", () => {
  it("never: nothing has succeeded yet", () => {
    const view = sourceHealth({}, NOW, false);
    expect(view).toMatchObject({ freshness: "never", lastSuccessAt: null, lastAttemptAt: null, consecutiveFailures: 0, showingLastKnown: false, label: "Not checked", detail: "Not checked yet. Tap refresh." });
  });

  it("never + failed last attempt: Unavailable with the failure copy", () => {
    const view = sourceHealth({ last_attempt_at: ago(1000), last_watch_status: "FETCH_ERROR", last_watch_code: "SOURCE_TIMEOUT", consecutive_failures: 3 }, NOW, false);
    expect(view).toMatchObject({ freshness: "never", label: "Unavailable", consecutiveFailures: 3, showingLastKnown: false, lastAttemptAt: ago(1000) });
    expect(view.detail).toBe("The source site did not respond in time.");
  });

  it("fresh / aging / stale by the age of the last success", () => {
    expect(sourceHealth({ last_success_at: ago(30_000), last_watch_status: "OK" }, NOW, true)).toMatchObject({ freshness: "fresh", label: "Live", detail: "Updated 30s ago." });
    expect(sourceHealth({ last_success_at: ago(AGING_MS), last_watch_status: "OK" }, NOW, true).freshness).toBe("fresh");
    expect(sourceHealth({ last_success_at: ago(AGING_MS + 1), last_watch_status: "OK" }, NOW, true)).toMatchObject({ freshness: "aging", label: "Aging", detail: "Updated 3 min ago." });
    expect(sourceHealth({ last_success_at: ago(STALE_MS + 1), last_watch_status: "NO_MATCHES" }, NOW, false)).toMatchObject({ freshness: "stale", label: "Stale", detail: "Updated 10 min ago." });
    expect(sourceHealth({ last_success_at: ago(3 * 3600_000), last_watch_status: "OK" }, NOW, true).detail).toBe("Updated 3h ago.");
    expect(sourceHealth({ last_success_at: ago(49 * 3600_000), last_watch_status: "OK" }, NOW, true).detail).toBe("Updated 2d ago.");
  });

  it("derives last success from last_checked_at when the last status was a success", () => {
    const view = sourceHealth({ last_checked_at: ago(10_000), last_watch_status: "ATHLETE_NOT_FOUND" }, NOW, false);
    expect(view).toMatchObject({ freshness: "fresh", lastSuccessAt: ago(10_000), lastAttemptAt: ago(10_000), consecutiveFailures: 0 });
    const failed = sourceHealth({ last_checked_at: ago(10_000), last_watch_status: "FETCH_ERROR" }, NOW, false);
    expect(failed).toMatchObject({ freshness: "never", lastSuccessAt: null, consecutiveFailures: 1 });
  });

  it("showingLastKnown when the last attempt failed but older rows exist", () => {
    const input = { last_success_at: ago(2 * 60_000), last_attempt_at: ago(5_000), last_watch_status: "REQUIRES_BROWSER_WATCHER", last_watch_code: "BROWSER_WORKER_NOT_CONFIGURED", consecutive_failures: 2 };
    const withRows = sourceHealth(input, NOW, true);
    expect(withRows).toMatchObject({ freshness: "fresh", showingLastKnown: true, label: "Live", consecutiveFailures: 2 });
    expect(withRows.detail).toBe("The page needs a browser and the browser worker is not configured. Showing last good data from 2 min ago.");
    expect(sourceHealth(input, NOW, false).showingLastKnown).toBe(false);
  });

  it("treats an invalid last success as never", () => {
    expect(sourceHealth({ last_success_at: "garbage" }, NOW, false).freshness).toBe("never");
  });
});

describe("isWatchFailure / describeFailure", () => {
  it("classifies statuses", () => {
    expect([...SUCCESS_STATUSES].sort()).toEqual(["ATHLETE_NOT_FOUND", "NO_MATCHES", "OK"]);
    expect(isWatchFailure("OK")).toBe(false);
    expect(isWatchFailure(null)).toBe(false);
    expect(isWatchFailure("")).toBe(false);
    expect(isWatchFailure("FETCH_ERROR")).toBe(true);
    expect(isWatchFailure("ERROR")).toBe(true);
  });

  it("maps codes to copy, using the message where it adds detail", () => {
    expect(describeFailure("BROWSER_CHALLENGE")).toMatch(/CHALLENGE_NOT_CLEARED/);
    expect(describeFailure("BROWSER_JS_SHELL")).toMatch(/needs a browser/);
    expect(describeFailure("BROWSER_WORKER_UNREACHABLE")).toMatch(/unreachable/);
    expect(describeFailure("BROWSER_WORKER_TIMEOUT")).toMatch(/timed out/);
    expect(describeFailure("BROWSER_WORKER_RESTARTING")).toMatch(/restarting/);
    expect(describeFailure("BROWSER_WORKER_ERROR", "boom")).toBe("Browser worker error: boom");
    expect(describeFailure("BROWSER_WORKER_ERROR")).toBe("The browser worker returned an error.");
    expect(describeFailure("BROWSER_PROXY_ERROR", "407")).toBe("Browser worker proxy problem: 407");
    expect(describeFailure("SOURCE_HTTP_ERROR", "HTTP 500")).toBe("The source site returned an error (HTTP 500).");
    expect(describeFailure("SOURCE_NETWORK")).toMatch(/Could not reach/);
    expect(describeFailure("SOURCE_TOO_LARGE")).toMatch(/too large/);
    expect(describeFailure("REDIRECT_BLOCKED")).toMatch(/redirected/);
    expect(describeFailure("PARSE_FAILED")).toMatch(/parser problem/);
    expect(describeFailure("ATHLETE_NOT_FOUND", "Found 6 rows")).toBe("Found 6 rows");
    expect(describeFailure("ATHLETE_NOT_FOUND")).toMatch(/not listed/);
    expect(describeFailure("SCHEDULE_NOT_PUBLISHED")).toBe("Schedule not published yet.");
    expect(describeFailure("NO_MATCH_ROWS")).toMatch(/No match information/);
    expect(describeFailure("INVALID_URL", "bad")).toBe("bad");
    expect(describeFailure("UNSUPPORTED_HOST")).toMatch(/AJP \/ Smoothcomp/);
    expect(describeFailure("REFRESH_ERROR", "db down")).toBe("Refresh failed: db down");
    expect(describeFailure("REFRESH_ERROR")).toBe("Refresh failed.");
    expect(describeFailure(null, "custom")).toBe("custom");
    expect(describeFailure(undefined)).toBe("Live schedule unavailable. Open source page.");
  });
});
