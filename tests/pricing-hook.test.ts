import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeSupabase } from "./payments/fake-supabase";
import { OWNER, booking } from "./payments/fixtures";

vi.mock("server-only", () => ({}));

import { enqueuePricingAssessment } from "@/lib/pricing/assess-hook";
import { assessmentFromRow } from "@/lib/pricing/engine";
import type { Json, PhotoPricingAssessmentRow } from "@/lib/supabase/database.types";

const NOW = new Date("2026-10-15T09:00:00.000Z");
const BOOKING = "22222222-2222-4222-8222-222222222222";
const LEAD = "55555555-5555-4555-8555-555555555555";

let db: FakeSupabase;

function clubBooking(details: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  return { ...booking({ id: BOOKING, booking_type: "club", booking_status: "inquiry", details: details as Json, usage_type: "club_team", customer_email: "secret@example.com", customer_name: "Secret Person", customer_phone: "+97455551234", notes: "private note" }), ...overrides } as unknown as Record<string, unknown>;
}

function rows(): PhotoPricingAssessmentRow[] {
  return db.tables.photo_pricing_assessments as unknown as PhotoPricingAssessmentRow[];
}

beforeEach(() => {
  db = new FakeSupabase();
  for (const t of ["photo_pricing_assessments", "photo_price_references", "photo_services", "photo_events", "photo_leads"]) db.tables[t] = [];
});

describe("enqueuePricingAssessment", () => {
  it("inserts a queued row, computes it synchronously and stores only public scope", async () => {
    db.seed("photo_bookings", [clubBooking({ athlete_count: 12, wants_photographer: true, wants_videographer: false, competition_date: "2026-11-20", hours_on_site: 8, club_name: "Secret Club", notes: "secret" })]);
    const r = await enqueuePricingAssessment(db.asClient(), { ownerId: OWNER, bookingId: BOOKING, leadId: null, reason: "public_submission" }, NOW);
    expect(r).toMatchObject({ ok: true, deduplicated: false });
    const [row] = rows();
    expect(row).toMatchObject({ owner_id: OWNER, booking_id: BOOKING, version: 1, status: "ready", trigger_reason: "public_submission", error: null });
    expect(row.request_fingerprint).toMatch(/^[0-9a-f]{32}$/);
    const text = JSON.stringify(row);
    for (const secret of ["secret@example.com", "Secret Person", "+97455551234", "Secret Club", "private note"]) expect(text).not.toContain(secret);
    const snap = assessmentFromRow(row);
    expect(snap?.request).toMatchObject({ service: "team_tournament", media: "photo", athleteCount: 12, hoursOnSite: 8 });
    expect(snap?.recommendation.recommended.target).toBeGreaterThan(0);
  });

  it("dedupes the same request for the same booking and creates a new version for a changed one; version 1 stays untouched", async () => {
    db.seed("photo_bookings", [clubBooking({ athlete_count: 12, wants_photographer: true, competition_date: "2026-11-20", hours_on_site: 8 })]);
    const client = db.asClient();
    const first = await enqueuePricingAssessment(client, { ownerId: OWNER, bookingId: BOOKING, leadId: null, reason: "public_submission" }, NOW);
    const again = await enqueuePricingAssessment(client, { ownerId: OWNER, bookingId: BOOKING, leadId: null, reason: "lead_update" }, NOW);
    expect(again).toEqual({ ok: true, assessmentId: (first as { assessmentId: string }).assessmentId, deduplicated: true });
    expect(rows()).toHaveLength(1);
    const frozen = JSON.stringify(rows()[0]);

    db.tables.photo_bookings[0].details = { athlete_count: 20, wants_photographer: true, competition_date: "2026-11-20", hours_on_site: 8 };
    const changed = await enqueuePricingAssessment(client, { ownerId: OWNER, bookingId: BOOKING, leadId: null, reason: "lead_update" }, new Date("2026-10-16T09:00:00.000Z"));
    expect(changed).toMatchObject({ ok: true, deduplicated: false });
    expect(rows()).toHaveLength(2);
    expect(rows().map((r) => r.version)).toEqual([1, 2]);
    expect(JSON.stringify(rows()[0])).toBe(frozen);
    expect(assessmentFromRow(rows()[1])?.request.athleteCount).toBe(20);
  });

  it("is needs_detail when critical inputs are missing and still returns ok", async () => {
    db.seed("photo_bookings", [clubBooking({ wants_photographer: true })]);
    const r = await enqueuePricingAssessment(db.asClient(), { ownerId: OWNER, bookingId: BOOKING, leadId: null, reason: "public_submission" }, NOW);
    expect(r).toMatchObject({ ok: true });
    expect(rows()[0]).toMatchObject({ status: "needs_detail" });
    expect(rows()[0].missing_inputs).toEqual(expect.arrayContaining(["athlete_count", "hours_on_site"]));
  });

  it("assesses a lead that has no booking yet", async () => {
    db.seed("photo_leads", [{ id: LEAD, owner_id: OWNER, person_id: null, organization_id: null, event_id: null, booking_type: "private_session", status: "new", source: "website", message: "secret message", details: { requested_date: "2026-11-02", location_preference: "our studio" }, booking_id: null }]);
    const r = await enqueuePricingAssessment(db.asClient(), { ownerId: OWNER, bookingId: null, leadId: LEAD, reason: "public_submission" }, NOW);
    expect(r).toMatchObject({ ok: true, deduplicated: false });
    expect(rows()[0]).toMatchObject({ booking_id: null, lead_id: LEAD, status: "ready", version: 1 });
    expect(JSON.stringify(rows()[0])).not.toContain("secret message");
    expect(assessmentFromRow(rows()[0])?.request.locationKind).toBe("studio");
  });

  it("never throws: an unknown booking, a missing target or a broken client all come back as a result", async () => {
    expect(await enqueuePricingAssessment(db.asClient(), { ownerId: OWNER, bookingId: BOOKING, leadId: null, reason: "public_submission" }, NOW)).toEqual({ ok: false, error: "Booking or lead not found." });
    expect(await enqueuePricingAssessment(db.asClient(), { ownerId: OWNER, bookingId: null, leadId: null, reason: "public_submission" }, NOW)).toEqual({ ok: false, error: "No booking or lead to assess." });
    const broken = { from: () => { throw new Error("connection refused"); } } as unknown as Parameters<typeof enqueuePricingAssessment>[0];
    expect(await enqueuePricingAssessment(broken, { ownerId: OWNER, bookingId: BOOKING, leadId: null, reason: "public_submission" }, NOW)).toEqual({ ok: false, error: "connection refused" });
  });

  it("leaves the row queued with the error when the compute step fails after the insert", async () => {
    db.seed("photo_bookings", [clubBooking({ athlete_count: 12, wants_photographer: true, hours_on_site: 8 })]);
    const client = db.asClient();
    const realFrom = db.from.bind(db);
    let reads = 0;
    // The reference read (first query after the insert) fails; the hook must not throw.
    (db as unknown as { from: (t: string) => unknown }).from = (table: string) => {
      if (table === "photo_price_references" && reads++ === 0) throw new Error("refs unavailable");
      return realFrom(table);
    };
    const r = await enqueuePricingAssessment(client, { ownerId: OWNER, bookingId: BOOKING, leadId: null, reason: "public_submission" }, NOW);
    expect(r).toMatchObject({ ok: true, deduplicated: false });
    expect(rows()[0]).toMatchObject({ status: "queued", error: "refs unavailable" });
  });

  it("retries once with a fresh version when a concurrent insert took the version, and still dedupes on the fingerprint index", async () => {
    db.seed("photo_bookings", [clubBooking({ athlete_count: 12, wants_photographer: true, hours_on_site: 8 })]);
    const client = db.asClient();
    const realFrom = db.from.bind(db);
    const clashes: string[] = ["photo_pricing_assessments_booking_version_idx"];
    const inserts: number[] = [];
    (db as unknown as { from: (t: string) => unknown }).from = (table: string) => {
      const q = realFrom(table) as unknown as { insert: (row: Record<string, unknown>) => unknown };
      if (table !== "photo_pricing_assessments") return q;
      const realInsert = q.insert.bind(q);
      q.insert = (row: Record<string, unknown>) => {
        inserts.push(row.version as number);
        const clash = clashes.shift();
        if (!clash) return realInsert(row);
        const failing = { select: () => failing, single: () => failing, then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { code: "23505", message: `duplicate key value violates unique constraint "${clash}"` } }).then(resolve) };
        return failing;
      };
      return q;
    };
    const r = await enqueuePricingAssessment(client, { ownerId: OWNER, bookingId: BOOKING, leadId: null, reason: "public_submission" }, NOW);
    expect(r).toMatchObject({ ok: true, deduplicated: false });
    expect(inserts).toEqual([1, 1]);
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ version: 1, status: "ready" });

    // A fingerprint clash is a dedupe: no retry, no row.
    db.tables.photo_bookings[0].details = { athlete_count: 13, wants_photographer: true, hours_on_site: 8 };
    clashes.push("photo_pricing_assessments_queued_fingerprint_idx");
    inserts.length = 0;
    const d = await enqueuePricingAssessment(client, { ownerId: OWNER, bookingId: BOOKING, leadId: null, reason: "public_submission" }, NOW);
    expect(d).toEqual({ ok: true, assessmentId: null, deduplicated: true });
    expect(inserts).toEqual([2]);
    expect(rows()).toHaveLength(1);

    // Two version clashes in a row: give up as a dedupe rather than loop.
    clashes.push("photo_pricing_assessments_booking_version_idx", "photo_pricing_assessments_booking_version_idx");
    inserts.length = 0;
    expect(await enqueuePricingAssessment(client, { ownerId: OWNER, bookingId: BOOKING, leadId: null, reason: "public_submission" }, NOW)).toEqual({ ok: true, assessmentId: null, deduplicated: true });
    expect(inserts).toEqual([2, 2]);
  });
});
