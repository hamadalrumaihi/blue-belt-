import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildEnvelope, checkCaptureTiming, redactDiagnostics, type CaptureCompleteness, type CaptureEnvelope, type CaptureMeta, type CaptureTransport } from "./capture/envelope";
import { sameSource, sourceKey } from "./capture/source-identity";
import { latestAppliedCaptureAt, markCaptureApplied, markCaptureRejected, registerCapture } from "./capture/store";
import { createLogger, type Logger } from "./log";
import type { Database, Json } from "./supabase/database.types";
import type { AthleteRow, EventRow } from "./types";
import { refreshAthletes, type RefreshResult } from "./watch-service";
import { parseImportedHtml, validateSourceUrl } from "./watchers";
import { isBotChallenge } from "./watchers/extract";

type Client = SupabaseClient<Database>;

export type ImportFailureCode =
  | "INVALID_URL"
  | "UNSUPPORTED_HOST"
  | "NO_ATHLETES"
  | "QUERY_FAILED"
  | "CHALLENGE_PAGE"
  | "CAPTURE_TIMING"
  | "FINAL_URL_MISMATCH"
  | "STALE_CAPTURE"
  | "CAPTURE_IN_PROGRESS";

/** What the caller learns about the capture that was (or was not) applied. */
export type ImportCaptureSummary = {
  id: string;
  captureId: string;
  sourceKey: string;
  transport: CaptureTransport;
  capturedAt: string;
  completeness: CaptureCompleteness;
  /** True when this capture id had already been applied: nothing was re-applied. */
  replayed: boolean;
};

export type ImportOutcome =
  | { ok: true; url: string; matched: number; results: RefreshResult[]; checkedAt: string; capture: ImportCaptureSummary }
  | { ok: false; code: ImportFailureCode; message: string; url: string; candidates?: string[]; capture?: ImportCaptureSummary };

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

export type ImportInput = {
  url: string;
  html: string;
  /** Owner from the authenticated session / credential, never from the body. */
  ownerId: string;
  /** Optional client-supplied capture metadata (already validated). */
  capture?: CaptureMeta;
  /** Transport to record when the client did not say (route default). */
  transport?: CaptureTransport;
  /** Restrict to one event's clients (credential scope). */
  eventId?: string | null;
  now?: Date;
  log?: Logger;
};

/** Bounded scan of the owner's tracked clients when matching a page to them. */
const MAX_ACTIVE_ATHLETES = 500;

/**
 * Loads the active clients whose source URL is `url`, plus their events.
 * `scope.ownerId` is always applied explicitly (RLS also applies for session
 * clients; the service client used by machine intake has no RLS, so the
 * filter is what keeps one owner's capture away from another's clients).
 */
async function clientsForPage(
  supabase: Client,
  url: string,
  log: Logger,
  scope: { ownerId?: string; eventId?: string | null } = {},
): Promise<{ ok: true; athletes: AthleteRow[]; events: Map<string, EventRow> } | { ok: false; code: ImportFailureCode; message: string; candidates?: string[] }> {
  let query = supabase.from("photo_athletes").select("*").eq("active", true);
  if (scope.ownerId) query = query.eq("owner_id", scope.ownerId);
  if (scope.eventId) query = query.eq("event_id", scope.eventId);
  const { data: rows, error } = await query.limit(MAX_ACTIVE_ATHLETES);
  if (error) {
    log.error("import.query_failed", { error: error.message });
    return { ok: false, code: "QUERY_FAILED", message: "Could not load clients." };
  }
  const athletes = (rows ?? []).filter((a) => sameSource(a.source_url, url));
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
 * Applies a page the photographer (or their agent) captured to every active
 * client of this owner whose source identity is that page. The HTML goes
 * through the same adapters, plan, RPC, history and notification steps as a
 * live refresh; only the fetch is replaced.
 *
 * Capture safety, in order:
 *   1. URL policy and challenge-page rejection (nothing stored).
 *   2. Timing plausibility: a capture from the future or older than the
 *      freshness window is refused, so stale data never looks fresh.
 *   3. The final URL (after redirects) must be the same source as the
 *      requested one; a different bracket is never applied to these clients.
 *   4. Capture-id replay: the same id applied once is reported, not re-applied
 *      (no duplicate history when a phone retries a request).
 *   5. Out-of-order: a capture older than the newest already-applied capture
 *      of this owner's source is refused as STALE_CAPTURE.
 */
export async function importPage(supabase: Client, input: ImportInput): Promise<ImportOutcome> {
  const log = input.log ?? createLogger({ route: "import" });
  const now = input.now ?? new Date();
  const policy = validateSourceUrl(input.url);
  if (!policy.ok) return { ok: false, code: policy.code, message: policy.message, url: input.url };
  const url = policy.url.toString();
  if (isBotChallenge(input.html)) {
    return { ok: false, code: "CHALLENGE_PAGE", message: "This is still the site's security-check page. Open the page, wait for the schedule to load, then import again.", url };
  }

  const env = buildEnvelope({ sourceUrl: url, html: input.html, now, meta: input.capture ?? {}, defaultTransport: input.transport });
  const timing = checkCaptureTiming({ capturedAt: env.capturedAt, receivedAt: now });
  if (!timing.ok) {
    log.info("import.rejected", { code: timing.code, transport: env.transport });
    return { ok: false, code: "CAPTURE_TIMING", message: timing.message, url };
  }
  const key = sourceKey(url);
  if (!key) return { ok: false, code: "INVALID_URL", message: "Source URL is not a valid URL.", url };
  const finalKey = sourceKey(env.finalUrl);
  if (finalKey !== key) {
    log.info("import.rejected", { code: "FINAL_URL_MISMATCH", transport: env.transport });
    return { ok: false, code: "FINAL_URL_MISMATCH", message: "The page the browser ended on is not the requested bracket. Open the client's source URL directly and capture again.", url };
  }

  const loaded = await clientsForPage(supabase, url, log, { ownerId: input.ownerId, eventId: input.eventId ?? null });
  if (!loaded.ok) return { ok: false, code: loaded.code, message: loaded.message, url, candidates: loaded.candidates };
  const { athletes, events } = loaded;

  const registered = await registerCapture(supabase, input.ownerId, env, key, now);
  const summary = (replayed: boolean): ImportCaptureSummary => ({ id: registered.row.id, captureId: env.captureId, sourceKey: key, transport: env.transport, capturedAt: env.capturedAt, completeness: env.completeness, replayed });
  if (registered.kind === "in_flight") {
    return { ok: false, code: "CAPTURE_IN_PROGRESS", message: "This capture is already being applied.", url, capture: summary(false) };
  }
  if (registered.kind === "replay") {
    const row = registered.row;
    if (row.status === "rejected") {
      const code = (row.reject_code as ImportFailureCode | null) ?? "STALE_CAPTURE";
      log.info("import.replayed", { captureId: env.captureId, status: row.status, code });
      return { ok: false, code, message: "This capture was already refused.", url, capture: summary(true) };
    }
    const stored = (row.outcome && typeof row.outcome === "object" && !Array.isArray(row.outcome) ? row.outcome : {}) as { matched?: number; checkedAt?: string };
    log.info("import.replayed", { captureId: env.captureId, status: row.status });
    return { ok: true, url, matched: stored.matched ?? row.athlete_count ?? 0, results: [], checkedAt: stored.checkedAt ?? row.applied_at ?? now.toISOString(), capture: { ...summary(true), capturedAt: row.captured_at, completeness: row.completeness } };
  }

  const newest = await latestAppliedCaptureAt(supabase, input.ownerId, key);
  if (newest && new Date(newest).getTime() > new Date(env.capturedAt).getTime()) {
    await markCaptureRejected(supabase, input.ownerId, registered.row.id, "STALE_CAPTURE");
    log.info("import.rejected", { code: "STALE_CAPTURE", transport: env.transport });
    return { ok: false, code: "STALE_CAPTURE", message: "A newer capture of this page was already applied; this older one was not.", url, capture: summary(false) };
  }

  const results = await refreshAthletes(supabase, athletes, events, {
    log,
    now,
    staggerMs: 0,
    concurrency: 4,
    captureAt: env.capturedAt,
    watch: async (athlete: AthleteRow, event: EventRow | null) =>
      parseImportedHtml(url, input.html, { athleteName: athlete.name, timezone: event?.timezone ?? null, eventDate: event?.event_date ?? null, now, log: log.child({ athleteId: athlete.id }) }),
  });
  const statuses = results.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {});
  const checkedAt = now.toISOString();

  // How many athletes this capture actually persisted. A result is "applied"
  // unless it was skipped (superseded by a newer capture, or lost the version
  // race) or errored. Marking the capture applied only when something was
  // written keeps a wholly-conflicted/superseded import out of the replay lock,
  // so it stays retryable instead of being recorded as a silent success.
  const appliedCount = results.filter((r) => !r.skipped && r.code !== "REFRESH_ERROR").length;
  const supersededCount = results.filter((r) => r.skipped === "SUPERSEDED").length;

  if (appliedCount === 0) {
    const code: ImportFailureCode = supersededCount > 0 ? "STALE_CAPTURE" : "CAPTURE_IN_PROGRESS";
    const message =
      supersededCount > 0
        ? "A newer capture of this page was already applied; this older one was not."
        : "Another refresh is applying this page right now. Capture again in a moment.";
    await markCaptureRejected(supabase, input.ownerId, registered.row.id, code).catch((err: unknown) =>
      log.warn("import.capture_mark_failed", { error: err instanceof Error ? err.message : String(err) }),
    );
    log.info("import.not_applied", { url, code, superseded: supersededCount, athletes: athletes.length });
    return { ok: false, code, message, url, capture: summary(false) };
  }

  await markCaptureAppliedWithRetry(supabase, input.ownerId, registered.row.id, {
    appliedAt: checkedAt,
    athleteCount: appliedCount,
    outcome: { matched: appliedCount, checkedAt, statuses } as Json,
    diagnostics: redactDiagnostics({ ...(results[0]?.diagnostics ?? {}), transport: env.transport, completeness: env.completeness, bytes: env.bytes }) as Json,
  }, log);
  log.info("import.applied", { url, athletes: athletes.length, applied: appliedCount, superseded: supersededCount, htmlBytes: input.html.length, transport: env.transport, completeness: env.completeness, statuses });
  return { ok: true, url, matched: appliedCount, results, checkedAt, capture: summary(false) };
}

/** Marks a capture applied, retrying the ledger write once so a transient DB hiccup does not leave it stuck "received". */
async function markCaptureAppliedWithRetry(
  supabase: Client,
  ownerId: string,
  id: string,
  update: { appliedAt: string; athleteCount: number; outcome: Json; diagnostics: Json },
  log: Logger,
): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await markCaptureApplied(supabase, ownerId, id, update);
      return;
    } catch (err) {
      if (attempt === 1) log.warn("import.capture_mark_failed", { error: err instanceof Error ? err.message : String(err) });
    }
  }
}

/** Shape of a capture envelope exposed for tests / other transports. */
export type { CaptureEnvelope };

/** HTTP status for an import / capture failure code (shared by /api/import and /api/capture). */
export function failureStatus(code: string): number {
  switch (code) {
    case "QUERY_FAILED":
      return 500;
    case "NO_ATHLETES":
      return 404;
    case "CHALLENGE_PAGE":
    case "CAPTURE_TIMING":
    case "FINAL_URL_MISMATCH":
      return 422;
    case "STALE_CAPTURE":
    case "CAPTURE_IN_PROGRESS":
      return 409;
    default:
      return 400;
  }
}

/** Same source identity (host, path and bracket-selecting params; see capture/source-identity). */
export function samePage(a: string | null | undefined, b: string | null | undefined): boolean {
  return sameSource(a, b);
}

export function pageKey(raw: string | null | undefined): string | null {
  return sourceKey(raw);
}
