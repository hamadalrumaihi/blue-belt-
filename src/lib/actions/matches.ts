"use server";

import { revalidatePath } from "next/cache";
import { requireOwnedAthlete, requireOwnedEvent } from "@/lib/authz";
import { normaliseName } from "@/lib/client-form";
import { composeLocalDivision, divisionLabel, findAgeGroup, findWeightDivision, rulesOf } from "@/lib/local-divisions";
import { manualChangeHistory, matchAthlete, parseBracketCsv, parseBracketRow, rowInstant, type BracketRow } from "@/lib/manual-matches";
import type { Database, Json } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import type { Platform } from "@/lib/types";
import { trimOrNull } from "@/lib/utils";
import { isUuid } from "@/lib/validation";

/**
 * Manual tracking: the owner enters and edits matches by hand for events
 * without a usable public bracket page. Rows are flagged is_manual, carry
 * round / result / next-round notes, and write the same history rows the
 * watcher does, so the history page and in-app alerts read them. Nothing
 * here claims a match was verified from a source.
 */
export type MatchActionResult = { ok: true; matchId: string } | { ok: false; error: string };

type Supa = Awaited<ReturnType<typeof createClient>>;
type MatchInsert = Database["public"]["Tables"]["photo_matches"]["Insert"];

async function eventContext(supabase: Supa, eventId: string | null) {
  if (!eventId) return { eventDate: null, timezone: "Asia/Qatar", platform: "OTHER" as string, division_rules: null as Json | null, tracking_mode: "watcher" as string };
  const { data } = await supabase.from("photo_events").select("event_date,timezone,platform,division_rules,tracking_mode").eq("id", eventId).maybeSingle();
  return { eventDate: data?.event_date ?? null, timezone: data?.timezone ?? "Asia/Qatar", platform: data?.platform ?? "OTHER", division_rules: data?.division_rules ?? null, tracking_mode: data?.tracking_mode ?? "watcher" };
}

/** Creates (no matchId) or updates (matchId) one hand-entered match for a client. */
export async function saveManualMatch(input: { athleteId: string; matchId?: string | null } & Record<string, unknown>): Promise<MatchActionResult> {
  if (!isUuid(input.athleteId)) return { ok: false, error: "Invalid client." };
  if (input.matchId && !isUuid(input.matchId)) return { ok: false, error: "Invalid match." };
  const parsed = parseBracketRow({ ...input, athlete: "x" });
  if (!parsed.ok) return { ok: false, error: parsed.error.replace(/^x: /, "") };
  const row = parsed.row;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You are signed out." };
  const owned = await requireOwnedAthlete(supabase, input.athleteId);
  if (!owned.ok) return { ok: false, error: owned.error };
  if (owned.ownerId !== user.id) return { ok: false, error: "Only the owner can enter matches." };
  const ctx = await eventContext(supabase, owned.eventId ?? null);
  const now = new Date();
  const scheduledAt = rowInstant(row, ctx.eventDate, ctx.timezone, now);

  const values = {
    opponent: row.opponent,
    mat: row.mat,
    scheduled_at: scheduledAt,
    status: row.status,
    round: row.round,
    result: row.result,
    next_round: row.nextRound,
    raw_snapshot: { manual: true, ...(row.matchNumber ? { matchNumber: row.matchNumber } : {}) } as Json,
    last_checked_at: now.toISOString(),
    updated_at: now.toISOString(),
  };

  let matchId = input.matchId ?? null;
  let history;
  if (matchId) {
    const { data: previous } = await supabase.from("photo_matches").select("id,athlete_id,mat,scheduled_at,status,opponent,is_manual").eq("id", matchId).eq("owner_id", user.id).maybeSingle();
    if (!previous || previous.athlete_id !== input.athleteId) return { ok: false, error: "Match not found or you do not own it." };
    history = manualChangeHistory(previous, { mat: values.mat, scheduled_at: values.scheduled_at, status: values.status, opponent: values.opponent }, ctx.timezone);
    const { error } = await supabase
      .from("photo_matches")
      .update({ ...values, is_manual: true, last_changed_at: history.length ? now.toISOString() : undefined })
      .eq("id", matchId)
      .eq("owner_id", user.id);
    if (error) return { ok: false, error: error.message };
  } else {
    history = manualChangeHistory(null, { mat: values.mat, scheduled_at: values.scheduled_at, status: values.status, opponent: values.opponent }, ctx.timezone);
    const insert: MatchInsert = { ...values, owner_id: user.id, athlete_id: input.athleteId, is_manual: true, source_url: null, last_changed_at: now.toISOString(), identity_confidence: "exact" };
    const { data, error } = await supabase.from("photo_matches").insert(insert).select("id").single();
    if (error) return { ok: false, error: error.message };
    matchId = data.id;
  }

  if (history.length) {
    await supabase.from("photo_match_history").insert(history.map((h) => ({ owner_id: user.id, match_id: matchId!, change_type: h.change_type, old_value: h.old_value as Json, new_value: h.new_value as Json, detected_at: now.toISOString() })));
  }
  revalidateMatchPaths(input.athleteId, owned.eventId ?? null);
  return { ok: true, matchId: matchId! };
}

export async function deleteManualMatch(matchId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isUuid(matchId)) return { ok: false, error: "Invalid match." };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You are signed out." };
  const { data: match } = await supabase.from("photo_matches").select("id,athlete_id,is_manual").eq("id", matchId).eq("owner_id", user.id).maybeSingle();
  if (!match) return { ok: false, error: "Match not found or you do not own it." };
  if (!match.is_manual) return { ok: false, error: "Only hand-entered matches can be deleted here. Source matches are removed with the client's match data." };
  const owned = await requireOwnedAthlete(supabase, match.athlete_id);
  const { error } = await supabase.from("photo_matches").delete().eq("id", matchId).eq("owner_id", user.id);
  if (error) return { ok: false, error: error.message };
  revalidateMatchPaths(match.athlete_id, owned.ok ? owned.eventId ?? null : null);
  return { ok: true };
}

export type BracketApplyReport = {
  matchesCreated: number;
  clientsCreated: number;
  skipped: Array<{ line: number; reason: string }>;
};

export type BracketApplyResult = { ok: true; report: BracketApplyReport } | { ok: false; error: string };

/**
 * Applies reviewed bracket rows (CSV or screenshot) to an event: one manual
 * match per row, attached to the named client. Unknown names are skipped
 * unless `createMissing`, which adds them as clients (no URL, the event's
 * platform, division labels mapped onto the event's chart).
 */
export async function applyBracketRows(eventId: string, rawRows: unknown[], options: { createMissing?: boolean } = {}): Promise<BracketApplyResult> {
  if (!isUuid(eventId)) return { ok: false, error: "Invalid event." };
  if (!Array.isArray(rawRows) || rawRows.length === 0) return { ok: false, error: "Nothing to import." };
  if (rawRows.length > 300) return { ok: false, error: "Import at most 300 rows at a time." };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You are signed out." };
  const event = await requireOwnedEvent(supabase, eventId);
  if (!event.ok) return { ok: false, error: event.error };
  if (event.ownerId !== user.id) return { ok: false, error: "Only the owner can import brackets." };
  const ctx = await eventContext(supabase, eventId);
  const rules = rulesOf({ platform: ctx.platform, division_rules: ctx.division_rules });

  const { data: existing } = await supabase.from("photo_athletes").select("id,name").eq("event_id", eventId);
  const athletes = [...(existing ?? [])];
  const report: BracketApplyReport = { matchesCreated: 0, clientsCreated: 0, skipped: [] };
  const now = new Date();

  for (let i = 0; i < rawRows.length; i += 1) {
    const line = i + 1;
    const raw = rawRows[i];
    const parsed = parseBracketRow(raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {});
    if (!parsed.ok) {
      report.skipped.push({ line, reason: parsed.error });
      continue;
    }
    const row = parsed.row;
    let athlete = matchAthlete(athletes, row.athlete);
    if (!athlete) {
      if (!options.createMissing) {
        report.skipped.push({ line, reason: `${row.athlete} is not a client in this event.` });
        continue;
      }
      const created = await createClientFromRow(supabase, user.id, eventId, ctx.platform, rules, row);
      if (!created.ok) {
        report.skipped.push({ line, reason: `${row.athlete}: ${created.error}` });
        continue;
      }
      athlete = created.athlete;
      athletes.push(athlete);
      report.clientsCreated += 1;
    }
    const scheduledAt = rowInstant(row, ctx.eventDate, ctx.timezone, now);
    const insert: MatchInsert = {
      owner_id: user.id,
      athlete_id: athlete.id,
      opponent: row.opponent,
      mat: row.mat,
      scheduled_at: scheduledAt,
      status: row.status,
      round: row.round,
      result: row.result,
      next_round: row.nextRound,
      is_manual: true,
      source_url: null,
      identity_confidence: "exact",
      raw_snapshot: { manual: true, ...(row.matchNumber ? { matchNumber: row.matchNumber } : {}) } as Json,
      last_checked_at: now.toISOString(),
      last_changed_at: now.toISOString(),
    };
    const { data, error } = await supabase.from("photo_matches").insert(insert).select("id").single();
    if (error) {
      report.skipped.push({ line, reason: `${row.athlete}: ${error.message}` });
      continue;
    }
    const h = manualChangeHistory(null, { mat: row.mat, scheduled_at: scheduledAt, status: row.status, opponent: row.opponent }, ctx.timezone)[0];
    await supabase.from("photo_match_history").insert({ owner_id: user.id, match_id: data.id, change_type: h.change_type, old_value: h.old_value as Json, new_value: h.new_value as Json, detected_at: now.toISOString() });
    report.matchesCreated += 1;
  }
  revalidateMatchPaths(null, eventId);
  return { ok: true, report };
}

async function createClientFromRow(supabase: Supa, ownerId: string, eventId: string, platform: string, rules: ReturnType<typeof rulesOf>, row: BracketRow) {
  const group = rules ? findAgeGroup(rules, row.ageGroup) : null;
  const div = rules && group ? findWeightDivision(group, row.division) : null;
  const { data, error } = await supabase
    .from("photo_athletes")
    .insert({
      owner_id: ownerId,
      event_id: eventId,
      name: row.athlete,
      platform: (platform === "LOCAL" ? "LOCAL" : "OTHER") as Platform,
      source_url: null,
      academy: row.team,
      age_category: group?.label ?? row.ageGroup,
      weight: div ? divisionLabel(div) : row.division,
      division: rules ? composeLocalDivision(group, div) || [row.ageGroup, row.division].filter(Boolean).join(" · ") || null : [row.ageGroup, row.division].filter(Boolean).join(" · ") || null,
      internal_notes: "Added from a bracket import; check the details.",
    })
    .select("id,name")
    .single();
  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const, athlete: data };
}

export type BracketImportState = { error?: string; fieldErrors?: Record<string, string>; report?: BracketApplyReport; preview?: Array<{ line: number; error: string }> } | null;

/** Form action: a bracket CSV (file or pasted) for one event. */
export async function importBracketCsv(_prev: BracketImportState, formData: FormData): Promise<BracketImportState> {
  const eventId = trimOrNull(formData.get("event_id"));
  if (!eventId || !isUuid(eventId)) return { fieldErrors: { event_id: "Choose an event." } };
  const file = formData.get("file");
  let text = trimOrNull(formData.get("csv")) ?? "";
  if (file instanceof File && file.size) {
    if (file.size > 512 * 1024) return { error: "CSV is larger than 512 KB." };
    text = await file.text();
  }
  if (!text.trim()) return { fieldErrors: { csv: "Paste CSV text or choose a file." } };
  const parsed = parseBracketCsv(text);
  if (parsed.error) return { fieldErrors: { csv: parsed.error } };
  const good = parsed.rows.filter((r) => r.parsed.ok).map((r) => (r.parsed as { ok: true; row: BracketRow }).row);
  const bad = parsed.rows.filter((r) => !r.parsed.ok).map((r) => ({ line: r.line, error: (r.parsed as { ok: false; error: string }).error }));
  if (!good.length) return { fieldErrors: { csv: bad[0]?.error ?? "No rows to import." }, preview: bad };
  const applied = await applyBracketRows(eventId, good, { createMissing: formData.get("create_missing") === "1" });
  if (!applied.ok) return { error: applied.error, preview: bad };
  const report = { ...applied.report, skipped: [...bad.map((b) => ({ line: b.line, reason: b.error })), ...applied.report.skipped] };
  return { report };
}

/** Clients of an event with the names the review screens match against. */
export async function listEventClientNames(eventId: string): Promise<Array<{ id: string; name: string; key: string }>> {
  if (!isUuid(eventId)) return [];
  const supabase = await createClient();
  const { data } = await supabase.from("photo_athletes").select("id,name").eq("event_id", eventId).order("name");
  return (data ?? []).map((a) => ({ id: a.id, name: a.name, key: normaliseName(a.name) }));
}

function revalidateMatchPaths(athleteId: string | null, eventId: string | null) {
  if (athleteId) revalidatePath(`/clients/${athleteId}`);
  if (eventId) {
    revalidatePath(`/events/${eventId}`);
    revalidatePath(`/events/${eventId}/brackets`);
  }
  revalidatePath("/watcher");
  revalidatePath("/dashboard");
  revalidatePath("/history");
  revalidatePath("/coverage");
}
