import { dateInZone } from "./time";
import type { EventRow } from "./types";

/** True when `now` falls on the event date ±1 day in the event's timezone. */
export function isEventDay(event: Pick<EventRow, "event_date" | "timezone">, now: Date): boolean {
  if (!event.event_date) return false;
  const [y, m, d] = event.event_date.split("-").map(Number);
  if (!y || !m || !d) return false;
  const eventUtc = Date.UTC(y, m - 1, d);
  const { year, month, day } = dateInZone(now, event.timezone || "Asia/Qatar");
  const todayUtc = Date.UTC(year, month - 1, day);
  return Math.abs(todayUtc - eventUtc) <= 24 * 60 * 60 * 1000;
}
