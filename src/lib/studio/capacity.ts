import type { BookingStatus, PhotoBookingRow, PhotoEventRow } from "@/lib/supabase/database.types";
import { dateInZone, DEFAULT_TIMEZONE } from "@/lib/time";

/**
 * Capacity warnings. A request NEVER reserves a slot: only a confirmed (or
 * in-progress) booking occupies a day. This flags same-day collisions so the
 * owner sees them before quoting or confirming. Pure; no I/O.
 */

export const CAPACITY_NOTE = "A request never reserves a slot. Only a confirmed booking (agreement signed, deposit paid) holds the date.";

/** Bookings that actually occupy a day. */
export const OCCUPYING_STATUSES: readonly BookingStatus[] = ["confirmed", "in_progress"];

export type CapacityBooking = Pick<PhotoBookingRow, "id" | "booking_status" | "session_at" | "customer_name" | "public_ref" | "event_id" | "location">;
export type CapacityEvent = Pick<PhotoEventRow, "id" | "name" | "event_date" | "venue">;

export type CapacityCandidate = {
  /** The booking being looked at (excluded from its own conflicts). */
  id?: string | null;
  /** Session timestamp (ISO) or a plain YYYY-MM-DD date. */
  sessionAt?: string | null;
  date?: string | null;
  /** The event the candidate is for: that event is not a conflict with itself. */
  eventId?: string | null;
};

export type CapacityConflict =
  | { kind: "booking"; id: string; href: string; title: string; status: BookingStatus; at: string | null; where: string | null }
  | { kind: "event"; id: string; href: string; title: string; date: string; where: string | null };

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/** YYYY-MM-DD in the studio's zone for an ISO timestamp or a plain date; null when unusable. */
export function dayOf(value: string | null | undefined, timeZone: string = DEFAULT_TIMEZONE): string | null {
  if (!value) return null;
  if (YMD_RE.test(value)) return value;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const { year, month, day } = dateInZone(d, timeZone);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** The day a candidate asks for (explicit date first, then the session timestamp). */
export function candidateDay(c: CapacityCandidate, timeZone: string = DEFAULT_TIMEZONE): string | null {
  return dayOf(c.date, timeZone) ?? dayOf(c.sessionAt, timeZone);
}

/**
 * Same-day conflicts for a candidate: confirmed / in-progress bookings on the
 * same calendar day (studio zone) and events held that day. Empty when the
 * candidate has no date yet.
 */
export function overlaps(bookings: readonly CapacityBooking[], candidate: CapacityCandidate, events: readonly CapacityEvent[] = [], timeZone: string = DEFAULT_TIMEZONE): CapacityConflict[] {
  const day = candidateDay(candidate, timeZone);
  if (!day) return [];
  const out: CapacityConflict[] = [];
  for (const b of bookings) {
    if (candidate.id && b.id === candidate.id) continue;
    if (!OCCUPYING_STATUSES.includes(b.booking_status)) continue;
    if (dayOf(b.session_at, timeZone) !== day) continue;
    out.push({ kind: "booking", id: b.id, href: `/bookings/${b.id}`, title: `${b.customer_name}${b.public_ref ? ` · ${b.public_ref}` : ""}`, status: b.booking_status, at: b.session_at, where: b.location ?? null });
  }
  for (const e of events) {
    if (candidate.eventId && e.id === candidate.eventId) continue;
    if (!e.event_date || e.event_date !== day) continue;
    out.push({ kind: "event", id: e.id, href: `/events/${e.id}`, title: e.name, date: e.event_date, where: e.venue ?? null });
  }
  return out;
}

/** One line for the warning banner. */
export function describeConflicts(conflicts: readonly CapacityConflict[]): string | null {
  if (!conflicts.length) return null;
  const bookings = conflicts.filter((c) => c.kind === "booking").length;
  const events = conflicts.length - bookings;
  const parts: string[] = [];
  if (bookings) parts.push(`${bookings} confirmed booking${bookings === 1 ? "" : "s"}`);
  if (events) parts.push(`${events} event${events === 1 ? "" : "s"}`);
  return `Same day as ${parts.join(" and ")}.`;
}
