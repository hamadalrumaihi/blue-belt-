import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { detectChanges, mergeMatch, type DetectedChange } from "./changes";
import type { Database, Json } from "./supabase/database.types";
import { DEFAULT_TIMEZONE } from "./time";
import type { AthleteRow, EventRow, MatchRow } from "./types";
import { normalizeName } from "./watchers/extract";
import { watchUrl } from "./watchers";
import type { NormalizedMatch, WatchResult, WatchStatus } from "./watchers/types";

type Client = SupabaseClient<Database>;

export type RefreshResult = {
  athleteId: string;
  athleteName: string;
  status: WatchStatus | "ERROR";
  message?: string;
  matches: MatchRow[];
  changes: Array<DetectedChange & { match_id: string }>;
  checkedAt: string;
  sourceUrl: string | null;
};

const STAGGER_MS = 350;
const CONCURRENCY = 2;

/**
 * Refreshes many athletes with bounded concurrency and a small stagger so a
 * long client list never hammers the source site. Each athlete is isolated:
 * a failure produces an ERROR result instead of rejecting the batch.
 */
export async function refreshAthletes(
  supabase: Client,
  athletes: AthleteRow[],
  events: Map<string, EventRow>,
): Promise<RefreshResult[]> {
  const results: RefreshResult[] = new Array(athletes.length);
  let cursor = 0;

  async function worker() {
    while (cursor < athletes.length) {
      const index = cursor++;
      const athlete = athletes[index];
      if (index > 0) await sleep(STAGGER_MS);
      results[index] = await refreshAthlete(
        supabase,
        athlete,
        athlete.event_id ? events.get(athlete.event_id) ?? null : null,
      );
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, athletes.length) }, worker));
  return results;
}

/** Fetches, parses, diffs and persists one athlete. Never throws. */
export async function refreshAthlete(supabase: Client, athlete: AthleteRow, event: EventRow | null): Promise<RefreshResult> {
  const checkedAt = new Date().toISOString();
  const base = { athleteId: athlete.id, athleteName: athlete.name, checkedAt, sourceUrl: athlete.source_url };

  try {
    const result = await watchUrl(athlete.source_url, {
      athleteName: athlete.name,
      timezone: event?.timezone ?? DEFAULT_TIMEZONE,
      eventDate: event?.event_date ?? null,
    });

    const { matches, changes } = await persist(supabase, athlete, event, result, checkedAt);

    await supabase
      .from("photo_athletes")
      .update({ last_checked_at: checkedAt, last_watch_status: result.status, last_watch_message: result.message ?? null })
      .eq("id", athlete.id);

    return { ...base, status: result.status, message: result.message, matches, changes };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unable to refresh";
    await supabase
      .from("photo_athletes")
      .update({ last_checked_at: checkedAt, last_watch_status: "ERROR", last_watch_message: message })
      .eq("id", athlete.id)
      .then(() => undefined, () => undefined);
    const { data } = await supabase.from("photo_matches").select("*").eq("athlete_id", athlete.id);
    return { ...base, status: "ERROR", message, matches: data ?? [], changes: [] };
  }
}

async function persist(
  supabase: Client,
  athlete: AthleteRow,
  event: EventRow | null,
  result: WatchResult,
  checkedAt: string,
): Promise<{ matches: MatchRow[]; changes: Array<DetectedChange & { match_id: string }> }> {
  const { data: existingRows, error } = await supabase
    .from("photo_matches")
    .select("*")
    .eq("athlete_id", athlete.id)
    .order("match_order", { ascending: true, nullsFirst: false });
  if (error) throw error;
  const existing = existingRows ?? [];

  if (result.status !== "OK" || !result.matches.length) {
    // Keep what we know; just mark it as checked.
    if (existing.length) {
      await supabase.from("photo_matches").update({ last_checked_at: checkedAt }).eq("athlete_id", athlete.id);
    }
    return { matches: existing.map((m) => ({ ...m, last_checked_at: checkedAt })), changes: [] };
  }

  const timezone = event?.timezone ?? DEFAULT_TIMEZONE;
  const unmatched = [...existing];
  const changes: Array<DetectedChange & { match_id: string }> = [];
  const historyRows: Database["public"]["Tables"]["photo_match_history"]["Insert"][] = [];
  const updated: MatchRow[] = [];

  for (const parsed of result.matches) {
    const previous = takeMatching(unmatched, parsed, result.matches.length);
    const patch = mergeMatch(previous, parsed, checkedAt);

    if (previous) {
      const detected = detectChanges(previous, parsed, timezone);
      const { data, error: updErr } = await supabase
        .from("photo_matches")
        .update(patch)
        .eq("id", previous.id)
        .select("*")
        .single();
      if (updErr) throw updErr;
      updated.push(data);
      for (const c of detected) {
        changes.push({ ...c, match_id: previous.id });
        historyRows.push({ owner_id: athlete.owner_id, match_id: previous.id, change_type: c.change_type, old_value: c.old_value as Json, new_value: c.new_value as Json, detected_at: checkedAt });
      }
    } else {
      const { data, error: insErr } = await supabase
        .from("photo_matches")
        .insert({ ...patch, athlete_id: athlete.id, owner_id: athlete.owner_id })
        .select("*")
        .single();
      if (insErr) throw insErr;
      updated.push(data);
      const found: DetectedChange = {
        change_type: "MATCH_FOUND",
        old_value: { value: null, label: "No match" },
        new_value: { value: data.id, label: describeMatch(data, timezone) },
      };
      changes.push({ ...found, match_id: data.id });
      historyRows.push({ owner_id: athlete.owner_id, match_id: data.id, change_type: "MATCH_FOUND", old_value: found.old_value as Json, new_value: found.new_value as Json, detected_at: checkedAt });
    }
  }

  if (historyRows.length) {
    const { error: histErr } = await supabase.from("photo_match_history").insert(historyRows);
    if (histErr) throw histErr;
  }

  // Rows the source no longer lists are kept (user controls deletion) but marked checked.
  if (unmatched.length) {
    await supabase
      .from("photo_matches")
      .update({ last_checked_at: checkedAt })
      .in("id", unmatched.map((m) => m.id));
  }

  return { matches: [...updated, ...unmatched.map((m) => ({ ...m, last_checked_at: checkedAt }))], changes };
}

/**
 * Finds the stored row that corresponds to a parsed match and removes it from
 * the pool. Identity: external id, then match number, then a single-match
 * athlete, then opponent name, then scheduled time.
 */
function takeMatching(pool: MatchRow[], parsed: NormalizedMatch, parsedCount: number): MatchRow | null {
  const take = (idx: number) => (idx >= 0 ? pool.splice(idx, 1)[0] : null);

  if (parsed.externalMatchId) {
    const idx = pool.findIndex((m) => m.external_match_id === parsed.externalMatchId);
    if (idx >= 0) return take(idx);
  }
  if (parsed.matchNumber) {
    const idx = pool.findIndex((m) => snapshotNumber(m) === parsed.matchNumber);
    if (idx >= 0) return take(idx);
  }
  if (pool.length === 1 && parsedCount === 1) return take(0);
  if (parsed.opponent) {
    const idx = pool.findIndex((m) => normalizeName(m.opponent) === normalizeName(parsed.opponent));
    if (idx >= 0) return take(idx);
  }
  if (parsed.scheduledAt) {
    const t = new Date(parsed.scheduledAt).getTime();
    const idx = pool.findIndex((m) => m.scheduled_at && Math.abs(new Date(m.scheduled_at).getTime() - t) < 60_000);
    if (idx >= 0) return take(idx);
  }
  return null;
}

function snapshotNumber(m: MatchRow): string | null {
  const snap = m.raw_snapshot;
  if (snap && typeof snap === "object" && !Array.isArray(snap)) {
    const n = (snap as Record<string, unknown>).matchNumber;
    return typeof n === "string" ? n : typeof n === "number" ? String(n) : null;
  }
  return null;
}

function describeMatch(m: MatchRow, timezone: string): string {
  const parts: string[] = [];
  if (m.mat) parts.push(m.mat);
  if (m.scheduled_at) {
    parts.push(new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(m.scheduled_at)));
  }
  if (m.opponent) parts.push(`vs ${m.opponent}`);
  return parts.join(" · ") || "Match added";
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
