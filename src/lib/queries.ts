import "server-only";
import { createClient } from "./supabase/server";
import { todayInZone } from "./time";
import type { AthleteRow, AthleteWithMatches, EventRow, HistoryEntry, MatchRow } from "./types";

/** All events, active first, nearest date first. */
export async function listEvents(): Promise<EventRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("photo_events")
    .select("*")
    .order("active", { ascending: false })
    .order("event_date", { ascending: true, nullsFirst: false });
  if (error) throw error;
  return data ?? [];
}

export async function getEvent(id: string): Promise<EventRow | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("photo_events").select("*").eq("id", id).maybeSingle();
  return data ?? null;
}

/**
 * The event the dashboard should focus on: the active event happening today
 * or next, else the most recent active one, else the newest event.
 */
export function pickCurrentEvent(events: EventRow[], preferredId?: string | null): EventRow | null {
  if (!events.length) return null;
  if (preferredId) {
    const preferred = events.find((e) => e.id === preferredId);
    if (preferred) return preferred;
  }
  const today = todayInZone();
  const active = events.filter((e) => e.active);
  const upcoming = active
    .filter((e) => e.event_date && e.event_date >= today)
    .sort((a, b) => (a.event_date ?? "").localeCompare(b.event_date ?? ""));
  if (upcoming.length) return upcoming[0];
  const past = active
    .filter((e) => e.event_date)
    .sort((a, b) => (b.event_date ?? "").localeCompare(a.event_date ?? ""));
  if (past.length) return past[0];
  return active[0] ?? events[0];
}

export async function listAthletes(eventId?: string | null): Promise<AthleteWithMatches[]> {
  const supabase = await createClient();
  let query = supabase.from("photo_athletes").select("*").order("name", { ascending: true });
  if (eventId) query = query.eq("event_id", eventId);
  const { data: athletes, error } = await query;
  if (error) throw error;
  return attachMatches(athletes ?? []);
}

export async function getAthlete(id: string): Promise<AthleteWithMatches | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("photo_athletes").select("*").eq("id", id).maybeSingle();
  if (!data) return null;
  const [withMatches] = await attachMatches([data]);
  return withMatches;
}

async function attachMatches(athletes: AthleteRow[]): Promise<AthleteWithMatches[]> {
  if (!athletes.length) return [];
  const supabase = await createClient();
  const ids = athletes.map((a) => a.id);
  const eventIds = [...new Set(athletes.map((a) => a.event_id).filter((v): v is string => Boolean(v)))];

  const [{ data: matches }, { data: events }] = await Promise.all([
    supabase.from("photo_matches").select("*").in("athlete_id", ids),
    eventIds.length
      ? supabase.from("photo_events").select("id,name,timezone,platform,tracking_mode,event_date").in("id", eventIds)
      : Promise.resolve({ data: [] as Pick<EventRow, "id" | "name" | "timezone" | "platform" | "tracking_mode" | "event_date">[] }),
  ]);

  const byAthlete = new Map<string, MatchRow[]>();
  for (const m of matches ?? []) {
    const list = byAthlete.get(m.athlete_id) ?? [];
    list.push(m);
    byAthlete.set(m.athlete_id, list);
  }
  const eventById = new Map((events ?? []).map((e) => [e.id, e]));

  return athletes.map((a) => ({
    ...a,
    matches: byAthlete.get(a.id) ?? [],
    event: a.event_id ? eventById.get(a.event_id) ?? null : null,
  }));
}

export type EventStats = {
  clients: number;
  matches: number;
};

export async function eventStats(eventIds: string[]): Promise<Map<string, EventStats>> {
  const stats = new Map<string, EventStats>();
  if (!eventIds.length) return stats;
  const supabase = await createClient();
  const { data: athletes } = await supabase.from("photo_athletes").select("id,event_id").in("event_id", eventIds);
  const athleteIds = (athletes ?? []).map((a) => a.id);
  const { data: matches } = athleteIds.length
    ? await supabase.from("photo_matches").select("athlete_id").in("athlete_id", athleteIds)
    : { data: [] as { athlete_id: string }[] };

  const eventOfAthlete = new Map((athletes ?? []).map((a) => [a.id, a.event_id]));
  for (const id of eventIds) stats.set(id, { clients: 0, matches: 0 });
  for (const a of athletes ?? []) {
    if (!a.event_id) continue;
    const s = stats.get(a.event_id);
    if (s) s.clients += 1;
  }
  for (const m of matches ?? []) {
    const eventId = eventOfAthlete.get(m.athlete_id);
    const s = eventId ? stats.get(eventId) : undefined;
    if (s) s.matches += 1;
  }
  return stats;
}

export type HistoryFilters = {
  eventId?: string | null;
  athleteId?: string | null;
  changeType?: string | null;
  limit?: number;
  /** Opaque cursor from a previous page (see encodeHistoryCursor). */
  cursor?: string | null;
};

export type HistoryPage = { entries: HistoryEntry[]; nextCursor: string | null };

/** Cursor = "<detected_at ISO>|<id>" base64url; rows are ordered (detected_at desc, id desc). */
export function encodeHistoryCursor(entry: Pick<HistoryEntry, "detected_at" | "id">): string {
  return Buffer.from(`${entry.detected_at}|${entry.id}`, "utf8").toString("base64url");
}

export function decodeHistoryCursor(cursor: string | null | undefined): { detectedAt: string; id: number } | null {
  if (!cursor) return null;
  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf8");
    const sep = raw.lastIndexOf("|");
    if (sep < 0) return null;
    const detectedAt = raw.slice(0, sep);
    const id = Number(raw.slice(sep + 1));
    if (!Number.isInteger(id) || Number.isNaN(new Date(detectedAt).getTime())) return null;
    return { detectedAt, id };
  } catch {
    return null;
  }
}

/** Recent change history with athlete names attached (first page). */
export async function listHistory(options: Omit<HistoryFilters, "cursor"> = {}): Promise<HistoryEntry[]> {
  return (await listHistoryPage(options)).entries;
}

/**
 * Cursor-paginated change history. Uses the (owner_id, detected_at desc,
 * id desc) index; the cursor is a keyset so pages stay stable while new
 * rows arrive at the top.
 */
export async function listHistoryPage(options: HistoryFilters = {}): Promise<HistoryPage> {
  const supabase = await createClient();
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);

  // Scope match ids by athlete/event when asked.
  let matchIds: string[] | null = null;
  if (options.athleteId || options.eventId) {
    let athletesQuery = supabase.from("photo_athletes").select("id");
    if (options.athleteId) athletesQuery = athletesQuery.eq("id", options.athleteId);
    if (options.eventId) athletesQuery = athletesQuery.eq("event_id", options.eventId);
    const { data: athletes } = await athletesQuery;
    const ids = (athletes ?? []).map((a) => a.id);
    if (!ids.length) return { entries: [], nextCursor: null };
    const { data: matches } = await supabase.from("photo_matches").select("id").in("athlete_id", ids);
    matchIds = (matches ?? []).map((m) => m.id);
    if (!matchIds.length) return { entries: [], nextCursor: null };
  }

  let query = supabase
    .from("photo_match_history")
    .select("*")
    .order("detected_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);
  if (matchIds) query = query.in("match_id", matchIds);
  if (options.changeType) query = query.eq("change_type", options.changeType);
  const after = decodeHistoryCursor(options.cursor);
  if (after) query = query.or(`detected_at.lt.${after.detectedAt},and(detected_at.eq.${after.detectedAt},id.lt.${after.id})`);
  const { data: rows, error } = await query;
  if (error) throw error;
  if (!rows?.length) return { entries: [], nextCursor: null };

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;

  const ids = [...new Set(pageRows.map((r) => r.match_id))];
  const { data: matches } = await supabase.from("photo_matches").select("id,athlete_id").in("id", ids);
  const athleteIds = [...new Set((matches ?? []).map((m) => m.athlete_id))];
  const { data: athletes } = athleteIds.length
    ? await supabase.from("photo_athletes").select("id,name,event_id").in("id", athleteIds)
    : { data: [] as Pick<AthleteRow, "id" | "name" | "event_id">[] };

  const athleteOfMatch = new Map((matches ?? []).map((m) => [m.id, m.athlete_id]));
  const athleteById = new Map((athletes ?? []).map((a) => [a.id, a]));

  const entries = pageRows.map((r) => {
    const athleteId = athleteOfMatch.get(r.match_id) ?? null;
    const athlete = athleteId ? athleteById.get(athleteId) : undefined;
    return { ...r, athlete_id: athleteId, athlete_name: athlete?.name ?? null, event_id: athlete?.event_id ?? null };
  });
  const last = entries.at(-1);
  return { entries, nextCursor: hasMore && last ? encodeHistoryCursor(last) : null };
}

/** Athletes (id, name) for filter dropdowns, optionally scoped to an event. */
export async function listAthleteOptions(eventId?: string | null): Promise<Array<Pick<AthleteRow, "id" | "name" | "event_id">>> {
  const supabase = await createClient();
  let query = supabase.from("photo_athletes").select("id,name,event_id").order("name", { ascending: true });
  if (eventId) query = query.eq("event_id", eventId);
  const { data } = await query;
  return data ?? [];
}

export async function countEverything(): Promise<{ events: number; athletes: number; matches: number; history: number }> {
  const supabase = await createClient();
  const [e, a, m, h] = await Promise.all([
    supabase.from("photo_events").select("id", { count: "exact", head: true }),
    supabase.from("photo_athletes").select("id", { count: "exact", head: true }),
    supabase.from("photo_matches").select("id", { count: "exact", head: true }),
    supabase.from("photo_match_history").select("id", { count: "exact", head: true }),
  ]);
  return { events: e.count ?? 0, athletes: a.count ?? 0, matches: m.count ?? 0, history: h.count ?? 0 };
}
