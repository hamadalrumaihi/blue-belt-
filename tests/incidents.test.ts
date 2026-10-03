import { describe, expect, it } from "vitest";
import { buildIncidentDrafts, classifyIncident, recoveryText } from "@/lib/notifications/incidents";
import type { EventRow } from "@/lib/types";
import type { RefreshResult } from "@/lib/watch-service";

const OWNER = "11111111-1111-4111-8111-111111111111";
const EVENT = "22222222-2222-4222-8222-222222222222";
const APP = "https://tournament-watcher.vercel.app";

function result(over: Partial<RefreshResult> & { athleteId: string }): RefreshResult {
  return {
    athleteName: "X",
    status: "OK",
    code: null,
    matches: [],
    changes: [],
    checkedAt: "2026-10-03T10:00:00.000Z",
    sourceUrl: "https://ajptour.com/en/event/1/bracket/2",
    health: { lastAttemptAt: null, lastSuccessAt: null, consecutiveFailures: 0 },
    ambiguous: 0,
    ...over,
  } as RefreshResult;
}

function athlete(id: string, over: Partial<{ name: string; last_success_at: string | null }> = {}) {
  return { id, owner_id: OWNER, event_id: EVENT, name: over.name ?? "Ahmed", last_success_at: over.last_success_at ?? null };
}

const events = new Map<string, EventRow>([[EVENT, { id: EVENT, name: "AJP Qatar", timezone: "Asia/Qatar", platform: "AJP" } as unknown as EventRow]]);

describe("classifyIncident", () => {
  it("maps statuses and codes to incident kinds", () => {
    expect(classifyIncident(result({ athleteId: "a", status: "REQUIRES_BROWSER_WATCHER", code: "BROWSER_CHALLENGE" }))).toBe("CHALLENGE");
    expect(classifyIncident(result({ athleteId: "a", status: "REQUIRES_BROWSER_WATCHER", code: "BROWSER_WORKER_UNREACHABLE" }))).toBe("WORKER_DOWN");
    expect(classifyIncident(result({ athleteId: "a", status: "FETCH_ERROR", code: "BROWSER_WORKER_TIMEOUT" }))).toBe("WORKER_DOWN");
    expect(classifyIncident(result({ athleteId: "a", status: "FETCH_ERROR", code: "SOURCE_TIMEOUT" }))).toBe("SOURCE_ERROR");
    expect(classifyIncident(result({ athleteId: "a", status: "ATHLETE_NOT_FOUND", code: "ATHLETE_NOT_FOUND" }))).toBe("ATHLETE_NOT_FOUND");
    expect(classifyIncident(result({ athleteId: "a", status: "PARSE_ERROR", code: "PARSE_FAILED" }))).toBe("PARSE_ERROR");
    expect(classifyIncident(result({ athleteId: "a", status: "ERROR", code: "REFRESH_ERROR" }))).toBe("PERSIST_ERROR");
  });

  it("is null for OK, NO_MATCHES and skipped results", () => {
    expect(classifyIncident(result({ athleteId: "a", status: "OK" }))).toBeNull();
    expect(classifyIncident(result({ athleteId: "a", status: "NO_MATCHES" }))).toBeNull();
    expect(classifyIncident(result({ athleteId: "a", status: "FETCH_ERROR", skipped: "CONCURRENT" }))).toBeNull();
  });
});

describe("buildIncidentDrafts", () => {
  it("groups shared-source failures of the same kind into one incident with the required fields", () => {
    const athletes = [athlete("a", { name: "Ahmed", last_success_at: "2026-10-03T06:42:00.000Z" }), athlete("b", { name: "Sara" })];
    const results = [
      result({ athleteId: "a", status: "REQUIRES_BROWSER_WATCHER", code: "BROWSER_CHALLENGE", matches: [{} as never] }),
      result({ athleteId: "b", status: "REQUIRES_BROWSER_WATCHER", code: "BROWSER_CHALLENGE" }),
    ];
    const drafts = buildIncidentDrafts({ athletes, events, results }, APP);
    expect(drafts).toHaveLength(1);
    const d = drafts[0];
    expect(d.kind).toBe("CHALLENGE");
    expect(d.athleteIds).toHaveLength(2);
    expect(d.retained).toBe(true); // at least one had retained matches
    expect(d.text).toContain("<b>Refresh blocked — 2 clients, AJP Qatar</b>");
    expect(d.text).toContain("Reason:");
    expect(d.text).toContain("Last verified: 09:42."); // 06:42Z in Asia/Qatar (+3) = 09:42
    expect(d.text).toContain("Previous schedule retained.");
    expect(d.text).toContain("Action:");
    expect(d.text).toContain(`Open: ${APP}/events/${EVENT}`);
    expect(d.text).toMatch(/Ref: [0-9a-f]{8}/);
  });

  it("says 'unknown' when never verified and names a single athlete", () => {
    const drafts = buildIncidentDrafts({ athletes: [athlete("a", { name: "Ahmed" })], events, results: [result({ athleteId: "a", status: "ATHLETE_NOT_FOUND", code: "ATHLETE_NOT_FOUND" })] }, APP);
    expect(drafts[0].text).toContain("<b>Athlete not found — Ahmed, AJP Qatar</b>");
    expect(drafts[0].text).toContain("Last verified: unknown.");
    expect(drafts[0].text).toContain("No previous schedule to show.");
  });

  it("separates different kinds and hosts into distinct incidents", () => {
    const athletes = [athlete("a"), athlete("b")];
    const results = [
      result({ athleteId: "a", status: "REQUIRES_BROWSER_WATCHER", code: "BROWSER_CHALLENGE" }),
      result({ athleteId: "b", status: "FETCH_ERROR", code: "SOURCE_TIMEOUT", sourceUrl: "https://smoothcomp.com/en/event/9" }),
    ];
    expect(buildIncidentDrafts({ athletes, events, results }, APP)).toHaveLength(2);
  });
});

describe("recoveryText", () => {
  it("names the event and the cleared issue", () => {
    const t = recoveryText({ kind: "CHALLENGE", eventName: "AJP Qatar", count: 2, ref: "abcd1234" });
    expect(t).toContain("<b>Recovered — AJP Qatar</b>");
    expect(t).toContain("has cleared");
    expect(t).toContain("Ref: abcd1234");
  });
});
