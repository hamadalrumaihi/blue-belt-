import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/** The fake session: who is signed in and which photo_profiles.role they have. */
const session: { user: { id: string; email: string } | null; role: "owner" | "staff" | "client" } = { user: null, role: "owner" };
const roleChecks = vi.fn();

vi.mock("@/lib/roles", () => ({
  requireOwner: async () => {
    roleChecks();
    if (!session.user) return { ok: false, error: "You are signed out." };
    if (session.role !== "owner") return { ok: false, error: "Only the studio owner can use pricing." };
    return { ok: true, viewer: { userId: session.user.id, email: session.user.email, role: "owner" } };
  },
  requireStudioUser: async () => {
    throw new Error("pricing actions must use requireOwner, not requireStudioUser");
  },
  isStudioRole: (r: string) => r !== "client",
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  notFound: vi.fn(),
}));
const writeAudit = vi.fn(async () => ({ ok: true }));
vi.mock("@/lib/audit", () => ({ writeAudit: (...args: unknown[]) => writeAudit(...(args as [])) }));
// Nothing in pricing may reach a customer: the notification modules are poisoned.
vi.mock("@/lib/notifications/owner", () => ({ enqueueOwnerTelegram: () => { throw new Error("pricing must not notify"); } }));
vi.mock("@/lib/notifications/email/outbox", () => ({ enqueueClientEmail: () => { throw new Error("pricing must not e-mail"); } }));

type Result = { data: unknown; error: { code?: string; message: string } | null; count?: number | null };
const results: Record<string, Result | Result[]> = {};
const writes: Array<{ table: string; op: string; payload?: unknown; filters: Array<[string, unknown]> }> = [];
const reads: string[] = [];

function chain(table: string) {
  const self: Record<string, unknown> = {};
  const filters: Array<[string, unknown]> = [];
  let current: { table: string; op: string; payload?: unknown; filters: Array<[string, unknown]> } | null = null;
  for (const m of ["select", "order", "limit", "maybeSingle", "single", "in", "is", "not", "or", "gte", "lte"]) {
    self[m] = () => {
      if (m === "select" && !current) reads.push(table);
      return self;
    };
  }
  for (const f of ["eq", "neq"]) {
    self[f] = (col: string, val: unknown) => {
      filters.push([`${f}:${col}`, val]);
      return self;
    };
  }
  for (const op of ["insert", "update", "delete", "upsert"]) {
    self[op] = (payload?: unknown) => {
      current = { table, op, payload, filters };
      writes.push(current);
      return self;
    };
  }
  self.then = (resolve: (v: Result) => unknown, reject?: (e: unknown) => unknown) => {
    const r = results[table];
    const next = Array.isArray(r) ? (r.shift() ?? { data: null, error: null }) : (r ?? { data: null, error: null });
    return Promise.resolve(next).then(resolve, reject);
  };
  return self;
}

const createClient = vi.fn(async () => ({ auth: { getUser: async () => ({ data: { user: session.user } }) }, from: (table: string) => chain(table) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: (...a: unknown[]) => createClient(...(a as [])) }));

import { applyQuoteToBooking, createPriceReference, createQuote, deletePriceReference, discardQuote, updatePriceReference } from "@/lib/actions/pricing";
import { booking } from "./payments/fixtures";

const OWNER = "11111111-1111-4111-8111-111111111111";
const REF = "33333333-3333-4333-8333-333333333333";
const QUOTE = "44444444-4444-4444-8444-444444444444";
const BOOKING = "22222222-2222-4222-8222-222222222222";

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

const goodRef = { provider: "Doha Sports Photo", service_type: "tournament_athlete", price_from: "400", price_to: "600", includes_hours: "2", includes_video: "no" };
const goodInputs = { service_type: "tournament_athlete" as const, hours: 3, athletes: 1, photos_expected: null, video: false, editing_hours: 1, travel_km: null, travel_cost_qr: null, video_partner_cost_qr: null, other_costs_qr: null, margin_percent: 30, target_hourly_qr: 100, notes: null };

function quoteRow(overrides: Record<string, unknown> = {}) {
  return { id: QUOTE, owner_id: OWNER, booking_id: BOOKING, status: "draft", inputs: goodInputs, calculation: {}, suggested_from: 600, suggested_to: 900, chosen_amount_qr: null, currency: "QAR", notes: null, created_at: "2026-10-06T00:00:00.000Z", updated_at: "2026-10-06T00:00:00.000Z", ...overrides };
}

beforeEach(() => {
  for (const k of Object.keys(results)) delete results[k];
  writes.length = 0;
  reads.length = 0;
  writeAudit.mockClear();
  roleChecks.mockClear();
  createClient.mockClear();
  session.user = { id: OWNER, email: "owner@example.test" };
  session.role = "owner";
});

async function everyAction() {
  return {
    create: await createPriceReference(null, fd(goodRef)),
    update: await updatePriceReference(REF, null, fd(goodRef)),
    del: await deletePriceReference(REF),
    quote: await createQuote({ bookingId: BOOKING, inputs: goodInputs }),
    apply: await applyQuoteToBooking(QUOTE, 750),
    discard: await discardQuote(QUOTE),
  };
}

describe("owner gate", () => {
  it("refuses a client-role account on every action with no database access", async () => {
    session.role = "client";
    const out = await everyAction();
    expect(out.create).toEqual({ error: "Only the studio owner can use pricing." });
    expect(out.update).toEqual({ error: "Only the studio owner can use pricing." });
    expect(out.del).toEqual({ ok: false, error: "Only the studio owner can use pricing." });
    expect(out.quote).toEqual({ ok: false, error: "Only the studio owner can use pricing." });
    expect(out.apply).toEqual({ ok: false, error: "Only the studio owner can use pricing." });
    expect(out.discard).toEqual({ ok: false, error: "Only the studio owner can use pricing." });
    expect(createClient).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
    expect(reads).toEqual([]);
    expect(writeAudit).not.toHaveBeenCalled();
    expect(roleChecks).toHaveBeenCalledTimes(6);
  });

  it("refuses a staff-role account the same way (studio user is not enough)", async () => {
    session.role = "staff";
    const out = await everyAction();
    expect(Object.values(out).every((r) => JSON.stringify(r).includes("Only the studio owner can use pricing."))).toBe(true);
    expect(createClient).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
    expect(reads).toEqual([]);
  });

  it("refuses a signed-out caller", async () => {
    session.user = null;
    const out = await everyAction();
    expect(out.create).toEqual({ error: "You are signed out." });
    expect(out.apply).toEqual({ ok: false, error: "You are signed out." });
    expect(createClient).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });
});

describe("reference prices (owner)", () => {
  it("createPriceReference validates before any insert, then inserts with the session's owner id and redirects", async () => {
    const bad = await createPriceReference(null, fd({ provider: "", service_type: "club", price_from: "x" }));
    expect(bad).toMatchObject({ fieldErrors: { provider: expect.any(String), price_from: expect.any(String) } });
    expect(writes).toEqual([]);

    results.photo_price_references = { data: { id: REF }, error: null };
    await expect(createPriceReference(null, fd({ ...goodRef, notes: "x" }))).rejects.toThrow("NEXT_REDIRECT:/pricing");
    const insert = writes.find((w) => w.table === "photo_price_references" && w.op === "insert");
    expect(insert?.payload).toMatchObject({ owner_id: OWNER, provider: "Doha Sports Photo", service_type: "tournament_athlete", price_from: 400, price_to: 600, currency: "QAR", includes: { hours: 2, video: false } });
    expect(writeAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ ownerId: OWNER, actorId: OWNER, action: "price_reference.created", entityId: REF }));
  });

  it("updatePriceReference and deletePriceReference scope the write to the owner's row and refuse an unknown id", async () => {
    results.photo_price_references = { data: null, error: null, count: 0 };
    expect(await updatePriceReference(REF, null, fd(goodRef))).toEqual({ error: "Reference not found or you do not have access to it." });
    expect(writes[0]).toMatchObject({ table: "photo_price_references", op: "update", filters: [["eq:id", REF], ["eq:owner_id", OWNER]] });
    expect(writeAudit).not.toHaveBeenCalled();

    writes.length = 0;
    results.photo_price_references = { data: null, error: null, count: 1 };
    expect(await deletePriceReference(REF)).toEqual({ ok: true });
    expect(writes[0]).toMatchObject({ table: "photo_price_references", op: "delete", filters: [["eq:id", REF], ["eq:owner_id", OWNER]] });
    expect(writeAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "price_reference.deleted" }));
    expect(await deletePriceReference("nope")).toEqual({ ok: false, error: "Invalid reference id." });
    expect(await updatePriceReference("nope", null, fd(goodRef))).toEqual({ error: "Invalid reference id." });
  });
});

describe("createQuote (owner)", () => {
  it("re-validates the inputs, checks the booking is the owner's, computes the suggestion from the owner's references and stores a draft", async () => {
    expect(await createQuote({ bookingId: "nope", inputs: goodInputs })).toEqual({ ok: false, error: "Invalid booking." });
    expect(await createQuote({ bookingId: null, inputs: { service_type: "x" } })).toMatchObject({ ok: false, fieldErrors: { service_type: expect.any(String) } });
    expect(writes).toEqual([]);

    results.photo_bookings = { data: null, error: null };
    expect(await createQuote({ bookingId: BOOKING, inputs: goodInputs })).toEqual({ ok: false, error: "Booking not found." });

    results.photo_bookings = { data: { id: BOOKING }, error: null };
    results.photo_price_references = { data: [{ id: REF, owner_id: OWNER, provider: "A", source_url: null, checked_on: "2026-09-01", location: null, service_type: "tournament_athlete", price_from: 300, price_to: null, currency: "QAR", includes: { hours: 1 }, notes: null, created_at: "", updated_at: "" }], error: null };
    results.photo_quotes = { data: { id: QUOTE }, error: null };
    const out = await createQuote({ bookingId: BOOKING, inputs: goodInputs });
    expect(out).toEqual({ ok: true, id: QUOTE });
    const insert = writes.find((w) => w.table === "photo_quotes" && w.op === "insert")!;
    // 3 h × 300 QAR/h = 900 baseline; editing 1 h × 100 = 100; margin 30% = 30 → 1030.
    expect(insert.payload).toMatchObject({ owner_id: OWNER, booking_id: BOOKING, status: "draft", suggested_from: 1030, suggested_to: 1030, currency: "QAR", inputs: goodInputs });
    expect((insert.payload as { calculation: { confidence: string; steps: string[] } }).calculation).toMatchObject({ confidence: "low", steps: expect.arrayContaining([expect.stringContaining("Editing: 1 h × 100 QAR per hour")]) });
    expect(writeAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "quote.created", entityId: QUOTE }));
  });
});

describe("applyQuoteToBooking (owner)", () => {
  it("refuses an amount of 0 or less, or junk, before any query", async () => {
    for (const amount of [0, -10, "0", "abc", Number.NaN]) {
      expect(await applyQuoteToBooking(QUOTE, amount)).toMatchObject({ ok: false, error: expect.stringMatching(/above 0/) });
    }
    expect(await applyQuoteToBooking("nope", 100)).toEqual({ ok: false, error: "Invalid quote." });
    expect(createClient).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  it("refuses a discarded quote, a quote without a booking, a closed booking and a provider-paid booking", async () => {
    results.photo_quotes = { data: quoteRow({ status: "discarded" }), error: null };
    expect(await applyQuoteToBooking(QUOTE, 100)).toMatchObject({ ok: false, error: expect.stringMatching(/discarded/) });
    results.photo_quotes = { data: quoteRow({ booking_id: null }), error: null };
    expect(await applyQuoteToBooking(QUOTE, 100)).toMatchObject({ ok: false, error: expect.stringMatching(/not linked/) });
    results.photo_quotes = { data: quoteRow(), error: null };
    results.photo_bookings = { data: booking({ booking_status: "cancelled" }), error: null };
    expect(await applyQuoteToBooking(QUOTE, 100)).toMatchObject({ ok: false, error: expect.stringMatching(/cancelled/) });
    results.photo_quotes = { data: quoteRow(), error: null };
    results.photo_bookings = { data: booking({ status: "paid", booking_status: "confirmed" }), error: null };
    expect(await applyQuoteToBooking(QUOTE, 100)).toMatchObject({ ok: false, error: expect.stringMatching(/already paid/) });
    expect(writes).toEqual([]);
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("writes amount_qr, moves an inquiry to quoted, marks the quote applied and audits, with no client contact", async () => {
    results.photo_quotes = [{ data: quoteRow(), error: null }, { data: null, error: null }];
    results.photo_bookings = [
      { data: booking({ booking_status: "inquiry", amount_qr: 0, status: "pending", quoted_at: null }), error: null },
      { data: { id: BOOKING, client_id: null, booking_status: "quoted" }, error: null },
    ];
    expect(await applyQuoteToBooking(QUOTE, "750", "  Agreed on the phone  ")).toEqual({ ok: true });
    const bookingUpdate = writes.find((w) => w.table === "photo_bookings" && w.op === "update")!;
    expect(bookingUpdate.payload).toMatchObject({ amount_qr: 750, booking_status: "quoted", quoted_at: expect.any(String) });
    expect(bookingUpdate.payload).not.toHaveProperty("status");
    expect(bookingUpdate.filters).toEqual([["eq:id", BOOKING], ["eq:owner_id", OWNER], ["eq:booking_status", "inquiry"]]);
    const quoteUpdate = writes.find((w) => w.table === "photo_quotes" && w.op === "update")!;
    expect(quoteUpdate.payload).toEqual({ status: "applied", chosen_amount_qr: 750, notes: "Agreed on the phone" });
    expect(quoteUpdate.filters).toEqual([["eq:id", QUOTE], ["eq:owner_id", OWNER]]);
    expect(writeAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ entity: "booking", entityId: BOOKING, action: "quote.applied", data: expect.objectContaining({ quote_id: QUOTE, amount_qr: 750, from: "inquiry", to: "quoted" }) }));
  });

  it("leaves a later lifecycle stage alone and sets the amount with the server-side 50/50 split", async () => {
    results.photo_quotes = { data: quoteRow(), error: null };
    results.photo_bookings = [{ data: booking({ booking_status: "awaiting_payment", amount_qr: 350 }), error: null }, { data: { id: BOOKING, client_id: null, booking_status: "awaiting_payment" }, error: null }];
    expect(await applyQuoteToBooking(QUOTE, 900)).toEqual({ ok: true });
    const bookingUpdate = writes.find((w) => w.table === "photo_bookings" && w.op === "update")!;
    expect(bookingUpdate.payload).toEqual({ amount_qr: 900, deposit_percent: 50, deposit_qr: 450, balance_qr: 450, deposit_state: "pending" });
  });

  it("only moves the balance once the deposit is paid", async () => {
    results.photo_quotes = { data: quoteRow(), error: null };
    results.photo_bookings = [{ data: booking({ booking_status: "confirmed", amount_qr: 1000, deposit_state: "paid", deposit_qr: 500, balance_qr: 500 }), error: null }, { data: { id: BOOKING, client_id: null, booking_status: "confirmed" }, error: null }];
    expect(await applyQuoteToBooking(QUOTE, 1200)).toEqual({ ok: true });
    const bookingUpdate = writes.find((w) => w.table === "photo_bookings" && w.op === "update")!;
    expect(bookingUpdate.payload).toEqual({ amount_qr: 1200, balance_qr: 700 });
  });

  it("reports a concurrent change instead of applying blindly", async () => {
    results.photo_quotes = { data: quoteRow(), error: null };
    results.photo_bookings = [{ data: booking({ booking_status: "inquiry" }), error: null }, { data: null, error: null }];
    expect(await applyQuoteToBooking(QUOTE, 500)).toMatchObject({ ok: false, error: expect.stringMatching(/changed in the meantime/) });
    expect(writes.filter((w) => w.table === "photo_quotes")).toEqual([]);
  });
});

describe("discardQuote (owner)", () => {
  it("marks a draft discarded, scoped to the owner, and never an applied one", async () => {
    results.photo_quotes = { data: null, error: null, count: 1 };
    expect(await discardQuote(QUOTE)).toEqual({ ok: true });
    expect(writes[0]).toMatchObject({ table: "photo_quotes", op: "update", payload: { status: "discarded" }, filters: [["eq:id", QUOTE], ["eq:owner_id", OWNER], ["neq:status", "applied"]] });
    results.photo_quotes = { data: null, error: null, count: 0 };
    expect(await discardQuote(QUOTE)).toMatchObject({ ok: false, error: expect.stringMatching(/already applied/) });
  });
});
