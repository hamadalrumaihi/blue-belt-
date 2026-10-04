import type {
  PhotoAthleteRow,
  PhotoEventRow,
  PhotoMatchHistoryRow,
  PhotoMatchRow,
} from "./supabase/database.types";

export type Platform = "AJP" | "SMOOTHCOMP" | "OTHER";

export const PLATFORMS: { value: Platform; label: string }[] = [
  { value: "AJP", label: "AJP" },
  { value: "SMOOTHCOMP", label: "Smoothcomp" },
  { value: "OTHER", label: "Other" },
];

/** Persisted match status (photo_matches.status). */
export type MatchStatus = "scheduled" | "on_mat" | "complete" | "delayed" | "unknown";

export const MATCH_STATUSES: MatchStatus[] = [
  "scheduled",
  "on_mat",
  "complete",
  "delayed",
  "unknown",
];

export type EventRow = PhotoEventRow;
export type AthleteRow = PhotoAthleteRow;
export type MatchRow = PhotoMatchRow;
export type HistoryRow = PhotoMatchHistoryRow;

/** Athlete with all their tracked matches (already loaded). */
export type AthleteWithMatches = AthleteRow & {
  matches: MatchRow[];
  event?: Pick<EventRow, "id" | "name" | "timezone" | "platform"> | null;
};

/** History row joined with athlete context for the activity feed. */
export type HistoryEntry = HistoryRow & {
  athlete_id: string | null;
  athlete_name: string | null;
  event_id: string | null;
};

export type ChangeType =
  | "MAT_CHANGE"
  | "TIME_CHANGE"
  | "ETA_CHANGE"
  | "OPPONENT_CHANGE"
  | "STATUS_CHANGE"
  | "ORDER_CHANGE"
  | "MATCH_NUMBER_CHANGE"
  | "MATCH_FOUND"
  | "IDENTITY_AMBIGUOUS"
  | "MANUAL_CORRECTION"
  | "OVERRIDE_SUPERSEDED";

export function isPlatform(value: string): value is Platform {
  return value === "AJP" || value === "SMOOTHCOMP" || value === "OTHER";
}

export function isMatchStatus(value: string): value is MatchStatus {
  return (MATCH_STATUSES as string[]).includes(value);
}
