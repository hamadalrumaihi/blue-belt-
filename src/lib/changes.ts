import type { ChangeType, MatchRow } from "./types";
import type { NormalizedMatch } from "./watchers/types";
import { formatTime } from "./time";
import { STATUS_LABEL } from "./eta";
import { isMatchStatus } from "./types";

export type ChangeValue = { value: string | number | null; label: string };

export type DetectedChange = {
  change_type: ChangeType;
  old_value: ChangeValue;
  new_value: ChangeValue;
};

const TIME_FIELDS = new Set(["scheduled_at", "estimated_at"]);

function label(field: string, value: string | number | null, timezone: string): string {
  if (value === null || value === undefined || value === "") return "Unknown";
  if (TIME_FIELDS.has(field)) return formatTime(String(value), timezone);
  if (field === "status") {
    const s = String(value);
    return isMatchStatus(s) ? STATUS_LABEL[s] : s;
  }
  if (field === "match_order") return `#${value}`;
  return String(value);
}

/** Compares the stored match with freshly parsed data and lists meaningful changes. */
export function detectChanges(previous: MatchRow, next: NormalizedMatch, timezone: string): DetectedChange[] {
  const previousNumber = typeof previous.raw_snapshot === "object" && previous.raw_snapshot && !Array.isArray(previous.raw_snapshot)
    ? ((previous.raw_snapshot as Record<string, unknown>).matchNumber as string | null | undefined) ?? null
    : null;

  const fields: Array<{ field: string; type: ChangeType; prev: string | number | null; nxt: string | number | null }> = [
    { field: "mat", type: "MAT_CHANGE", prev: previous.mat, nxt: next.mat },
    { field: "scheduled_at", type: "TIME_CHANGE", prev: normalizeIso(previous.scheduled_at), nxt: normalizeIso(next.scheduledAt) },
    { field: "estimated_at", type: "ETA_CHANGE", prev: normalizeIso(previous.estimated_at), nxt: normalizeIso(next.estimatedAt) },
    { field: "opponent", type: "OPPONENT_CHANGE", prev: previous.opponent, nxt: next.opponent },
    { field: "status", type: "STATUS_CHANGE", prev: previous.status, nxt: next.status },
    { field: "match_order", type: "ORDER_CHANGE", prev: previous.match_order, nxt: next.matchOrder },
    { field: "match_number", type: "MATCH_NUMBER_CHANGE", prev: previousNumber, nxt: next.matchNumber },
  ];

  const changes: DetectedChange[] = [];
  for (const f of fields) {
    // Never report "known -> unknown" for opponent/mat: a transient parse gap is not a change.
    if ((f.field === "opponent" || f.field === "mat") && f.prev && !f.nxt) continue;
    if (f.field === "status" && f.nxt === "unknown") continue;
    if (same(f.prev, f.nxt)) continue;
    changes.push({
      change_type: f.type,
      old_value: { value: f.prev, label: label(f.field, f.prev, timezone) },
      new_value: { value: f.nxt, label: label(f.field, f.nxt, timezone) },
    });
  }
  return changes;
}

function normalizeIso(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

function same(a: string | number | null, b: string | number | null): boolean {
  const na = a === undefined || a === null || a === "" ? null : String(a).trim().toLowerCase();
  const nb = b === undefined || b === null || b === "" ? null : String(b).trim().toLowerCase();
  return na === nb;
}

/** Applies parsed data on top of the stored row; nulls never erase known values. */
export function mergeMatch(previous: MatchRow | null, next: NormalizedMatch, now: string): Omit<MatchRow, "id" | "owner_id" | "athlete_id" | "created_at" | "updated_at" | "identity_confidence"> {
  const changed = previous ? detectChanges(previous, next, "UTC").length > 0 : true;
  return {
    external_match_id: next.externalMatchId ?? previous?.external_match_id ?? null,
    opponent: next.opponent ?? previous?.opponent ?? null,
    mat: next.mat ?? previous?.mat ?? null,
    scheduled_at: next.scheduledAt ?? previous?.scheduled_at ?? null,
    estimated_at: next.estimatedAt ?? previous?.estimated_at ?? null,
    status: next.status === "unknown" && previous ? previous.status : next.status,
    match_order: next.matchOrder ?? previous?.match_order ?? null,
    source_url: next.sourceUrl,
    last_checked_at: now,
    last_changed_at: changed ? now : previous?.last_changed_at ?? now,
    raw_snapshot: {
      matchNumber: next.matchNumber,
      athlete: next.athlete,
      ...next.raw,
    },
    // A refresh carries the owner's correction forward untouched; refresh-plan
    // clears it explicitly when the source itself changes the corrected field.
    override_mat: previous?.override_mat ?? null,
    override_scheduled_at: previous?.override_scheduled_at ?? null,
    override_by: previous?.override_by ?? null,
    override_at: previous?.override_at ?? null,
    override_reason: previous?.override_reason ?? null,
    override_until: previous?.override_until ?? null,
  };
}

export const CHANGE_LABEL: Record<ChangeType, string> = {
  MAT_CHANGE: "Mat change",
  TIME_CHANGE: "Time change",
  ETA_CHANGE: "ETA change",
  OPPONENT_CHANGE: "Opponent change",
  STATUS_CHANGE: "Status change",
  ORDER_CHANGE: "Match order change",
  MATCH_NUMBER_CHANGE: "Match number change",
  MATCH_FOUND: "Match found",
  IDENTITY_AMBIGUOUS: "Needs review (similar matches)",
  MANUAL_CORRECTION: "Manual correction",
  OVERRIDE_SUPERSEDED: "Manual correction superseded by the source",
};

export function isChangeType(value: string): value is ChangeType {
  return value in CHANGE_LABEL;
}
