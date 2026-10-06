import { describe, expect, it } from "vitest";
import { isEventDay } from "@/lib/cron";

/** Build the minimal event shape isEventDay reads. */
const ev = (event_date: string | null, timezone: string | null) => ({ event_date, timezone });

describe("isEventDay", () => {
  it("is false when the event has no date", () => {
    expect(isEventDay(ev(null, "Asia/Qatar"), new Date("2026-03-15T10:00:00Z"))).toBe(false);
  });

  it("is false for a malformed date string", () => {
    expect(isEventDay(ev("not-a-date", "Asia/Qatar"), new Date("2026-03-15T10:00:00Z"))).toBe(false);
    expect(isEventDay(ev("2026-00-10", "Asia/Qatar"), new Date("2026-03-15T10:00:00Z"))).toBe(false);
  });

  it("is true on the event day itself (in the event's zone)", () => {
    // 2026-03-15 12:00Z is the 15th in Asia/Qatar (UTC+3).
    expect(isEventDay(ev("2026-03-15", "Asia/Qatar"), new Date("2026-03-15T12:00:00Z"))).toBe(true);
  });

  it("is true the day before and the day after (±1 day window)", () => {
    expect(isEventDay(ev("2026-03-16", "Asia/Qatar"), new Date("2026-03-15T12:00:00Z"))).toBe(true);
    expect(isEventDay(ev("2026-03-14", "Asia/Qatar"), new Date("2026-03-15T12:00:00Z"))).toBe(true);
  });

  it("is false two or more days away", () => {
    expect(isEventDay(ev("2026-03-18", "Asia/Qatar"), new Date("2026-03-15T12:00:00Z"))).toBe(false);
    expect(isEventDay(ev("2026-03-12", "Asia/Qatar"), new Date("2026-03-15T12:00:00Z"))).toBe(false);
  });

  it("depends on the event's timezone, not UTC", () => {
    // 22:00Z on the 15th is already the 16th in Asia/Qatar (UTC+3) but still
    // the 15th in UTC. For an event on the 17th that flips the verdict:
    //   Qatar: today=16th, one day away  -> true
    //   UTC:   today=15th, two days away -> false
    const now = new Date("2026-03-15T22:00:00Z");
    expect(isEventDay(ev("2026-03-17", "Asia/Qatar"), now)).toBe(true);
    expect(isEventDay(ev("2026-03-17", "UTC"), now)).toBe(false);
  });

  it("handles a western zone across its own midnight", () => {
    // 2026-03-15 02:00Z is still 2026-03-14 (21:00/22:00) in New York.
    const now = new Date("2026-03-15T02:00:00Z");
    expect(isEventDay(ev("2026-03-14", "America/New_York"), now)).toBe(true);
    expect(isEventDay(ev("2026-03-15", "America/New_York"), now)).toBe(true); // +1 day window
    expect(isEventDay(ev("2026-03-16", "America/New_York"), now)).toBe(false);
  });

  it("falls back to the default zone (Asia/Qatar) when timezone is null", () => {
    const now = new Date("2026-03-15T22:00:00Z"); // 16th in Asia/Qatar
    expect(isEventDay(ev("2026-03-16", null), now)).toBe(true);
    expect(isEventDay(ev("2026-03-16", ""), now)).toBe(true);
  });
});
