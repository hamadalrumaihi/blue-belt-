import type { MatchRow } from "./types";

/**
 * Owner-only manual corrections of a match's mat / time (pure helpers).
 *
 * The source's values stay in `mat` / `scheduled_at`; a correction lives in
 * `override_mat` / `override_scheduled_at` with who, when, why and until when.
 * Everything that shows or ranks a match uses the EFFECTIVE values
 * (`effectiveMatch`), labelled as manual. An automatic capture never
 * silently overwrites a correction: while the source still says what it said
 * when the owner corrected it, the correction stands; when the source itself
 * changes that field, the correction is superseded explicitly (dropped with a
 * history entry) because the source now carries newer information.
 */

export type Override = {
  mat: string | null;
  scheduledAt: string | null;
  by: string | null;
  at: string | null;
  reason: string | null;
  until: string | null;
};

export function overrideOf(m: Pick<MatchRow, "override_mat" | "override_scheduled_at" | "override_by" | "override_at" | "override_reason" | "override_until">): Override | null {
  if (!m.override_mat && !m.override_scheduled_at) return null;
  return { mat: m.override_mat, scheduledAt: m.override_scheduled_at, by: m.override_by, at: m.override_at, reason: m.override_reason, until: m.override_until };
}

/** True when the correction is still within its lifetime. */
export function overrideActive(m: Pick<MatchRow, "override_mat" | "override_scheduled_at" | "override_until">, now: Date): boolean {
  if (!m.override_mat && !m.override_scheduled_at) return false;
  if (!m.override_until) return true;
  return new Date(m.override_until).getTime() > now.getTime();
}

/** The match as the photographer should see it: corrections applied while active. */
export function effectiveMatch<T extends MatchRow>(m: T, now: Date = new Date()): T & { manual: { mat: boolean; time: boolean } } {
  if (!overrideActive(m, now)) return { ...m, manual: { mat: false, time: false } };
  return {
    ...m,
    mat: m.override_mat ?? m.mat,
    scheduled_at: m.override_scheduled_at ?? m.scheduled_at,
    // A manual time is a decision about when to be there; it wins over the source's estimate too.
    estimated_at: m.override_scheduled_at ? null : m.estimated_at,
    manual: { mat: Boolean(m.override_mat), time: Boolean(m.override_scheduled_at) },
  };
}

/** Patch that clears every override column. */
export const CLEAR_OVERRIDE = { override_mat: null, override_scheduled_at: null, override_by: null, override_at: null, override_reason: null, override_until: null } as const;

/**
 * Decides whether a fresh source read supersedes the stored correction: the
 * source changed the corrected field since the correction was made.
 */
export function overrideSuperseded(previous: Pick<MatchRow, "mat" | "scheduled_at" | "override_mat" | "override_scheduled_at">, next: { mat: string | null; scheduledAt: string | null }): { mat: boolean; time: boolean } {
  const matChanged = Boolean(previous.override_mat) && Boolean(next.mat) && norm(next.mat) !== norm(previous.mat);
  const timeChanged = Boolean(previous.override_scheduled_at) && Boolean(next.scheduledAt) && isoNorm(next.scheduledAt) !== isoNorm(previous.scheduled_at);
  return { mat: matChanged, time: timeChanged };
}

function norm(v: string | null | undefined): string | null {
  return v ? v.trim().toLowerCase() : null;
}

function isoNorm(v: string | null | undefined): string | null {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/** Default lifetime of a correction: the end of the event day (local) or 12 h, whichever is later. */
export function defaultOverrideUntil(now: Date, eventDate: string | null, timezone: string): string {
  const twelveHours = new Date(now.getTime() + 12 * 60 * 60 * 1000);
  if (!eventDate) return twelveHours.toISOString();
  try {
    // End of the event day in the event's timezone, computed via the offset at that date.
    const probe = new Date(`${eventDate}T23:59:59Z`);
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(probe);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    const asIfUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
    const offsetMs = asIfUtc - probe.getTime();
    const endLocal = new Date(Date.UTC(...(eventDate.split("-").map(Number) as [number, number, number]).map((v, i) => (i === 1 ? v - 1 : v)) as [number, number, number], 23, 59, 59) - offsetMs);
    return (endLocal.getTime() > twelveHours.getTime() ? endLocal : twelveHours).toISOString();
  } catch {
    return twelveHours.toISOString();
  }
}
