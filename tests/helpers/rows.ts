import type { HistoryEntry, AthleteRow, AthleteWithMatches, EventRow, MatchRow } from "@/lib/types";
import type { NormalizedMatch, WatchContext, WatchResult } from "@/lib/watchers/types";

/** Row factories with every column populated so strict typing holds in tests. */

export const OWNER = "11111111-1111-4111-8111-111111111111";
export const ATHLETE_ID = "22222222-2222-4222-8222-222222222222";
export const EVENT_ID = "33333333-3333-4333-8333-333333333333";

export function matchRow(overrides: Partial<MatchRow> = {}): MatchRow {
  return {
    id: "aaaaaaaa-0000-4000-8000-000000000001",
    owner_id: OWNER,
    athlete_id: ATHLETE_ID,
    external_match_id: null,
    opponent: null,
    mat: null,
    scheduled_at: null,
    estimated_at: null,
    status: "scheduled",
    match_order: null,
    source_url: "https://ajptour.com/events/4471/brackets/88",
    last_checked_at: "2026-03-14T06:00:00.000Z",
    last_changed_at: "2026-03-14T06:00:00.000Z",
    raw_snapshot: {},
    identity_confidence: "exact",
    created_at: "2026-03-14T06:00:00.000Z",
    updated_at: "2026-03-14T06:00:00.000Z",
    ...overrides,
  };
}

export function athleteRow(overrides: Partial<AthleteRow> = {}): AthleteRow {
  return {
    id: ATHLETE_ID,
    owner_id: OWNER,
    event_id: EVENT_ID,
    name: "Hamad Al Rumaihi",
    name_key: "hamad al rumaihi",
    phone: null,
    email: null,
    division: "Male / Brown / Adult / 77kg",
    academy: null,
    platform: "AJP",
    source_url: "https://ajptour.com/events/4471/brackets/88",
    notes: null,
    belt: "brown",
    weight: "77",
    gender: null,
    age_category: null,
    package_name: null,
    internal_notes: null,
    last_checked_at: null,
    last_attempt_at: null,
    last_success_at: null,
    consecutive_failures: 0,
    last_watch_status: null,
    last_watch_code: null,
    last_watch_message: null,
    last_watch_strategy: null,
    last_source_status: null,
    last_final_url: null,
    last_elapsed_ms: null,
    refresh_version: 0,
    active: true,
    created_at: "2026-03-01T00:00:00.000Z",
    updated_at: "2026-03-01T00:00:00.000Z",
    ...overrides,
  };
}

export function eventRow(overrides: Partial<EventRow> = {}): EventRow {
  return {
    id: EVENT_ID,
    owner_id: OWNER,
    name: "Qatar National Pro 2026",
    venue: "Lusail Sports Arena",
    country: "QA",
    event_date: "2026-03-14",
    platform: "AJP",
    source_url: null,
    timezone: "Asia/Qatar",
    active: true,
    created_at: "2026-03-01T00:00:00.000Z",
    updated_at: "2026-03-01T00:00:00.000Z",
    ...overrides,
  };
}

export function athleteWithMatches(name: string, matches: MatchRow[], overrides: Partial<AthleteRow> = {}): AthleteWithMatches {
  const id = overrides.id ?? `${name.toLowerCase().replace(/[^a-z]/g, "").padEnd(8, "a").slice(0, 8)}-0000-4000-8000-000000000000`;
  return { ...athleteRow({ id, name, ...overrides }), matches: matches.map((m) => ({ ...m, athlete_id: id })) };
}

let historyId = 0;
export function historyEntry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  historyId += 1;
  return {
    id: historyId,
    owner_id: OWNER,
    match_id: "aaaaaaaa-0000-4000-8000-000000000001",
    change_type: "MAT_CHANGE",
    old_value: { value: "Mat 1", label: "Mat 1" },
    new_value: { value: "Mat 3", label: "Mat 3" },
    detected_at: "2026-03-14T07:00:00.000Z",
    athlete_id: ATHLETE_ID,
    athlete_name: "Hamad Al Rumaihi",
    event_id: EVENT_ID,
    ...overrides,
  };
}

export function normalized(overrides: Partial<NormalizedMatch> = {}): NormalizedMatch {
  return {
    athlete: "Hamad Al-Rumaihi",
    opponent: "João Silva",
    mat: "Mat 3",
    scheduledAt: "2026-03-14T07:40:00.000Z",
    estimatedAt: null,
    matchNumber: null,
    matchOrder: null,
    status: "scheduled",
    sourceUrl: "https://ajptour.com/events/4471/brackets/88",
    externalMatchId: null,
    raw: { text: "12 | Mat 3 | 10:40 | Hamad Al-Rumaihi | João Silva | Scheduled" },
    ...overrides,
  };
}

export function watchResult(overrides: Partial<WatchResult> = {}): WatchResult {
  return {
    platform: "AJP",
    status: "OK",
    code: "MATCHES_FOUND",
    athlete: "Hamad Al Rumaihi",
    matches: [normalized()],
    sourceUrl: "https://ajptour.com/events/4471/brackets/88",
    fetchedAt: "2026-03-14T06:30:00.000Z",
    strategy: "http:table",
    ...overrides,
  };
}

export function watchContext(overrides: Partial<WatchContext> = {}): WatchContext {
  return {
    url: new URL("https://ajptour.com/events/4471/brackets/88"),
    athleteName: "Hamad Al Rumaihi",
    timezone: "Asia/Qatar",
    eventDate: "2026-03-14",
    now: new Date("2026-03-14T06:00:00.000Z"),
    ...overrides,
  };
}
