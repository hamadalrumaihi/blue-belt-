import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createLogger, type Logger } from "./log";
import { notifyAfterRefresh } from "./notifications/server";
import { buildRefreshPlan, planToRpcArgs, type PlannedChange } from "./refresh-plan";
import type { ApplyRefreshResult, Database, Json } from "./supabase/database.types";
import { DEFAULT_TIMEZONE } from "./time";
import type { AthleteRow, EventRow, MatchRow } from "./types";
import { watchUrl } from "./watchers";
import type { WatchCode, WatchDiagnostics, WatchResult, WatchStatus } from "./watchers/types";

type Client = SupabaseClient<Database>;

export type SourceHealth = {
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  consecutiveFailures: number;
};

export type RefreshResult = {
  athleteId: string;
  athleteName: string;
  status: WatchStatus | "ERROR";
  code: WatchCode | "REFRESH_ERROR" | "SKIPPED" | null;
  message?: string;
  matches: MatchRow[];
  changes: Array<PlannedChange & { match_id: string }>;
  checkedAt: string;
  sourceUrl: string | null;
  health: SourceHealth;
  diagnostics?: WatchDiagnostics;
  /** Parsed matches kept apart because they could belong to several stored rows. */
  ambiguous: number;
  /** Set when nothing was fetched: another refresh won the race, or a cooldown applied. */
  skipped?: "CONCURRENT" | "COOLDOWN";
};

export type RefreshOptions = {
  /** Athletes attempted within this window are skipped (0 disables). */
  cooldownSeconds?: number;
  log?: Logger;
  now?: Date;
  concurrency?: number;
  staggerMs?: number;
};

const STAGGER_MS = 350;
const CONCURRENCY = 2;

/**
 * Refreshes many athletes with bounded concurrency and a small stagger so a
 * long client list never hammers the source site. Each athlete is isolated:
 * a failure produces an ERROR result instead of rejecting the batch.
 */
export async function refreshAthletes(supabase: Client, athletes: AthleteRow[], events: Map<string, EventRow>, options: RefreshOptions = {}): Promise<RefreshResult[]> {
  const log = options.log ?? createLogger({ route: "refresh" });
  const results: RefreshResult[] = new Array(athletes.length);
  const stagger = options.staggerMs ?? STAGGER_MS;
  let cursor = 0;

  async function worker() {
    while (cursor < athletes.length) {
      const index = cursor++;
      const athlete = athletes[index];
      if (index > 0 && stagger > 0) await sleep(stagger);
      results[index] = await refreshAthlete(supabase, athlete, athlete.event_id ? events.get(athlete.event_id) ?? null : null, { ...options, log });
    }
  }

  await Promise.all(Array.from({ length: Math.min(options.concurrency ?? CONCURRENCY, athletes.length) }, worker));

  await notifyAfterRefresh({ supabase, athletes, events, results, now: options.now ?? new Date(), log });
  return results;
}

/** Fetches, parses, diffs and persists one athlete atomically. Never throws. */
export async function refreshAthlete(supabase: Client, athlete: AthleteRow, event: EventRow | null, options: RefreshOptions = {}): Promise<RefreshResult> {
  const now = options.now ?? new Date();
  const checkedAt = now.toISOString();
  const log = (options.log ?? createLogger()).child({ athleteId: athlete.id });
  const base = {
    athleteId: athlete.id,
    athleteName: athlete.name,
    checkedAt,
    sourceUrl: athlete.source_url,
    health: healthOf(athlete),
    ambiguous: 0,
  };

  const cooldownMs = (options.cooldownSeconds ?? 0) * 1000;
  if (cooldownMs > 0 && athlete.last_attempt_at && now.getTime() - new Date(athlete.last_attempt_at).getTime() < cooldownMs) {
    const matches = await loadMatches(supabase, athlete.id);
    return { ...base, status: statusOf(athlete), code: "SKIPPED", message: athlete.last_watch_message ?? undefined, matches, changes: [], skipped: "COOLDOWN", checkedAt: athlete.last_checked_at ?? checkedAt };
  }

  try {
    const existing = await loadMatches(supabase, athlete.id);
    const timezone = event?.timezone ?? DEFAULT_TIMEZONE;
    const result = await watchUrl(athlete.source_url, { athleteName: athlete.name, timezone, eventDate: event?.event_date ?? null, now, log });
    const plan = buildRefreshPlan(existing, result, checkedAt, timezone);

    const applied = await applyRefresh(supabase, {
      p_athlete_id: athlete.id,
      p_expected_version: athlete.refresh_version ?? 0,
      p_checked_at: checkedAt,
      p_ok: plan.ok,
      p_status: result.status,
      p_code: result.code ?? null,
      p_message: result.message ?? null,
      p_diag: diagJson(result.diagnostics),
      ...planToRpcArgs(plan),
    });

    if (!applied.ok && applied.code === "CONFLICT") {
      // Another refresh persisted first; its rows are the truth now.
      log.info("refresh.conflict", { version: applied.version });
      const fresh = await loadAthlete(supabase, athlete.id);
      return {
        ...base,
        status: fresh ? statusOf(fresh) : result.status,
        code: "SKIPPED",
        message: fresh?.last_watch_message ?? result.message,
        matches: applied.matches,
        changes: [],
        skipped: "CONCURRENT",
        health: fresh ? healthOf(fresh) : base.health,
        checkedAt: fresh?.last_checked_at ?? checkedAt,
      };
    }
    if (!applied.ok) {
      return { ...base, status: "ERROR", code: "REFRESH_ERROR", message: "Client no longer exists.", matches: existing, changes: [] };
    }

    const changes = plan.history.map((h) => ({ ...h, match_id: h.match_id ?? applied.inserted_ids[h.match_ref ?? -1] })).filter((h) => Boolean(h.match_id));
    const health: SourceHealth = plan.ok
      ? { lastAttemptAt: checkedAt, lastSuccessAt: checkedAt, consecutiveFailures: 0 }
      : { lastAttemptAt: checkedAt, lastSuccessAt: athlete.last_success_at ?? null, consecutiveFailures: (athlete.consecutive_failures ?? 0) + 1 };

    return { ...base, status: result.status, code: result.code ?? null, message: result.message, matches: applied.matches, changes, health, diagnostics: result.diagnostics, ambiguous: plan.ambiguous };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unable to refresh";
    log.error("refresh.failed", { error: message });
    await applyRefresh(supabase, {
      p_athlete_id: athlete.id,
      p_expected_version: athlete.refresh_version ?? 0,
      p_checked_at: checkedAt,
      p_ok: false,
      p_status: "ERROR",
      p_code: "REFRESH_ERROR",
      p_message: message.slice(0, 300),
    }).catch(() => undefined);
    const matches = await loadMatches(supabase, athlete.id).catch(() => [] as MatchRow[]);
    return {
      ...base,
      status: "ERROR",
      code: "REFRESH_ERROR",
      message,
      matches,
      changes: [],
      health: { lastAttemptAt: checkedAt, lastSuccessAt: athlete.last_success_at ?? null, consecutiveFailures: (athlete.consecutive_failures ?? 0) + 1 },
    };
  }
}

async function applyRefresh(supabase: Client, args: Database["public"]["Functions"]["photo_apply_refresh"]["Args"]): Promise<ApplyRefreshResult> {
  const { data, error } = await supabase.rpc("photo_apply_refresh", args);
  if (error) throw new Error(`photo_apply_refresh: ${error.message}`);
  return parseApplyResult(data);
}

export function parseApplyResult(data: Json): ApplyRefreshResult {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("photo_apply_refresh returned an unexpected payload.");
  const o = data as Record<string, Json | undefined>;
  const matches = Array.isArray(o.matches) ? (o.matches as unknown as MatchRow[]) : [];
  if (o.ok === true) {
    return { ok: true, version: Number(o.version ?? 0), matches, inserted_ids: Array.isArray(o.inserted_ids) ? (o.inserted_ids as string[]) : [] };
  }
  if (o.code === "CONFLICT") return { ok: false, code: "CONFLICT", version: Number(o.version ?? 0), matches };
  return { ok: false, code: "NOT_FOUND" };
}

async function loadMatches(supabase: Client, athleteId: string): Promise<MatchRow[]> {
  const { data, error } = await supabase
    .from("photo_matches")
    .select("*")
    .eq("athlete_id", athleteId)
    .order("match_order", { ascending: true, nullsFirst: false })
    .order("scheduled_at", { ascending: true, nullsFirst: false });
  if (error) throw error;
  return data ?? [];
}

async function loadAthlete(supabase: Client, athleteId: string): Promise<AthleteRow | null> {
  const { data } = await supabase.from("photo_athletes").select("*").eq("id", athleteId).maybeSingle();
  return data ?? null;
}

export function healthOf(a: Pick<AthleteRow, "last_attempt_at" | "last_success_at" | "consecutive_failures">): SourceHealth {
  return { lastAttemptAt: a.last_attempt_at ?? null, lastSuccessAt: a.last_success_at ?? null, consecutiveFailures: a.consecutive_failures ?? 0 };
}

function statusOf(a: Pick<AthleteRow, "last_watch_status">): RefreshResult["status"] {
  return (a.last_watch_status as RefreshResult["status"]) ?? "ERROR";
}

function diagJson(d: WatchDiagnostics | undefined): Json {
  if (!d) return {};
  return { strategy: d.strategy, sourceStatus: d.sourceStatus, finalUrl: d.finalUrl, elapsedMs: Math.round(d.elapsedMs), workerCode: d.workerCode ?? null, attempts: d.attempts ?? null };
}

/** Exposed for tests of the persistence plan without a database. */
export { buildRefreshPlan } from "./refresh-plan";
export type { WatchResult };

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
