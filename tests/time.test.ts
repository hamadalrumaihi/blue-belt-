import { describe, expect, it } from "vitest";
import { DEFAULT_TIMEZONE, dateInZone, formatAgo, formatDateTime, formatEventDate, formatTime, formatIn, formatStamp, isValidTimeZone, secondsAgo, tzOffsetMinutes, wallClockToIso, zonedToUtc, zoneLabel } from "@/lib/time";

describe("wallClockToIso", () => {
  it("handles Europe/London across DST (BST in July, GMT in January)", () => {
    expect(wallClockToIso("10:40", "Europe/London", "2026-07-15")).toBe("2026-07-15T09:40:00.000Z");
    expect(wallClockToIso("10:40", "Europe/London", "2026-01-15")).toBe("2026-01-15T10:40:00.000Z");
  });

  it("handles America/New_York across DST (EDT / EST)", () => {
    expect(wallClockToIso("10:40", "America/New_York", "2026-07-15")).toBe("2026-07-15T14:40:00.000Z");
    expect(wallClockToIso("10:40", "America/New_York", "2026-01-15")).toBe("2026-01-15T15:40:00.000Z");
  });

  it("uses the fixed +03:00 offset for Asia/Qatar in any month", () => {
    expect(wallClockToIso("10:40", "Asia/Qatar", "2026-03-14")).toBe("2026-03-14T07:40:00.000Z");
    expect(wallClockToIso("10:40", "Asia/Qatar", "2026-08-14")).toBe("2026-08-14T07:40:00.000Z");
    expect(wallClockToIso("00:05", "Asia/Qatar", "2026-03-14")).toBe("2026-03-13T21:05:00.000Z");
  });

  it("rejects invalid input", () => {
    expect(wallClockToIso("25:61", "Asia/Qatar", "2026-03-14")).toBeNull();
    expect(wallClockToIso("24:00", "Asia/Qatar", "2026-03-14")).toBeNull();
    expect(wallClockToIso("10:60", "Asia/Qatar", "2026-03-14")).toBeNull();
    expect(wallClockToIso("abc", "Asia/Qatar", "2026-03-14")).toBeNull();
    expect(wallClockToIso("", "Asia/Qatar", "2026-03-14")).toBeNull();
    expect(wallClockToIso("10:40:00", "Asia/Qatar", "2026-03-14")).toBeNull();
  });

  it("understands 12-hour am/pm times", () => {
    expect(wallClockToIso("12:00 am", "UTC", "2026-03-14")).toBe("2026-03-14T00:00:00.000Z");
    expect(wallClockToIso("12:30 PM", "UTC", "2026-03-14")).toBe("2026-03-14T12:30:00.000Z");
    expect(wallClockToIso("1:05pm", "UTC", "2026-03-14")).toBe("2026-03-14T13:05:00.000Z");
    expect(wallClockToIso("9:05 am", "UTC", "2026-03-14")).toBe("2026-03-14T09:05:00.000Z");
    expect(wallClockToIso("13:05 pm", "UTC", "2026-03-14")).toBe("2026-03-14T13:05:00.000Z"); // pm on a 24h value is a no-op
  });

  it("falls back to today in the zone when no base date is given (or it is malformed)", () => {
    const now = new Date("2026-03-14T22:30:00.000Z"); // 15 March 01:30 in Doha, still 14 March in New York
    expect(wallClockToIso("09:00", "Asia/Qatar", null, now)).toBe("2026-03-15T06:00:00.000Z");
    expect(wallClockToIso("09:00", "America/New_York", undefined, now)).toBe("2026-03-14T13:00:00.000Z");
    expect(wallClockToIso("09:00", "Asia/Qatar", "2026-4-1", now)).toBe("2026-03-15T06:00:00.000Z");
  });

  it("trims surrounding whitespace", () => {
    expect(wallClockToIso("  10:40 ", "UTC", "2026-03-14")).toBe("2026-03-14T10:40:00.000Z");
  });
});

describe("dateInZone / tzOffsetMinutes / zonedToUtc", () => {
  const instant = new Date("2026-03-14T22:30:00.000Z");

  it("returns the calendar date in the zone", () => {
    expect(dateInZone(instant, "Asia/Qatar")).toEqual({ year: 2026, month: 3, day: 15 });
    expect(dateInZone(instant, "America/New_York")).toEqual({ year: 2026, month: 3, day: 14 });
    expect(dateInZone(instant, "UTC")).toEqual({ year: 2026, month: 3, day: 14 });
  });

  it("computes offsets including DST", () => {
    expect(tzOffsetMinutes(instant, "Asia/Qatar")).toBe(180);
    expect(tzOffsetMinutes(new Date("2026-07-15T12:00:00.000Z"), "Europe/London")).toBe(60);
    expect(tzOffsetMinutes(new Date("2026-01-15T12:00:00.000Z"), "Europe/London")).toBe(0);
    expect(tzOffsetMinutes(new Date("2026-01-15T12:00:00.000Z"), "America/New_York")).toBe(-300);
  });

  it("builds an instant from zoned wall-clock parts", () => {
    expect(zonedToUtc({ year: 2026, month: 3, day: 14, hour: 10, minute: 40 }, "Asia/Qatar").toISOString()).toBe("2026-03-14T07:40:00.000Z");
    expect(zonedToUtc({ year: 2026, month: 7, day: 15, hour: 10, minute: 40 }, "Europe/London").toISOString()).toBe("2026-07-15T09:40:00.000Z");
  });
});

describe("formatting", () => {
  it("formatTime renders HH:MM in the zone (default Asia/Qatar) and dashes for bad input", () => {
    expect(DEFAULT_TIMEZONE).toBe("Asia/Qatar");
    expect(formatTime("2026-03-14T07:40:00.000Z")).toBe("10:40");
    expect(formatTime("2026-03-14T07:40:00.000Z", "Europe/London")).toBe("07:40");
    expect(formatTime("2026-07-15T07:40:00.000Z", "Europe/London")).toBe("08:40");
    expect(formatTime("2026-03-14T21:05:00.000Z")).toBe("00:05");
    expect(formatTime(null)).toBe("—");
    expect(formatTime(undefined)).toBe("—");
    expect(formatTime("not a date")).toBe("—");
  });

  it("formatDateTime / formatEventDate", () => {
    expect(formatDateTime("2026-03-14T07:40:00.000Z")).toMatch(/14 Mar/);
    expect(formatDateTime("2026-03-14T07:40:00.000Z")).toMatch(/10:40/);
    expect(formatDateTime(null)).toBe("—");
    expect(formatEventDate("2026-03-14")).toBe("14 March 2026");
    expect(formatEventDate("2026-03-14", "short")).toBe("14 Mar 2026");
    expect(formatEventDate(null)).toBe("Date TBC");
    expect(formatEventDate("garbage")).toBe("garbage");
  });

  it("secondsAgo / formatAgo", () => {
    const now = new Date("2026-03-14T07:40:00.000Z");
    expect(secondsAgo("2026-03-14T07:39:30.000Z", now)).toBe(30);
    expect(secondsAgo("2026-03-14T07:41:00.000Z", now)).toBe(0);
    expect(secondsAgo(null, now)).toBeNull();
    expect(secondsAgo("bad", now)).toBeNull();
    expect(formatAgo(null)).toBe("never");
    expect(formatAgo(2)).toBe("just now");
    expect(formatAgo(45)).toBe("45s ago");
    expect(formatAgo(130)).toBe("2 min ago");
    expect(formatAgo(7200)).toBe("2h ago");
    expect(formatAgo(90_000)).toBe("1d ago");
  });

  it("isValidTimeZone", () => {
    expect(isValidTimeZone("Asia/Qatar")).toBe(true);
    expect(isValidTimeZone("Not/AZone")).toBe(false);
  });
});

describe("zoneLabel / formatStamp / formatIn", () => {
  const now = new Date("2026-10-06T11:00:00.000Z"); // 14:00 in Qatar

  it("names the clock: Qatar time for the default zone, the short zone name otherwise", () => {
    expect(zoneLabel()).toBe("Qatar time");
    expect(zoneLabel("Asia/Qatar")).toBe("Qatar time");
    expect(zoneLabel("Asia/Dubai", now)).toBe("GMT+4");
    expect(zoneLabel("Not/AZone")).toBe("Not/AZone");
  });

  it("labels the zone and adds the date only when it is not today there", () => {
    expect(formatStamp("2026-10-06T10:05:00.000Z", "Asia/Qatar", now)).toBe("13:05 Qatar time");
    expect(formatStamp("2026-10-05T10:05:00.000Z", "Asia/Qatar", now)).toBe("5 Oct, 13:05 Qatar time");
    // 21:30Z on the 5th is already the 6th in Qatar.
    expect(formatStamp("2026-10-05T21:30:00.000Z", "Asia/Qatar", now)).toBe("00:30 Qatar time");
    expect(formatStamp(null)).toBe("—");
    expect(formatStamp("garbage")).toBe("—");
  });

  it("counts down to the next check", () => {
    expect(formatIn("2026-10-06T11:00:42.000Z", now)).toBe("in 42s");
    expect(formatIn("2026-10-06T11:02:30.000Z", now)).toBe("in 3 min");
    expect(formatIn("2026-10-06T10:59:00.000Z", now)).toBe("now");
    expect(formatIn(null, now)).toBeNull();
  });
});
