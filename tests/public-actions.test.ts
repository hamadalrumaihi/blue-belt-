import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
let forwardedFor = "203.0.113.10";
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers({ "x-forwarded-for": `${forwardedFor}, 10.0.0.1`, "user-agent": "Mozilla/5.0 (test)" })) }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));
const loadPublicStudio = vi.fn();
vi.mock("@/lib/studio/queries", () => ({ loadPublicStudio: (...a: unknown[]) => loadPublicStudio(...a), siteUrl: () => "https://studio.test" }));
const listPublicEvents = vi.fn();
vi.mock("@/lib/studio/public-events", () => ({ listPublicEvents: (...a: unknown[]) => listPublicEvents(...a) }));
let service: FakeService;
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => service, isServiceClientConfigured: () => true }));
vi.mock("@/lib/time", async (orig) => ({ ...(await orig<typeof import("@/lib/time")>()), todayInZone: () => "2026-10-06" }));
const enqueuePricingAssessment = vi.fn();
vi.mock("@/lib/pricing/assess-hook", () => ({ enqueuePricingAssessment: (...a: unknown[]) => enqueuePricingAssessment(...a) }));

import { submitContact, submitPublicBooking } from "@/lib/actions/public";
import { HONEYPOT_FIELD } from "@/lib/bookings/public-form";
import { PRIVACY_VERSION, TERMS_VERSION } from "@/lib/legal/versions";
import { RULES, rateLimit, resetRateLimits } from "@/lib/rate-limit";

const OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EVENT_ID = "11111111-1111-4111-8111-111111111111";
const SERVICE_ID = "22222222-2222-4222-8222-222222222222";
const BIG_SERVICE = "66666666-6666-4666-8666-666666666666";
const QUOTE_SERVICE = "77777777-7777-4777-8777-777777777777";
const FIXED_SERVICE = "88888888-8888-4888-8888-888888888888";
const CLUB_SERVICE = "99999999-9999-4999-8999-999999999999";
const KEY = "55555555-5555-4555-8555-555555555555";
const BOOKING_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const LEAD_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PERSON_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

type Row = Record<string, unknown>;
type Call = { table: string; op: string; payload: Row | Row[] | null; filters: Array<[string, unknown]> };
type RpcCall = { fn: string; args: Row; seq: number };

/**
 * Chain recorder plus an RPC stub. Table calls are recorded (the contact
 * form still writes rows directly; the booking flow must not). `rpc()`
 * records the call and answers with the scripted result, so tests can
 * assert what the transaction received and what happened after it.
 */
class FakeService {
  calls: Call[] = [];
  rpcCalls: RpcCall[] = [];
  seq = 0;
  rpcResult: { data: unknown; error: { code?: string; message: string } | null } = { data: { booking_id: BOOKING_ID, lead_id: LEAD_ID, person_id: PERSON_ID, public_ref: "BB-7K3PQ2", replay: false }, error: null };
  /** When set, writes to this table fail. */
  failTable: string | null = null;
  async rpc(fn: string, args: Row) {
    this.seq += 1;
    this.rpcCalls.push({ fn, args, seq: this.seq });
    return this.rpcResult;
  }
  from(table: string) {
    const call: Call = { table, op: "select", payload: null, filters: [] };
    let mode: "many" | "single" | "maybeSingle" = "many";
    const chain: Record<string, unknown> = {};
    const self = () => chain;
    for (const m of ["eq", "ilike", "in", "order", "limit", "neq", "is"]) {
      chain[m] = (col: string, val: unknown) => {
        if (m === "eq" || m === "ilike") call.filters.push([col, val]);
        return self();
      };
    }
    chain.select = () => self();
    chain.insert = (p: Row | Row[]) => {
      call.op = "insert";
      call.payload = p;
      return self();
    };
    chain.update = (p: Row) => {
      call.op = "update";
      call.payload = p;
      return self();
    };
    chain.upsert = (p: Row) => {
      call.op = "upsert";
      call.payload = p;
      return self();
    };
    chain.single = () => {
      mode = "single";
      return self();
    };
    chain.maybeSingle = () => {
      mode = "maybeSingle";
      return self();
    };
    chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
      this.seq += 1;
      this.calls.push({ ...call, seq: this.seq } as Call);
      return Promise.resolve(this.exec(call, mode)).then(resolve, reject);
    };
    return chain;
  }
  private exec(call: Call, mode: string) {
    const one = (row: Row) => ({ data: mode === "many" ? [row] : row, error: null });
    if (this.failTable === call.table && call.op !== "select") return { data: null, error: { code: "XX000", message: "connection reset" } };
    if (call.table === "photo_people") {
      if (call.op === "insert") return one({ id: "person-1", ...(call.payload as Row) });
      return { data: mode === "many" ? [] : null, error: null };
    }
    if (call.table === "photo_leads") {
      if (call.op === "insert") return one({ id: "lead-1" });
      return { data: null, error: null };
    }
    if (call.table === "photo_notification_deliveries") return { data: [{ id: 1 }], error: null };
    if (call.table === "photo_client_notification_prefs") return { data: null, error: null };
    return { data: null, error: null };
  }
  inserts(table: string): Row[] {
    return this.calls.filter((c) => c.table === table && c.op === "insert").flatMap((c) => (Array.isArray(c.payload) ? c.payload : [c.payload!]));
  }
  upserts(table: string): Row[] {
    return this.calls.filter((c) => c.table === table && c.op === "upsert").map((c) => c.payload as Row);
  }
  writes(): Call[] {
    return this.calls.filter((c) => c.op !== "select");
  }
  firstWriteSeq(table: string): number | null {
    const c = this.calls.find((x) => x.table === table && x.op !== "select") as (Call & { seq: number }) | undefined;
    return c?.seq ?? null;
  }
}

const serviceRow = (id: string, name: string, price: number | null, price_mode: "fixed" | "from" | "quote" = "from", booking_type = "tournament_athlete") => ({ id, owner_id: OWNER, code: name.slice(0, 2), name, booking_type, description: "All matches. Set your price.", price_qr: price, price_mode, deposit_qr: null, currency: "QAR", duration_minutes: null, includes_photo: true, includes_video: false, active: true, public: true, sort_order: 0, created_at: "", updated_at: "" });
const studio = {
  studio: { owner_id: OWNER, business_name: "Blue Belt Media", tagline: null, about: null, city: "Doha", email: null, phone: null, whatsapp: null, instagram: null, public_booking: true, settings: {}, created_at: "", updated_at: "" },
  services: [
    serviceRow(SERVICE_ID, "Tournament photo", 350),
    serviceRow(BIG_SERVICE, "Tournament full day", 1000),
    // Production shape (issue #10): quote mode with a number on the row.
    serviceRow(QUOTE_SERVICE, "Tournament quoted", 350, "quote"),
    serviceRow(FIXED_SERVICE, "Tournament fixed", 600, "fixed"),
    serviceRow(CLUB_SERVICE, "Club day", 1200, "fixed", "club"),
  ],
};

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

const LEGAL = { accept_terms: "1", accept_privacy: "1", consent_media: "1" };
const ATHLETE = {
  service_key: "tournament_athlete",
  media_scope: "photo",
  event_id: EVENT_ID,
  service_id: SERVICE_ID,
  full_name: "Hamad",
  phone: "+974 5555 1234",
  email: "hamad@example.com",
  client_type: "individual",
  usage_type: "personal",
  subject_is_minor: "no",
  idempotency_key: KEY,
  ...LEGAL,
  // Never trusted from the browser:
  owner_id: "evil-owner",
  amount_qr: "1",
  deposit_qr: "0",
  booking_status: "confirmed",
};
const CLUB = { service_key: "team_tournament", media_scope: "video", video_reels: "1", club_name: "Team Nogueira", event_name: "Doha Open", athlete_count: "12", full_name: "Coach Ali", phone: "+974 5555 9999", email: "ali@example.com", client_type: "club_team", usage_type: "club_team", idempotency_key: KEY, ...LEGAL };

let ipCounter = 0;
beforeEach(() => {
  resetRateLimits();
  ipCounter += 1;
  forwardedFor = `203.0.113.${ipCounter}`;
  service = new FakeService();
  loadPublicStudio.mockReset();
  loadPublicStudio.mockResolvedValue(studio);
  listPublicEvents.mockReset();
  listPublicEvents.mockResolvedValue([{ id: EVENT_ID, name: "AJP Qatar National", event_date: "2026-11-20" }]);
  enqueuePricingAssessment.mockReset();
  enqueuePricingAssessment.mockImplementation(async () => {
    service.seq += 1;
    return { ok: true, assessmentId: "assess-1", deduplicated: false, seq: service.seq };
  });
});

async function expectRedirect(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    const m = /^NEXT_REDIRECT:(.*)$/.exec((e as Error).message);
    if (m) return m[1];
    throw e;
  }
  throw new Error("expected a redirect");
}

const rpcBooking = () => service.rpcCalls[0].args.p_booking as Row;

describe("submitPublicBooking", () => {
  it("is rate limited per client IP before touching the studio", async () => {
    for (let i = 0; i < RULES.publicFormPerIp.max; i += 1) rateLimit(`public-form:${forwardedFor}`, RULES.publicFormPerIp);
    const r = await submitPublicBooking(null, fd(ATHLETE));
    expect(r).toMatchObject({ error: expect.stringMatching(/too many/i) });
    expect(loadPublicStudio).not.toHaveBeenCalled();
    expect(service.calls).toEqual([]);
    expect(service.rpcCalls).toEqual([]);
  });

  it("refuses when no studio has opened public booking", async () => {
    loadPublicStudio.mockResolvedValue(null);
    expect(await submitPublicBooking(null, fd(ATHLETE))).toEqual({ error: "Booking is not open yet." });
    expect(service.rpcCalls).toEqual([]);
  });

  it("returns field errors without writing anything", async () => {
    const r = await submitPublicBooking(null, fd({ ...ATHLETE, email: "nope", accept_terms: "", media_scope: "" }));
    expect(r).toMatchObject({ fieldErrors: { email: expect.any(String), accept_terms: expect.any(String), media_scope: expect.any(String) } });
    expect(service.writes()).toEqual([]);
    expect(service.rpcCalls).toEqual([]);
  });

  it("a minor needs guardian details and guardian consent, and nothing is written until they are given", async () => {
    const r = await submitPublicBooking(null, fd({ ...ATHLETE, client_type: "parent_guardian", athlete_name: "Noor", subject_is_minor: "yes" }));
    expect(r).toMatchObject({ fieldErrors: { guardian_name: expect.any(String), guardian_email: expect.any(String), guardian_phone: expect.any(String), guardian_consent: expect.any(String) } });
    expect(service.rpcCalls).toEqual([]);
  });

  it("a tripped honeypot returns a clear error, not a field error, and writes nothing", async () => {
    const r = await submitPublicBooking(null, fd({ ...ATHLETE, [HONEYPOT_FIELD]: "filled by a bot" }));
    expect(r).toMatchObject({ error: expect.stringMatching(/spam check/i) });
    expect(r?.fieldErrors).toBeUndefined();
    expect(service.writes()).toEqual([]);
    expect(service.rpcCalls).toEqual([]);
  });

  it("writes person, lead, booking and audit through ONE transactional RPC for the studio owner (never the form), then notifies and queues the assessment, then redirects to the reference", async () => {
    const url = await expectRedirect(submitPublicBooking(null, fd(ATHLETE)));
    expect(url).toBe("/book/done?ref=BB-7K3PQ2");

    expect(service.rpcCalls).toHaveLength(1);
    const [{ fn, args }] = service.rpcCalls;
    expect(fn).toBe("photo_submit_public_booking");
    expect(args.p_owner_id).toBe(OWNER);
    expect(args.p_idempotency_key).toBe(KEY);
    expect(args.p_person).toEqual({ full_name: "Hamad", email: "hamad@example.com", phone: "+974 5555 1234", instagram: null, kind: "person", source: "website" });
    expect(args.p_organization).toBeNull();
    expect(args.p_lead).toMatchObject({ event_id: EVENT_ID, booking_type: "tournament_athlete", status: "new", source: "website", details: { service_id: SERVICE_ID, service_name: "Tournament photo", service_key: "tournament_athlete", media_scope: "photo" } });
    const booking = rpcBooking();
    expect(booking).toMatchObject({
      service_id: SERVICE_ID,
      event_id: EVENT_ID,
      booking_type: "tournament_athlete",
      athlete_name: "Hamad",
      customer_email: "hamad@example.com",
      customer_phone: "+974 5555 1234",
      package_name: "Tournament photo",
      amount_qr: 350,
      currency: "QAR",
      payment_mode: "link_later",
      booking_status: "awaiting_contract",
      client_type: "individual",
      usage_type: "personal",
      subject_is_minor: false,
      guardian: null,
      requires_contract: true,
      requires_guardian_release: false,
      contract_state: "required",
      deposit_percent: 50,
      deposit_qr: 175,
      balance_qr: 175,
      deposit_state: "pending",
    });
    expect(booking.legal_acceptance).toMatchObject({ terms_version: TERMS_VERSION, privacy_version: PRIVACY_VERSION, accepted_at: expect.any(String), ip: forwardedFor, user_agent: "Mozilla/5.0 (test)", consents: { terms: true, privacy: true, media: true, guardian: false } });
    expect(booking.details).toMatchObject({ service_kind: "tournament_athlete_photo", service_key: "tournament_athlete", media_scope: "photo", coverage: "photo", consent_accepted_at: expect.any(String) });
    // Never from the browser: owner, ids, references and payment state are the transaction's business.
    expect(booking).not.toHaveProperty("owner_id");
    expect(booking).not.toHaveProperty("public_ref");
    expect(booking).not.toHaveProperty("idempotency_key");
    expect(booking).not.toHaveProperty("status");
    expect(booking).not.toHaveProperty("payment_url");
    expect(booking.booking_status).not.toBe("confirmed");
    const audit = args.p_audit as Row[];
    expect(audit.map((a) => a.action)).toEqual(["booking.created", "legal.accepted"]);
    expect(audit[0].data).toMatchObject({ source: "website", service_key: "tournament_athlete", service_kind: "tournament_athlete_photo", payment_mode: "link_later", price_mode: "from", amount_qr: 350, deposit_qr: 175, balance_qr: 175 });
    expect(audit[1].data).toMatchObject({ terms_version: TERMS_VERSION, privacy_version: PRIVACY_VERSION, ip: forwardedFor, user_agent: "Mozilla/5.0 (test)" });

    // Nothing is written row by row any more.
    for (const t of ["photo_people", "photo_organizations", "photo_leads", "photo_bookings", "photo_audit_log", "photo_booking_payment_requests", "photo_documents", "photo_athletes"]) expect(service.inserts(t)).toEqual([]);

    // Notifications and the pricing assessment come strictly after the transaction.
    const notices = service.upserts("photo_notification_deliveries");
    const telegram = notices.find((n) => n.channel === "telegram");
    const email = notices.find((n) => n.channel === "email");
    expect(telegram).toMatchObject({ owner_id: OWNER, alert_key: `booking:${BOOKING_ID}:new`, kind: "BOOKING_NEW" });
    expect(JSON.stringify(telegram)).toContain(`https://studio.test/bookings/${BOOKING_ID}`);
    expect(JSON.stringify(telegram)).toContain("from 350 QAR");
    expect(email).toMatchObject({ owner_id: OWNER, alert_key: `email:booking:${BOOKING_ID}:received`, kind: "BOOKING_RECEIVED" });
    expect((email!.payload as Row).to).toBe("hamad@example.com");
    const text = (email!.payload as Row).text as string;
    expect(text).toContain("We confirm the date and the price with you by e-mail. Then you sign the agreement and pay the 50% deposit online to secure the date.");
    expect(text).not.toMatch(/within 24 hours/i);
    expect(text).toContain("BB-7K3PQ2");
    expect(text.toLowerCase()).not.toMatch(/fatoorah|pic-?time|no payment is needed|after the shoot you pay|payment link follows|whatsapp/);
    expect(service.firstWriteSeq("photo_notification_deliveries")).toBeGreaterThan(service.rpcCalls[0].seq);
    expect(enqueuePricingAssessment).toHaveBeenCalledTimes(1);
    expect(enqueuePricingAssessment.mock.calls[0][1]).toEqual({ ownerId: OWNER, bookingId: BOOKING_ID, leadId: LEAD_ID, reason: "public_submission" });
    const assessment = await enqueuePricingAssessment.mock.results[0].value;
    expect(assessment.seq).toBeGreaterThan(service.rpcCalls[0].seq);
  });

  it("normalises the Instagram handle before it reaches the transaction", async () => {
    await expectRedirect(submitPublicBooking(null, fd({ ...ATHLETE, instagram: "https://instagram.com/Hamad.BJJ/" })));
    expect((service.rpcCalls[0].args.p_person as Row).instagram).toBe("hamad.bjj");
    expect((service.rpcCalls[0].args.p_booking as Row).details).toMatchObject({ instagram: "hamad.bjj" });
  });

  it("issue #10 regression: a quote-mode package with a price on the row books as a quote (amount 0, inquiry, no deposit)", async () => {
    await expectRedirect(submitPublicBooking(null, fd({ ...ATHLETE, service_id: QUOTE_SERVICE })));
    const booking = rpcBooking();
    expect(booking).toMatchObject({ service_id: QUOTE_SERVICE, package_name: "Tournament quoted", amount_qr: 0, payment_mode: "quote", booking_status: "inquiry", deposit_qr: 0, balance_qr: 0, deposit_state: "not_required" });
    expect((service.rpcCalls[0].args.p_audit as Row[])[0].data).toMatchObject({ price_mode: "quote", amount_qr: 0, payment_mode: "quote" });
    const email = service.upserts("photo_notification_deliveries").find((n) => n.channel === "email");
    const quoteText = (email!.payload as Row).text as string;
    expect(quoteText).toContain("quoted individually");
    expect(quoteText.indexOf("price first")).toBeLessThan(quoteText.indexOf("50% deposit"));
    expect(quoteText).toContain("Once you approve the price");
    expect(JSON.stringify(service.upserts("photo_notification_deliveries"))).not.toContain("350");
  });

  it("'from' and 'fixed' packages book at their price with the server-side deposit split, whatever the form says", async () => {
    await expectRedirect(submitPublicBooking(null, fd({ ...ATHLETE, service_id: BIG_SERVICE, amount_qr: "1", deposit_qr: "1", balance_qr: "999" })));
    expect(rpcBooking()).toMatchObject({ amount_qr: 1000, payment_mode: "link_later", deposit_percent: 50, deposit_qr: 500, balance_qr: 500, deposit_state: "pending", booking_status: "awaiting_contract" });
    service = new FakeService();
    await expectRedirect(submitPublicBooking(null, fd({ ...ATHLETE, service_id: FIXED_SERVICE, idempotency_key: "55555555-5555-4555-8555-555555555556" })));
    expect(rpcBooking()).toMatchObject({ amount_qr: 600, payment_mode: "link_later", deposit_qr: 300, balance_qr: 300, booking_status: "awaiting_contract" });
  });

  it("a quote-first catalog service (clubs) stays a quote even with a priced package: organisation and club contact go to the transaction", async () => {
    await expectRedirect(submitPublicBooking(null, fd({ ...CLUB, service_id: CLUB_SERVICE })));
    const { args } = service.rpcCalls[0];
    expect(args.p_person).toMatchObject({ kind: "club_contact", email: "ali@example.com" });
    expect(args.p_organization).toEqual({ name: "Team Nogueira", kind: "club", email: "ali@example.com", phone: "+974 5555 9999", instagram: null });
    expect(args.p_lead).toMatchObject({ booking_type: "club", event_id: null });
    expect(rpcBooking()).toMatchObject({ booking_type: "club", service_id: CLUB_SERVICE, package_name: "Club day", amount_qr: 0, payment_mode: "quote", booking_status: "inquiry", deposit_state: "not_required", academy: "Team Nogueira", contract_state: "required", requires_contract: true });
    expect(rpcBooking().details).toMatchObject({ service_kind: "club_team_coverage", service_key: "team_tournament", media_scope: "video", video_deliverables: ["reels"], wants_videographer: true, wants_photographer: false, athlete_count: 12 });
    const telegram = service.upserts("photo_notification_deliveries").find((n) => n.channel === "telegram");
    expect(JSON.stringify(telegram)).toContain("Team Nogueira, contact Coach Ali");
    expect(JSON.stringify(telegram)).toContain("Club day (quote)");
    expect(JSON.stringify(telegram)).not.toContain("1200");
  });

  it("stores guardian details, flags the guardian release and audits guardian consent for a minor", async () => {
    await expectRedirect(submitPublicBooking(null, fd({ ...ATHLETE, client_type: "parent_guardian", athlete_name: "Noor", subject_is_minor: "yes", guardian_name: "Noora", guardian_email: "Noora@Example.com", guardian_phone: "+974 5555 0000", guardian_consent: "1" })));
    const { args } = service.rpcCalls[0];
    expect(args.p_person).toMatchObject({ kind: "parent" });
    expect(rpcBooking()).toMatchObject({ athlete_name: "Noor", subject_is_minor: true, requires_guardian_release: true, guardian: { name: "Noora", email: "noora@example.com", phone: "+974 5555 0000", consent_at: expect.any(String) } });
    expect((rpcBooking().legal_acceptance as Row).consents).toMatchObject({ guardian: true });
    const audit = args.p_audit as Row[];
    expect(audit.map((a) => a.action)).toEqual(["booking.created", "legal.accepted", "guardian.consent"]);
    expect(audit[2].data).toMatchObject({ guardian_name: "Noora", consent_at: expect.any(String) });
    expect(JSON.stringify(audit[2].data)).not.toContain("noora@example.com");
  });

  it("a replayed idempotency key redirects to the existing reference and re-enqueues the same alert keys (idempotent repair of a half-finished first attempt)", async () => {
    service.rpcResult = { data: { booking_id: BOOKING_ID, lead_id: LEAD_ID, person_id: PERSON_ID, public_ref: "BB-RACE22", replay: true }, error: null };
    const url = await expectRedirect(submitPublicBooking(null, fd(ATHLETE)));
    expect(url).toBe("/book/done?ref=BB-RACE22");
    expect(service.rpcCalls).toHaveLength(1);
    const notices = service.upserts("photo_notification_deliveries");
    expect(notices.map((n) => n.alert_key).sort()).toEqual([`booking:${BOOKING_ID}:new`, `email:booking:${BOOKING_ID}:received`]);
    expect(JSON.stringify(notices)).toContain("BB-RACE22");
    expect(enqueuePricingAssessment).toHaveBeenCalledTimes(1);
    expect(enqueuePricingAssessment.mock.calls[0][1]).toMatchObject({ bookingId: BOOKING_ID, leadId: LEAD_ID });
  });

  it("a failed transaction returns a generic error and never notifies, assesses or redirects", async () => {
    service.rpcResult = { data: null, error: { code: "XX000", message: "connection reset" } };
    const r = await submitPublicBooking(null, fd(ATHLETE));
    expect(r).toMatchObject({ error: expect.stringMatching(/went wrong/i) });
    expect(JSON.stringify(r)).not.toContain("connection reset");
    expect(service.rpcCalls).toHaveLength(1);
    expect(service.writes()).toEqual([]);
    expect(enqueuePricingAssessment).not.toHaveBeenCalled();
  });

  it("a malformed transaction result is treated as a failure", async () => {
    service.rpcResult = { data: { booking_id: "not-a-uuid" }, error: null };
    expect(await submitPublicBooking(null, fd(ATHLETE))).toMatchObject({ error: expect.stringMatching(/went wrong/i) });
    expect(service.writes()).toEqual([]);
  });

  it("a notification or assessment failure never changes the outcome once the booking exists", async () => {
    service.failTable = "photo_notification_deliveries";
    enqueuePricingAssessment.mockImplementation(async () => {
      throw new Error("assessment exploded");
    });
    const url = await expectRedirect(submitPublicBooking(null, fd(ATHLETE)));
    expect(url).toBe("/book/done?ref=BB-7K3PQ2");
    expect(service.rpcCalls).toHaveLength(1);
    expect(enqueuePricingAssessment).toHaveBeenCalledTimes(1);
  });
});

describe("submitContact", () => {
  it("creates a lead with the message and pings the owner", async () => {
    const url = await expectRedirect(submitContact(null, fd({ full_name: "Ali", email: "ali@example.com", message: "Do you cover Dubai?", consent: "1" })));
    expect(url).toBe("/contact?sent=1");
    expect(service.inserts("photo_people")[0]).toMatchObject({ owner_id: OWNER, source: "website" });
    expect(service.inserts("photo_leads")[0]).toMatchObject({ owner_id: OWNER, person_id: "person-1", status: "new", source: "website", message: "Do you cover Dubai?" });
    expect(service.upserts("photo_notification_deliveries")[0]).toMatchObject({ alert_key: "lead:lead-1:new", kind: "LEAD_NEW" });
    expect(service.inserts("photo_bookings")).toEqual([]);
    expect(service.rpcCalls).toEqual([]);
  });

  it("returns field errors, a clear honeypot error, and respects the studio gate", async () => {
    expect(await submitContact(null, fd({ full_name: "", email: "x", message: "", consent: "" }))).toMatchObject({ fieldErrors: expect.any(Object) });
    expect(await submitContact(null, fd({ full_name: "Ali", email: "ali@example.com", message: "hi", consent: "1", [HONEYPOT_FIELD]: "bot" }))).toMatchObject({ error: expect.stringMatching(/spam check/i) });
    expect(service.writes()).toEqual([]);
    loadPublicStudio.mockResolvedValue(null);
    expect(await submitContact(null, fd({ full_name: "Ali", email: "ali@example.com", message: "hi", consent: "1" }))).toMatchObject({ error: expect.stringMatching(/not open/i) });
  });
});
