import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/roles", () => ({ requireStudioUser: async () => ({ ok: true, viewer: { userId: OWNER, email: "owner@test", role: "owner" } }) }));
const writeAudit = vi.fn(async (...args: unknown[]) => { void args; return { ok: true }; });
vi.mock("@/lib/audit", () => ({ writeAudit: (...args: unknown[]) => writeAudit(...args) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => client }));

import { convertLeadToBooking } from "@/lib/actions/leads";

const OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LEAD = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PERSON = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const QUOTE_SERVICE = "77777777-7777-4777-8777-777777777777";
const FIXED_SERVICE = "88888888-8888-4888-8888-888888888888";

type Row = Record<string, unknown>;
type Result = { data: unknown; error: { code?: string; message: string } | null; count?: number | null };
type Write = { table: string; op: string; payload?: unknown; filters: Array<[string, unknown]>; isNull: string[] };

/** Scripted results per table (consumed in order) and a record of every write with its filters. */
let results: Record<string, Result[]>;
let writes: Write[];
let client: { auth: { getUser: () => Promise<{ data: { user: { id: string } } }> }; from: (table: string) => unknown };

function makeClient() {
  return {
    auth: { getUser: async () => ({ data: { user: { id: OWNER } } }) },
    from(table: string) {
      const w: Write = { table, op: "select", filters: [], isNull: [] };
      const self: Record<string, unknown> = {};
      for (const m of ["select", "order", "limit", "maybeSingle", "single", "neq", "in"]) self[m] = () => self;
      self.eq = (col: string, val: unknown) => {
        w.filters.push([col, val]);
        return self;
      };
      self.is = (col: string, val: unknown) => {
        if (val === null) w.isNull.push(col);
        return self;
      };
      for (const op of ["insert", "update", "delete"]) {
        self[op] = (payload?: unknown) => {
          w.op = op;
          w.payload = payload;
          return self;
        };
      }
      self.then = (resolve: (v: Result) => unknown, reject?: (e: unknown) => unknown) => {
        if (w.op !== "select") writes.push(w);
        const next = results[table]?.shift() ?? { data: null, error: null };
        return Promise.resolve(next).then(resolve, reject);
      };
      return self;
    },
  };
}

const lead = (over: Row = {}): Row => ({ id: LEAD, owner_id: OWNER, person_id: PERSON, organization_id: null, event_id: null, booking_type: "tournament_athlete", status: "new", source: "website", message: "Mat 3", details: { athlete_name: "Noor", service_id: QUOTE_SERVICE, service_name: "Tournament quoted", age_division: "Adult", weight_division: "-77 kg" }, booking_id: null, created_at: "", updated_at: "", ...over });
const person = { id: PERSON, full_name: "Hamad", email: "hamad@example.com", phone: "+974 5555 1234" };

beforeEach(() => {
  writes = [];
  results = {};
  client = makeClient();
  writeAudit.mockClear();
});

const bookingWrites = () => writes.filter((w) => w.table === "photo_bookings");
const leadWrites = () => writes.filter((w) => w.table === "photo_leads");

describe("convertLeadToBooking", () => {
  it("creates an inquiry at 0 QAR / quote for a quote-mode package (even with a price on the row) and claims the lead with a booking_id-is-null guard", async () => {
    results.photo_leads = [{ data: lead(), error: null }, { data: null, error: null, count: 1 }];
    results.photo_people = [{ data: person, error: null }];
    results.photo_services = [{ data: { id: QUOTE_SERVICE, name: "Tournament quoted", currency: "QAR", price_qr: 350, price_mode: "quote" }, error: null }];
    results.photo_bookings = [{ data: { id: "booking-new" }, error: null }];

    const r = await convertLeadToBooking(LEAD);
    expect(r).toEqual({ ok: true, bookingId: "booking-new" });

    const [insert] = bookingWrites();
    expect(insert.op).toBe("insert");
    expect(insert.payload).toMatchObject({ owner_id: OWNER, client_id: PERSON, lead_id: LEAD, service_id: QUOTE_SERVICE, booking_type: "tournament_athlete", booking_status: "inquiry", payment_mode: "quote", amount_qr: 0, deposit_qr: 0, balance_qr: 0, deposit_state: "not_required", package_name: "Tournament quoted", athlete_name: "Noor", customer_name: "Hamad", customer_email: "hamad@example.com", division: "Adult / -77 kg", notes: "Mat 3" });
    expect((insert.payload as Row).public_ref).toMatch(/^BB-[A-HJ-NP-Z2-9]{6}$/);

    const [claim] = leadWrites();
    expect(claim.op).toBe("update");
    expect(claim.payload).toEqual({ booking_id: "booking-new", status: "converted" });
    expect(claim.filters).toEqual(expect.arrayContaining([["id", LEAD], ["owner_id", OWNER]]));
    expect(claim.isNull).toEqual(["booking_id"]);
    expect(writeAudit).toHaveBeenCalledTimes(1);
    expect(writeAudit.mock.calls[0][1]).toMatchObject({ action: "booking.created", data: { source: "lead", lead_id: LEAD, payment_mode: "quote", amount_qr: 0 } });
  });

  it("a fixed-price package carries its price, waits for the agreement and splits the deposit on the server", async () => {
    results.photo_leads = [{ data: lead({ details: { service_id: FIXED_SERVICE } }), error: null }, { data: null, error: null, count: 1 }];
    results.photo_people = [{ data: person, error: null }];
    results.photo_services = [{ data: { id: FIXED_SERVICE, name: "Tournament fixed", currency: "QAR", price_qr: 600, price_mode: "fixed" }, error: null }];
    results.photo_bookings = [{ data: { id: "booking-priced" }, error: null }];
    expect(await convertLeadToBooking(LEAD)).toEqual({ ok: true, bookingId: "booking-priced" });
    expect(bookingWrites()[0].payload).toMatchObject({ amount_qr: 600, payment_mode: "link_later", booking_status: "awaiting_contract", deposit_percent: 50, deposit_qr: 300, balance_qr: 300, deposit_state: "pending" });
  });

  it("a club lead is always a quote, whatever its package says", async () => {
    results.photo_leads = [{ data: lead({ booking_type: "club", details: { service_id: FIXED_SERVICE } }), error: null }, { data: null, error: null, count: 1 }];
    results.photo_people = [{ data: person, error: null }];
    results.photo_services = [{ data: { id: FIXED_SERVICE, name: "Club day", currency: "QAR", price_qr: 1200, price_mode: "fixed" }, error: null }];
    results.photo_bookings = [{ data: { id: "booking-club" }, error: null }];
    expect(await convertLeadToBooking(LEAD)).toEqual({ ok: true, bookingId: "booking-club" });
    expect(bookingWrites()[0].payload).toMatchObject({ booking_type: "club", amount_qr: 0, payment_mode: "quote", booking_status: "inquiry" });
  });

  it("an already converted lead returns its booking without inserting", async () => {
    results.photo_leads = [{ data: lead({ booking_id: "booking-old" }), error: null }];
    expect(await convertLeadToBooking(LEAD)).toEqual({ ok: true, bookingId: "booking-old" });
    expect(writes).toEqual([]);
  });

  it("race: when another conversion claimed the lead first, our booking is withdrawn and the winner's id is returned", async () => {
    results.photo_leads = [{ data: lead(), error: null }, { data: null, error: null, count: 0 }, { data: { booking_id: "booking-winner" }, error: null }];
    results.photo_people = [{ data: person, error: null }];
    results.photo_services = [{ data: { id: QUOTE_SERVICE, name: "Tournament quoted", currency: "QAR", price_qr: null, price_mode: "quote" }, error: null }];
    results.photo_bookings = [{ data: { id: "booking-loser" }, error: null }, { data: null, error: null }];

    expect(await convertLeadToBooking(LEAD)).toEqual({ ok: true, bookingId: "booking-winner" });
    const [, withdraw] = bookingWrites();
    expect(withdraw.op).toBe("delete");
    expect(withdraw.filters).toEqual(expect.arrayContaining([["id", "booking-loser"], ["owner_id", OWNER], ["lead_id", LEAD]]));
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("race without a winner to show (the lead changed) is reported, not silently duplicated", async () => {
    results.photo_leads = [{ data: lead(), error: null }, { data: null, error: null, count: 0 }, { data: { booking_id: null }, error: null }];
    results.photo_people = [{ data: person, error: null }];
    results.photo_bookings = [{ data: { id: "booking-loser" }, error: null }, { data: null, error: null }];
    const r = await convertLeadToBooking(LEAD);
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/reload/i) });
    expect(bookingWrites()[1].op).toBe("delete");
  });

  it("retries the public reference on a duplicate key and gives up cleanly after three", async () => {
    results.photo_leads = [{ data: lead(), error: null }, { data: null, error: null, count: 1 }];
    results.photo_people = [{ data: person, error: null }];
    results.photo_bookings = [{ data: null, error: { code: "23505", message: "duplicate" } }, { data: { id: "booking-2" }, error: null }];
    expect(await convertLeadToBooking(LEAD)).toEqual({ ok: true, bookingId: "booking-2" });
    expect(bookingWrites()).toHaveLength(2);
    expect((bookingWrites()[0].payload as Row).public_ref).not.toBe((bookingWrites()[1].payload as Row).public_ref);

    writes = [];
    results.photo_leads = [{ data: lead(), error: null }];
    results.photo_people = [{ data: person, error: null }];
    results.photo_bookings = Array.from({ length: 3 }, () => ({ data: null, error: { code: "23505", message: "duplicate" } }));
    expect(await convertLeadToBooking(LEAD)).toMatchObject({ ok: false, error: expect.stringMatching(/reference/i) });
    expect(leadWrites()).toEqual([]);
  });

  it("rejects a bad id and a lead that is not the owner's", async () => {
    expect(await convertLeadToBooking("nope")).toMatchObject({ ok: false });
    results.photo_leads = [{ data: null, error: null }];
    expect(await convertLeadToBooking(LEAD)).toMatchObject({ ok: false, error: expect.stringMatching(/not found/i) });
    expect(writes).toEqual([]);
  });
});
