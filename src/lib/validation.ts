/**
 * Pure request / input validation helpers shared by Route Handlers, Server
 * Actions and tests. Nothing here touches the network or the database.
 */

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/**
 * Strict calendar-date check for YYYY-MM-DD strings: the month must exist and
 * the day must exist in that month (leap years included). "2026-99-99",
 * "2026-02-30" and "2026-4-1" are all rejected.
 */
export function isValidCalendarDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (year < 1900 || year > 2200) return false;
  if (month < 1 || month > 12) return false;
  return day >= 1 && day <= daysInMonth(year, month);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type ValidationFailure = { ok: false; status: 400; error: string; code: string };

export type WatchRequest =
  | { ok: true; mode: "preview"; url: string; athleteName: string | null; timezone: string | null; eventDate: string | null }
  | { ok: true; mode: "athletes"; athleteIds: string[] }
  | { ok: true; mode: "event"; eventId: string }
  | ValidationFailure;

export const MAX_WATCH_BATCH = 60;
const MAX_URL_LENGTH = 2048;
const MAX_NAME_LENGTH = 120;

function fail(code: string, error: string): ValidationFailure {
  return { ok: false, status: 400, error, code };
}

/**
 * Validates the body of POST /api/watch. Accepts exactly one of three shapes
 * and rejects everything else with a precise 400 message. `body` is the
 * already-parsed JSON value (or undefined when parsing failed).
 */
export function parseWatchRequest(body: unknown): WatchRequest {
  if (body === undefined) return fail("INVALID_JSON", "Request body must be valid JSON.");
  if (!isPlainObject(body)) return fail("INVALID_BODY", "Request body must be a JSON object.");

  const keys = Object.keys(body);
  const modes = ["url", "athleteIds", "eventId"].filter((k) => k in body);
  if (modes.length === 0) return fail("MISSING_MODE", "Provide exactly one of url, athleteIds or eventId.");
  if (modes.length > 1) return fail("AMBIGUOUS_MODE", "Provide only one of url, athleteIds or eventId.");

  if ("url" in body) {
    const allowed = new Set(["url", "athleteName", "timezone", "eventDate"]);
    const unknown = keys.filter((k) => !allowed.has(k));
    if (unknown.length) return fail("UNKNOWN_FIELD", `Unsupported field: ${unknown[0]}.`);
    const url = body.url;
    if (typeof url !== "string" || !url.trim()) return fail("INVALID_URL", "url must be a non-empty string.");
    if (url.length > MAX_URL_LENGTH) return fail("INVALID_URL", "url is too long.");
    const athleteName = optionalString(body.athleteName, MAX_NAME_LENGTH);
    if (athleteName === undefined) return fail("INVALID_FIELD", "athleteName must be a short string.");
    const timezone = optionalString(body.timezone, 64);
    if (timezone === undefined) return fail("INVALID_FIELD", "timezone must be a string.");
    const eventDate = optionalString(body.eventDate, 10);
    if (eventDate === undefined) return fail("INVALID_FIELD", "eventDate must be a string.");
    if (eventDate && !isValidCalendarDate(eventDate)) return fail("INVALID_DATE", "eventDate must be a real calendar date (YYYY-MM-DD).");
    return { ok: true, mode: "preview", url: url.trim(), athleteName, timezone, eventDate };
  }

  if ("athleteIds" in body) {
    if (keys.length !== 1) return fail("UNKNOWN_FIELD", "athleteIds cannot be combined with other fields.");
    const ids = body.athleteIds;
    if (!Array.isArray(ids)) return fail("INVALID_FIELD", "athleteIds must be an array of ids.");
    if (!ids.length) return fail("INVALID_FIELD", "athleteIds must not be empty.");
    if (ids.length > MAX_WATCH_BATCH) return fail("TOO_MANY", `athleteIds is limited to ${MAX_WATCH_BATCH} ids per request.`);
    const unique = [...new Set(ids)];
    if (!unique.every(isUuid)) return fail("INVALID_FIELD", "athleteIds must contain valid ids.");
    return { ok: true, mode: "athletes", athleteIds: unique as string[] };
  }

  if (keys.length !== 1) return fail("UNKNOWN_FIELD", "eventId cannot be combined with other fields.");
  if (!isUuid(body.eventId)) return fail("INVALID_FIELD", "eventId must be a valid id.");
  return { ok: true, mode: "event", eventId: body.eventId };
}

/** Returns null for absent values, undefined when the value is the wrong type. */
function optionalString(value: unknown, max: number): string | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return undefined;
  const t = value.trim();
  if (t.length > max) return undefined;
  return t || null;
}

export type CronRequest =
  | { ok: true; all: boolean; limit: number; cursor: string | null; cooldownSeconds: number }
  | ValidationFailure;

export const CRON_DEFAULT_LIMIT = 40;
export const CRON_MAX_LIMIT = 200;

/** Validates the optional body of POST /api/cron/refresh. */
export function parseCronRequest(body: unknown): CronRequest {
  if (body === undefined || body === null) return { ok: true, all: false, limit: CRON_DEFAULT_LIMIT, cursor: null, cooldownSeconds: 45 };
  if (!isPlainObject(body)) return fail("INVALID_BODY", "Request body must be a JSON object.");
  const all = body.all === undefined ? false : body.all;
  if (typeof all !== "boolean") return fail("INVALID_FIELD", "all must be a boolean.");
  const limitRaw = body.limit === undefined ? CRON_DEFAULT_LIMIT : body.limit;
  if (typeof limitRaw !== "number" || !Number.isInteger(limitRaw) || limitRaw < 1) return fail("INVALID_FIELD", "limit must be a positive integer.");
  const limit = Math.min(limitRaw, CRON_MAX_LIMIT);
  const cursor = body.cursor === undefined || body.cursor === null ? null : body.cursor;
  if (cursor !== null && !isUuid(cursor)) return fail("INVALID_FIELD", "cursor must be an athlete id.");
  const cooldownRaw = body.cooldownSeconds === undefined ? 45 : body.cooldownSeconds;
  if (typeof cooldownRaw !== "number" || !Number.isFinite(cooldownRaw) || cooldownRaw < 0) return fail("INVALID_FIELD", "cooldownSeconds must be a non-negative number.");
  return { ok: true, all, limit, cursor, cooldownSeconds: Math.min(cooldownRaw, 3600) };
}

export type ImportRequest = { ok: true; url: string; html: string } | ValidationFailure;

/** Upper bound for a pasted / handed-over page (Vercel's request limit is 4.5 MB). */
export const MAX_IMPORT_HTML_BYTES = 3 * 1024 * 1024;

/**
 * Validates the body of POST /api/import: a source URL plus the HTML of that
 * page as the photographer's own browser rendered it. The URL policy
 * (https, allow-listed host) is enforced again by the import service.
 */
export function parseImportRequest(body: unknown): ImportRequest {
  if (body === undefined) return fail("INVALID_JSON", "Request body must be valid JSON.");
  if (!isPlainObject(body)) return fail("INVALID_BODY", "Request body must be a JSON object.");
  const unknown = Object.keys(body).filter((k) => k !== "url" && k !== "html");
  if (unknown.length) return fail("UNKNOWN_FIELD", `Unsupported field: ${unknown[0]}.`);
  const url = body.url;
  if (typeof url !== "string" || !url.trim()) return fail("INVALID_URL", "url must be a non-empty string.");
  if (url.length > MAX_URL_LENGTH) return fail("INVALID_URL", "url is too long.");
  const html = body.html;
  if (typeof html !== "string" || !html.trim()) return fail("INVALID_HTML", "html must be the page's HTML.");
  if (html.length > MAX_IMPORT_HTML_BYTES) return fail("TOO_LARGE", "The page is too large to import (3 MB limit).");
  if (!html.includes("<")) return fail("INVALID_HTML", "html does not look like a web page.");
  return { ok: true, url: url.trim(), html };
}
