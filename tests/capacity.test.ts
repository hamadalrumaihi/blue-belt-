import { describe, expect, it } from "vitest";
import { CAPACITY_NOTE, candidateDay, dayOf, describeConflicts, overlaps } from "@/lib/studio/capacity";
import type { BookingStatus } from "@/lib/supabase/database.types";
import { booking } from "./payments/fixtures";

const b = (id: string, status: BookingStatus, session_at: string | null) => booking({ id, booking_status: status, session_at, customer_name: `C ${id}`, public_ref: `BB-${id}` });

describe("capacity", () => {
  it("dayOf uses the studio zone (Qatar), so a late-UTC session is the next local day", () => {
    expect(dayOf("2026-10-10T22:30:00.000Z")).toBe("2026-10-11");
    expect(dayOf("2026-10-10T10:00:00.000Z")).toBe("2026-10-10");
    expect(dayOf("2026-10-10")).toBe("2026-10-10");
    expect(dayOf("nope")).toBeNull();
    expect(dayOf(null)).toBeNull();
    expect(candidateDay({ date: "2026-10-12", sessionAt: "2026-10-10T10:00:00.000Z" })).toBe("2026-10-12");
    expect(candidateDay({})).toBeNull();
  });

  it("flags only confirmed / in-progress bookings and events on the same day, never the candidate itself", () => {
    const bookings = [
      b("own", "confirmed", "2026-10-10T06:00:00.000Z"),
      b("c1", "confirmed", "2026-10-10T09:00:00.000Z"),
      b("c2", "in_progress", "2026-10-10T12:00:00.000Z"),
      b("q1", "quoted", "2026-10-10T12:00:00.000Z"),
      b("i1", "inquiry", "2026-10-10T12:00:00.000Z"),
      b("c3", "confirmed", "2026-10-11T09:00:00.000Z"),
      b("x1", "cancelled", "2026-10-10T09:00:00.000Z"),
    ];
    const events = [
      { id: "e1", name: "Qatar Open", event_date: "2026-10-10", venue: "Lusail" },
      { id: "e2", name: "Later", event_date: "2026-10-12", venue: null },
    ];
    const out = overlaps(bookings, { id: "own", sessionAt: "2026-10-10T06:00:00.000Z" }, events);
    expect(out.map((c) => `${c.kind}:${c.id}`)).toEqual(["booking:c1", "booking:c2", "event:e1"]);
    expect(out[0]).toMatchObject({ href: "/bookings/c1", title: "C c1 · BB-c1", status: "confirmed" });
    expect(out[2]).toMatchObject({ href: "/events/e1", where: "Lusail" });
    expect(describeConflicts(out)).toBe("Same day as 2 confirmed bookings and 1 event.");
  });

  it("does not report the candidate's own event, and returns nothing without a date", () => {
    const events = [{ id: "e1", name: "Qatar Open", event_date: "2026-10-10", venue: null }];
    expect(overlaps([], { sessionAt: "2026-10-10T06:00:00.000Z", eventId: "e1" }, events)).toEqual([]);
    expect(overlaps([b("c1", "confirmed", "2026-10-10T09:00:00.000Z")], { sessionAt: null }, events)).toEqual([]);
    expect(describeConflicts([])).toBeNull();
  });

  it("says in plain words that a request never reserves a slot", () => {
    expect(CAPACITY_NOTE).toMatch(/never reserves a slot/);
  });
});
