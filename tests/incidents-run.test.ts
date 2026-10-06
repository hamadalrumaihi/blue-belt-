import { describe, expect, it, vi } from "vitest";
import { createLogger, setLogSink } from "@/lib/log";
import type { RefreshNotificationContext } from "@/lib/notifications/server";
import { runIncidentNotifier } from "@/lib/notifications/telegram/incidents-run";
import type { EventRow } from "@/lib/types";
import type { RefreshResult } from "@/lib/watch-service";
import { FakeSupabase } from "./payments/fake-supabase";

vi.mock("server-only", () => ({}));
setLogSink(() => {});

const OWNER = "11111111-1111-4111-8111-111111111111";
const EVENT = "22222222-2222-4222-8222-222222222222";
const events = new Map<string, EventRow>([[EVENT, { id: EVENT, name: "AJP Qatar", timezone: "Asia/Qatar", platform: "AJP" } as unknown as EventRow]]);
const athlete = { id: "a1", owner_id: OWNER, event_id: EVENT, name: "Ahmed", last_success_at: null } as unknown as RefreshNotificationContext["athletes"][number];

function result(status: string, code: string | null): RefreshResult {
  return {
    athleteId: "a1", athleteName: "Ahmed", status, code, matches: [], changes: [], checkedAt: "2026-10-03T10:00:00.000Z",
    sourceUrl: "https://ajptour.com/en/event/1/bracket/2", health: { lastAttemptAt: null, lastSuccessAt: null, consecutiveFailures: 0 }, ambiguous: 0,
  } as unknown as RefreshResult;
}

function run(db: FakeSupabase, at: string, r: RefreshResult) {
  return runIncidentNotifier({ supabase: db.asClient(), athletes: [athlete], events, results: [r], now: new Date(at), log: createLogger({ test: true }) });
}

const blocked = () => result("REQUIRES_BROWSER_WATCHER", "BROWSER_CHALLENGE");
const ok = () => result("OK", null);
const incidentAlerts = (db: FakeSupabase) => db.tables.photo_notification_deliveries.filter((d) => String(d.alert_key).startsWith("incident:"));
const recoveries = (db: FakeSupabase) => db.tables.photo_notification_deliveries.filter((d) => String(d.alert_key).startsWith("recovery:"));

describe("runIncidentNotifier", () => {
  it("alerts once per open incident, even when the DB returns timestamps in its own format", async () => {
    const db = new FakeSupabase();
    await run(db, "2026-10-03T10:00:00.000Z", blocked());
    // Postgres hands timestamptz back as "YYYY-MM-DD HH:MM:SS+00"; the key must still match.
    db.tables.photo_incidents[0].first_seen_at = "2026-10-03 10:00:00+00";
    await run(db, "2026-10-03T10:05:00.000Z", blocked());
    expect(incidentAlerts(db)).toHaveLength(1);
    expect(db.tables.photo_incidents[0]).toMatchObject({ status: "open", occurrences: 2 });
  });

  it("re-alerts when the same problem comes back after a recovery", async () => {
    const db = new FakeSupabase();
    await run(db, "2026-10-03T10:00:00.000Z", blocked());
    await run(db, "2026-10-03T10:10:00.000Z", ok());
    expect(db.tables.photo_incidents[0]).toMatchObject({ status: "resolved" });
    expect(recoveries(db)).toHaveLength(1);

    await run(db, "2026-10-03T11:00:00.000Z", blocked());
    // One row per owner + key: the resolved row is reopened, not duplicated.
    expect(db.tables.photo_incidents).toHaveLength(1);
    expect(db.tables.photo_incidents[0]).toMatchObject({ status: "open", resolved_at: null, first_seen_at: "2026-10-03T11:00:00.000Z", occurrences: 1 });
    expect(incidentAlerts(db).map((d) => d.alert_key)).toEqual([
      `incident:${db.tables.photo_incidents[0].incident_key}:2026-10-03T10:00:00.000Z`,
      `incident:${db.tables.photo_incidents[0].incident_key}:2026-10-03T11:00:00.000Z`,
    ]);

    // And it recovers again with its own recovery message.
    await run(db, "2026-10-03T11:10:00.000Z", ok());
    expect(recoveries(db)).toHaveLength(2);
  });
});
