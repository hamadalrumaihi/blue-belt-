import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createLogger, type Logger } from "./log";
import type { Database } from "./supabase/database.types";
import type { AthleteRow, EventRow } from "./types";
import { refreshAthletes, type RefreshResult } from "./watch-service";
import { parseImportedHtml, validateSourceUrl } from "./watchers";

type Client = SupabaseClient<Database>;

export type ImportOutcome =
  | { ok: true; url: string; matched: number; results: RefreshResult[]; checkedAt: string }
  | { ok: false; code: "INVALID_URL" | "UNSUPPORTED_HOST" | "NO_ATHLETES" | "QUERY_FAILED"; message: string; url: string; candidates?: string[] };

/** Bounded scan of the owner's tracked clients when matching a page to them. */
const MAX_ACTIVE_ATHLETES = 500;

/**
 * Applies a page the photographer fetched in their own browser to every
 * active client whose source URL is that page. The HTML goes through the same
 * adapters, plan, RPC, history and notification steps as a live refresh; only
 * the fetch is replaced. Nothing is stored for clients on other pages.
 */
export async function importPage(supabase: Client, input: { url: string; html: string; now?: Date; log?: Logger }): Promise<ImportOutcome> {
  const log = input.log ?? createLogger({ route: "import" });
  const now = input.now ?? new Date();
  const policy = validateSourceUrl(input.url);
  if (!policy.ok) return { ok: false, code: policy.code, message: policy.message, url: input.url };
  const url = policy.url.toString();

  const { data: rows, error } = await supabase.from("photo_athletes").select("*").eq("active", true).limit(MAX_ACTIVE_ATHLETES);
  if (error) {
    log.error("import.query_failed", { error: error.message });
    return { ok: false, code: "QUERY_FAILED", message: "Could not load clients.", url };
  }
  const athletes = (rows ?? []).filter((a) => samePage(a.source_url, url));
  if (!athletes.length) {
    const candidates = [...new Set((rows ?? []).map((a) => a.source_url).filter((u): u is string => Boolean(u)))].slice(0, 10);
    return { ok: false, code: "NO_ATHLETES", message: "No active client uses this page as its source URL.", url, candidates };
  }

  const eventIds = [...new Set(athletes.map((a) => a.event_id).filter((v): v is string => Boolean(v)))];
  const events = new Map<string, EventRow>();
  if (eventIds.length) {
    const { data: eventRows } = await supabase.from("photo_events").select("*").in("id", eventIds);
    for (const e of eventRows ?? []) events.set(e.id, e);
  }

  const results = await refreshAthletes(supabase, athletes, events, {
    log,
    now,
    staggerMs: 0,
    concurrency: 4,
    watch: async (athlete: AthleteRow, event: EventRow | null) =>
      parseImportedHtml(url, input.html, { athleteName: athlete.name, timezone: event?.timezone ?? null, eventDate: event?.event_date ?? null, now, log: log.child({ athleteId: athlete.id }) }),
  });
  log.info("import.applied", { url, athletes: athletes.length, htmlBytes: input.html.length, statuses: results.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {}) });
  return { ok: true, url, matched: athletes.length, results, checkedAt: now.toISOString() };
}

/** Same host and path (case-insensitive host, trailing slash and hash ignored; query ignored). */
export function samePage(a: string | null | undefined, b: string | null | undefined): boolean {
  const ka = pageKey(a);
  const kb = pageKey(b);
  return ka !== null && ka === kb;
}

export function pageKey(raw: string | null | undefined): string | null {
  const policy = validateSourceUrl(raw);
  if (!policy.ok) return null;
  const path = policy.url.pathname.replace(/\/+$/, "") || "/";
  return `${policy.url.hostname.toLowerCase()}${path}`;
}
