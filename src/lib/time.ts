/**
 * Timezone helpers built on Intl so no date library is required.
 * The app defaults to Asia/Qatar (UTC+3, no DST).
 */

export const DEFAULT_TIMEZONE = "Asia/Qatar";

const MINUTE = 60_000;

/** Offset (in minutes) of `timeZone` from UTC at the given instant. */
export function tzOffsetMinutes(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = Object.fromEntries(
    dtf.formatToParts(date).map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return Math.round((asUtc - date.getTime()) / MINUTE);
}

/**
 * Builds an absolute instant from wall-clock parts in `timeZone`.
 * Works for fixed and DST zones by iterating the offset once.
 */
export function zonedToUtc(
  parts: { year: number; month: number; day: number; hour: number; minute: number },
  timeZone: string,
): Date {
  const naive = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  let guess = new Date(naive);
  for (let i = 0; i < 2; i++) {
    const offset = tzOffsetMinutes(guess, timeZone);
    guess = new Date(naive - offset * MINUTE);
  }
  return guess;
}

/** Calendar date (YYYY-MM-DD) of `date` in `timeZone`. */
export function dateInZone(date: Date, timeZone: string): { year: number; month: number; day: number } {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const [year, month, day] = dtf.format(date).split("-").map(Number);
  return { year, month, day };
}

/**
 * Interprets a "HH:MM" string as a time on `baseDate` (a YYYY-MM-DD string,
 * or today in the zone when omitted) in `timeZone`. Returns ISO or null.
 */
export function wallClockToIso(
  hhmm: string,
  timeZone: string,
  baseDate?: string | null,
  now: Date = new Date(),
): string | null {
  const m = /^(\d{1,2}):(\d{2})(?:\s*(am|pm))?$/i.exec(hhmm.trim());
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = Number(m[2]);
  const ampm = m[3]?.toLowerCase();
  if (ampm === "pm" && hour < 12) hour += 12;
  if (ampm === "am" && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;

  let ymd: { year: number; month: number; day: number };
  if (baseDate && /^\d{4}-\d{2}-\d{2}$/.test(baseDate)) {
    const [year, month, day] = baseDate.split("-").map(Number);
    ymd = { year, month, day };
  } else {
    ymd = dateInZone(now, timeZone);
  }
  return zonedToUtc({ ...ymd, hour, minute }, timeZone).toISOString();
}

export function formatTime(iso: string | null | undefined, timeZone = DEFAULT_TIMEZONE): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(d);
}

export function formatDateTime(iso: string | null | undefined, timeZone = DEFAULT_TIMEZONE): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(d);
}

/** Formats a YYYY-MM-DD date string (no timezone shifting). */
export function formatEventDate(ymd: string | null | undefined, style: "long" | "short" = "long"): string {
  if (!ymd) return "Date TBC";
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  const date = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    day: "numeric",
    month: style === "long" ? "long" : "short",
    year: "numeric",
  }).format(date);
}

export function todayInZone(timeZone = DEFAULT_TIMEZONE): string {
  const { year, month, day } = dateInZone(new Date(), timeZone);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function secondsAgo(iso: string | null | undefined, now: Date = new Date()): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.round((now.getTime() - t) / 1000));
}

export function formatAgo(seconds: number | null): string {
  if (seconds === null) return "never";
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
