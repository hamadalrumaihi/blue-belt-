import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createLogger, type Logger } from "./log";
import type { Database } from "./supabase/database.types";
import type { AthleteRow, EventRow } from "./types";
import { refreshAthletes, type RefreshResult } from "./watch-service";
import { parseImportedHtml, validateSourceUrl } from "./watchers";
import { isBotChallenge } from "./watchers/extract";

type Client = SupabaseClient<Database>;

export type ImportFailureCode = "INVALID_URL" | "UNSUPPORTED_HOST" | "NO_ATHLETES" | "QUERY_FAILED" | "CHALLENGE_PAGE";

export type ImportOutcome =
  | { ok: true; url: string; matched: number; results: RefreshResult[]; checkedAt: string }
  | { ok: false; code: ImportFailureCode; message: string; url: string; candidates?: string[] };

/** One row of a non-persisting preview: what an import WOULD do to a client. */
export type ImportPreviewRow = {
  athleteId: string;
  name: string;
  eventName: string | null;
  status: string;
  code: string | null;
  matches: number;
  message?: string;
};

export type ImportPreview =
  | {
      ok: true;
      url: string;
      capturedAt: string;
      found: number;
      withMatches: number;
      notFound: number;
      rows: ImportPreviewRow[];
    }
  | { ok: false; code: ImportFailureCode; message: string; url: string; candidates?: string[] };

/** Bounded scan of the owner's tracked clients when matching a page to them. */
const MAX_ACTIVE_ATHLETES = 500;

/** Loads the active clients whose source URL is `url`, plus their events. */
async function clientsForPage(
  supabase: Client,
  url: string,
  log: Logger,
): Promise<{ ok: true; athletes: AthleteRow[]; events: Map<string, EventRow> } | { ok: false; code: ImportFailureCode; message: string; candidates?: string[] }> {
  const { data: rows, error } = await supabase.from("photo_athletes").select("*").eq("active", true).limit(MAX_ACTIVE_ATHLETES);
  if (error) {
    log.error("import.query_failed", { error: error.message });
    return { ok: false, code: "QUERY_FAILED", message: "Could not load clients." };
  }
  const athletes = (rows ?? []).filter((a) => samePage(a.source_url, url));
  if (!athletes.length) {
    const candidates = [...new Set((rows ?? []).map((a) => a.source_url).filter((u): u is string => Boolean(u)))].slice(0, 10);
    return { ok: false, code: "NO_ATHLETES", message: "No active client uses this page as its source URL.", candidates };
  }
  const eventIds = [...new Set(athletes.map((a) => a.event_id).filter((v): v is string => Boolean(v)))];
  const events = new Map<string, EventRow>();
  if (eventIds.length) {
    const { data: eventRows } = await supabase.from("photo_events").select("*").in("id", eventIds);
    for (const e of eventRows ?? []) events.set(e.id, e);
  }
  return { ok: true, athletes, events };
}

/**
 * Non-persisting preview of what importing `html` for `url` would do. Parses
 * the page for each matching client and reports athletes found, matches
 * identified and unmatched/ambiguous athletes, without writing anything. The
 * UI shows this before the photographer taps Apply.
 */
export async function previewImport(supabase: Client, input: { url: string; html: string; now?: Date; log?: Logger }): Promise<ImportPreview> {
  const log = input.log ?? createLogger({ route: "import" });
  const now = input.now ?? new Date();
  const policy = validateSourceUrl(input.url);
  if (!policy.ok) return { ok: false, code: policy.code, message: policy.message, url: input.url };
  const url = policy.url.toString();
  if (isBotChallenge(input.html)) {
    return { ok: false, code: "CHALLENGE_PAGE", message: "This is still the site's security-check page. Open the page, wait for the schedule to load, then import again.", url };
  }

  const loaded = await clientsForPage(supabase, url, log);
  if (!loaded.ok) return { ok: false, code: loaded.code, message: loaded.message, url, candidates: loaded.candidates };

  const rows: ImportPreviewRow[] = loaded.athletes.map((a) => {
    const event = a.event_id ? loaded.events.get(a.event_id) ?? null : null;
    const result = parseImportedHtml(url, input.html, { athleteName: a.name, timezone: event?.timezone ?? null, eventDate: event?.event_date ?? null, now });
    return {
      athleteId: a.id,
      name: a.name,
      eventName: event?.name ?? null,
      status: result.status,
      code: result.code ?? null,
      matches: result.matches.length,
      message: result.message,
    };
  });
  return {
    ok: true,
    url,
    capturedAt: now.toISOString(),
    found: rows.length,
    withMatches: rows.filter((r) => r.status === "OK").length,
    notFound: rows.filter((r) => r.status === "ATHLETE_NOT_FOUND").length,
    rows,
  };
}

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
  if (isBotChallenge(input.html)) {
    return { ok: false, code: "CHALLENGE_PAGE", message: "This is still the site's security-check page. Open the page, wait for the schedule to load, then import again.", url };
  }

  const loaded = await clientsForPage(supabase, url, log);
  if (!loaded.ok) return { ok: false, code: loaded.code, message: loaded.message, url, candidates: loaded.candidates };
  const { athletes, events } = loaded;

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
