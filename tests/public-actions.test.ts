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

import { submitContact, submitPublicBooking } from "@/lib/actions/public";
import { HONEYPOT_FIELD } from "@/lib/bookings/public-form";
import { PRIVACY_VERSION, TERMS_VERSION } from "@/lib/legal/versions";
import { RULES, rateLimit, resetRateLimits } from "@/lib/rate-limit";

const OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EVENT_ID = "11111111-1111-4111-8111-111111111111";
const SERVICE_ID = "22222222-2222-4222-8222-222222222222";
const BIG_SERVICE = "66666666-6666-4666-8666-666666666666";
const KEY = "55555555-5555-4555-8555-555555555555";

type Row = Record<string, unknown>;
type Call = { table: string; op: string; payload: Row | Row[] | null; filters: Array<[string, unknown]> };

/**
 * Chain recorder: every builder method returns the chain, awaiting it asks
 * the table handler for a result. Enough to assert what the action wrote
 * and to script duplicate-key errors, an existing idempotent booking and a
 * failing insert.
 */
class FakeService {
  calls: Call[] = [];
  bookingInsertFailures = 0;
  bookingInsertError: { code: string; message: string } | null = null;
  /** Bookings already in the table, keyed by idempotency key. */
  existing = new Map<string, { public_ref: string }>();
  /** When true, the next insert with an idempotency key "lands" so a later lookup finds it (simulates a concurrent winner). */
  raceOnIdempotency = false;
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
      this.calls.push(call);
      return Promise.resolve(this.exec(call, mode)).then(resolve, reject);
    };
    return chain;
  }
  private exec(call: Call, mode: string) {
    const one = (row: Row) => ({ data: mode === "many" ? [row] : row, error: null });
    if (call.table === "photo_people") {
      if (call.op === "insert") return one({ id: "person-1", ...(call.payload as Row) });
      return { data: mode === "many" ? [] : null, error: null };
    }
    if (call.table === "photo_organizations") {
      if (call.op === "insert") return one({ id: "org-1", ...(call.payload as Row) });
      return { data: null, error: null };
    }
    if (call.table === "photo_leads") {
      if (call.op === "insert") return one({ id: "lead-1" });
      return { data: null, error: null };
    }
    if (call.table === "photo_bookings") {
      if (call.op === "insert") {
        const key = (call.payload as Row).idempotency_key as string;
        if (this.bookingInsertError) return { data: null, error: this.bookingInsertError };
        if (this.bookingInsertFailures > 0) {
          this.bookingInsertFailures -= 1;
          if (this.raceOnIdempotency) this.existing.set(key, { public_ref: "BB-RACE22" });
          return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
        }
        this.existing.set(key, { public_ref: (call.payload as Row).public_ref as string });
        return one({ id: "booking-1" });
      }
      if (call.op === "select") {
        const key = call.filters.find(([c]) => c === "idempotency_key")?.[1] as string | undefined;
        const hit = key ? this.existing.get(key) : undefined;
        return { data: hit ? (mode === "many" ? [hit] : hit) : mode === "many" ? [] : null, error: null };
      }
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
}

const serviceRow = (id: string, name: string, price: number) => ({ id, owner_id: OWNER, code: name.slice(0, 2), name, booking_type: "tournament_athlete", description: null, price_qr: price, deposit_qr: null, currency: "QAR", duration_minutes: null, includes_photo: true, includes_video: false, active: true, public: true, sort_order: 0, created_at: "", updated_at: "" });
const studio = {
  studio: { owner_id: OWNER, business_name: "Blue Belt Media", tagline: null, about: null, city: "Doha", email: null, phone: null, whatsapp: null, instagram: null, public_booking: true, settings: {}, created_at: "", updated_at: "" },
  services: [serviceRow(SERVICE_ID, "Tournament photo", 350), serviceRow(BIG_SERVICE, "Tournament full day", 1000)],
};

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

const LEGAL = { accept_terms: "1", accept_privacy: "1", consent_media: "1" };
const ATHLETE = {
  service_kind: "tournament_athlete_photo",
  event_id: EVENT_ID,
  service_id: SERVICE_ID,
  coverage: "photo",
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

describe("submitPublicBooking", () => {
  it("is rate limited per client IP before touching the studio", async () => {
    for (let i = 0; i < RULES.publicFormPerIp.max; i += 1) rateLimit(`public-form:${forwardedFor}`, RULES.publicFormPerIp);
    const r = await submitPublicBooking(null, fd(ATHLETE));
    expect(r).toMatchObject({ error: expect.stringMatching(/too many/i) });
    expect(loadPublicStudio).not.toHaveBeenCalled();
    expect(service.calls).toEqual([]);
  });

  it("refuses when no studio has opened public booking", async () => {
    loadPublicStudio.mockResolvedValue(null);
    expect(await submitPublicBooking(null, fd(ATHLETE))).toEqual({ error: "Booking is not open yet." });
    expect(service.calls).toEqual([]);
  });

  it("returns field errors without writing anything", async () => {
    const r = await submitPublicBooking(null, fd({ ...ATHLETE, email: "nope", accept_terms: "" }));
    expect(r).toMatchObject({ fieldErrors: { email: expect.any(String), accept_terms: expect.any(String) } });
    expect(service.writes()).toEqual([]);
  });

  it("terms and privacy are each required on their own", async () => {
    expect(await submitPublicBooking(null, fd({ ...ATHLETE, accept_terms: "" }))).toMatchObject({ fieldErrors: { accept_terms: expect.stringMatching(/tick/i) } });
    expect(await submitPublicBooking(null, fd({ ...ATHLETE, accept_privacy: "" }))).toMatchObject({ fieldErrors: { accept_privacy: expect.stringMatching(/tick/i) } });
    expect(service.writes()).toEqual([]);
  });

  it("a minor needs guardian details and guardian consent, and nothing is written until they are given", async () => {
    const r = await submitPublicBooking(null, fd({ ...ATHLETE, client_type: "parent_guardian", athlete_name: "Noor", subject_is_minor: "yes" }));
    expect(r).toMatchObject({ fieldErrors: { guardian_name: expect.any(String), guardian_email: expect.any(String), guardian_phone: expect.any(String), guardian_consent: expect.any(String) } });
    expect(service.writes()).toEqual([]);
  });

  it("a tripped honeypot returns a clear error, not a field error, and writes nothing", async () => {
    const r = await submitPublicBooking(null, fd({ ...ATHLETE, [HONEYPOT_FIELD]: "filled by a bot" }));
    expect(r).toMatchObject({ error: expect.stringMatching(/spam check/i) });
    expect(r?.fieldErrors).toBeUndefined();
    expect(service.writes()).toEqual([]);
  });

  it("creates person, lead and booking for the studio owner (never the form) with every round-3 column, audits, queues notices and redirects to the reference", async () => {
    const url = await expectRedirect(submitPublicBooking(null, fd(ATHLETE)));
    expect(url).toMatch(/^\/book\/done\?ref=BB-[A-HJ-NP-Z2-9]{6}$/);

    const [person] = service.inserts("photo_people");
    expect(person).toMatchObject({ owner_id: OWNER, full_name: "Hamad", email: "hamad@example.com", source: "website", kind: "person" });

    const [lead] = service.inserts("photo_leads");
    expect(lead).toMatchObject({ owner_id: OWNER, person_id: "person-1", event_id: EVENT_ID, booking_type: "tournament_athlete", status: "new", source: "website" });

    const [booking] = service.inserts("photo_bookings");
    expect(booking).toMatchObject({
      owner_id: OWNER,
      client_id: "person-1",
      lead_id: "lead-1",
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
      // Round 3 columns, all computed on the server.
      client_type: "individual",
      usage_type: "personal",
      subject_is_minor: false,
      guardian: null,
      idempotency_key: KEY,
      requires_contract: true,
      requires_guardian_release: false,
      contract_state: "required",
      deposit_percent: 50,
      deposit_qr: 175,
      balance_qr: 175,
      deposit_state: "pending",
    });
    expect(booking.legal_acceptance).toMatchObject({ terms_version: TERMS_VERSION, privacy_version: PRIVACY_VERSION, accepted_at: expect.any(String), ip: forwardedFor, user_agent: "Mozilla/5.0 (test)", consents: { terms: true, privacy: true, media: true, guardian: false } });
    expect((booking.details as Row).service_kind).toBe("tournament_athlete_photo");
    expect(booking.public_ref).toMatch(/^BB-[A-HJ-NP-Z2-9]{6}$/);
    expect(url.endsWith(String(booking.public_ref))).toBe(true);
    expect((booking.details as Row).consent_accepted_at).toEqual(expect.any(String));
    // Never from the browser, never a payment: the owner reviews and confirms first.
    expect(booking.owner_id).toBe(OWNER);
    expect(booking).not.toHaveProperty("status");
    expect(booking).not.toHaveProperty("payment_url");
    expect(booking).not.toHaveProperty("provider_invoice_id");
    expect(booking.booking_status).not.toBe("awaiting_payment");
    expect(booking.booking_status).not.toBe("confirmed");
    expect(service.inserts("photo_booking_payment_requests")).toEqual([]);
    expect(service.inserts("photo_documents")).toEqual([]);

    const link = service.calls.find((c) => c.table === "photo_leads" && c.op === "update");
    expect(link?.payload).toEqual({ booking_id: "booking-1" });
    expect(link?.filters).toContainEqual(["owner_id", OWNER]);

    const audits = service.inserts("photo_audit_log");
    expect(audits.map((a) => a.action)).toEqual(["booking.created", "legal.accepted"]);
    expect(audits[0]).toMatchObject({ owner_id: OWNER, actor_kind: "public", entity: "booking", entity_id: "booking-1" });
    expect(audits[1].data).toMatchObject({ terms_version: TERMS_VERSION, privacy_version: PRIVACY_VERSION, ip: forwardedFor, user_agent: "Mozilla/5.0 (test)", consents: { terms: true, privacy: true, media: true } });

    const notices = service.upserts("photo_notification_deliveries");
    const telegram = notices.find((n) => n.channel === "telegram");
    const email = notices.find((n) => n.channel === "email");
    expect(telegram).toMatchObject({ owner_id: OWNER, alert_key: "booking:booking-1:new", kind: "BOOKING_NEW" });
    expect(JSON.stringify(telegram)).toContain("https://studio.test/bookings/booking-1");
    expect(JSON.stringify(telegram)).not.toContain("—");
    expect(email).toMatchObject({ owner_id: OWNER, alert_key: "email:booking:booking-1:received", kind: "BOOKING_RECEIVED" });
    expect((email!.payload as Row).to).toBe("hamad@example.com");
    expect(JSON.stringify(email)).toContain("https://studio.test/client");
    const text = (email!.payload as Row).text as string;
    expect(text).toContain("We confirm within 24 hours. Then you sign the agreement and pay the 50% deposit online to secure the date.");
    expect(text.toLowerCase()).not.toMatch(/fatoorah|pic-?time|no payment is needed|after the shoot you pay|payment link follows|whatsapp/);
    expect(text).not.toContain("—");

    expect(service.inserts("photo_athletes")).toEqual([]);
  });

  it("computes the deposit split on the server: QAR 1000 becomes 500 deposit and 500 balance whatever the form says", async () => {
    await expectRedirect(submitPublicBooking(null, fd({ ...ATHLETE, service_id: BIG_SERVICE, amount_qr: "1", deposit_qr: "1", balance_qr: "999" })));
    const [booking] = service.inserts("photo_bookings");
    expect(booking).toMatchObject({ amount_qr: 1000, deposit_percent: 50, deposit_qr: 500, balance_qr: 500, deposit_state: "pending", booking_status: "awaiting_contract" });
  });

  it("stores guardian details, flags the guardian release and audits guardian consent for a minor", async () => {
    await expectRedirect(submitPublicBooking(null, fd({ ...ATHLETE, client_type: "parent_guardian", athlete_name: "Noor", subject_is_minor: "yes", guardian_name: "Noora", guardian_email: "Noora@Example.com", guardian_phone: "+974 5555 0000", guardian_consent: "1" })));
    expect(service.inserts("photo_people")[0]).toMatchObject({ kind: "parent" });
    const [booking] = service.inserts("photo_bookings");
    expect(booking).toMatchObject({ athlete_name: "Noor", subject_is_minor: true, requires_guardian_release: true, guardian: { name: "Noora", email: "noora@example.com", phone: "+974 5555 0000", consent_at: expect.any(String) } });
    expect((booking.legal_acceptance as Row).consents).toMatchObject({ guardian: true });
    const audits = service.inserts("photo_audit_log");
    expect(audits.map((a) => a.action)).toEqual(["booking.created", "legal.accepted", "guardian.consent"]);
    expect(audits[2].data).toMatchObject({ guardian_name: "Noora", consent_at: expect.any(String) });
    expect(JSON.stringify(audits[2].data)).not.toContain("noora@example.com");
  });

  it("club requests stay a quote: organisation upserted, booking as inquiry with no amount and no deposit", async () => {
    await expectRedirect(submitPublicBooking(null, fd({ service_kind: "club_team_coverage", club_name: "Team Nogueira", event_name: "Doha Open", athlete_count: "12", wants_videographer: "1", full_name: "Coach Ali", phone: "+974 5555 9999", email: "ali@example.com", client_type: "club_team", usage_type: "club_team", idempotency_key: KEY, ...LEGAL })));
    expect(service.inserts("photo_people")[0]).toMatchObject({ kind: "club_contact" });
    expect(service.inserts("photo_organizations")[0]).toMatchObject({ owner_id: OWNER, name: "Team Nogueira", kind: "club", primary_contact_id: "person-1" });
    expect(service.inserts("photo_leads")[0]).toMatchObject({ organization_id: "org-1", booking_type: "club", event_id: null });
    expect(service.inserts("photo_bookings")[0]).toMatchObject({ organization_id: "org-1", booking_type: "club", payment_mode: "quote", booking_status: "inquiry", amount_qr: 0, deposit_qr: 0, balance_qr: 0, deposit_state: "not_required", package_name: "Custom", academy: "Team Nogueira", contract_state: "required", requires_contract: true });
    const telegram = service.upserts("photo_notification_deliveries").find((n) => n.channel === "telegram");
    expect(JSON.stringify(telegram)).toContain("Team Nogueira, contact Coach Ali");
    expect(service.inserts("photo_athletes")).toEqual([]);
  });

  it("a second submission with the same idempotency key creates no second booking and redirects to the first reference", async () => {
    const first = await expectRedirect(submitPublicBooking(null, fd(ATHLETE)));
    const second = await expectRedirect(submitPublicBooking(null, fd(ATHLETE)));
    expect(second).toBe(first);
    expect(service.inserts("photo_bookings")).toHaveLength(1);
    expect(service.inserts("photo_leads")).toHaveLength(1);
    expect(service.inserts("photo_audit_log").filter((a) => a.action === "booking.created")).toHaveLength(1);
  });

  it("a concurrent duplicate that wins the unique index is re-read and reused", async () => {
    service.bookingInsertFailures = 1;
    service.raceOnIdempotency = true;
    const url = await expectRedirect(submitPublicBooking(null, fd(ATHLETE)));
    expect(url).toBe("/book/done?ref=BB-RACE22");
    expect(service.inserts("photo_bookings")).toHaveLength(1);
  });

  it("retries the public reference on a duplicate key", async () => {
    service.bookingInsertFailures = 1;
    await expectRedirect(submitPublicBooking(null, fd(ATHLETE)));
    const inserts = service.inserts("photo_bookings");
    expect(inserts).toHaveLength(2);
    expect(inserts[0].public_ref).not.toBe(inserts[1].public_ref);
  });

  it("gives up after three duplicate references without exposing internals", async () => {
    service.bookingInsertFailures = 3;
    const r = await submitPublicBooking(null, fd(ATHLETE));
    expect(r).toMatchObject({ error: expect.stringMatching(/went wrong/i) });
    expect(JSON.stringify(r)).not.toMatch(/duplicate|unique/i);
  });

  it("a failed database write returns an error and never redirects or notifies", async () => {
    service.bookingInsertError = { code: "XX000", message: "connection reset" };
    const r = await submitPublicBooking(null, fd(ATHLETE));
    expect(r).toMatchObject({ error: expect.stringMatching(/went wrong/i) });
    expect(JSON.stringify(r)).not.toContain("connection reset");
    expect(service.upserts("photo_notification_deliveries")).toEqual([]);
    expect(service.inserts("photo_audit_log")).toEqual([]);
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
  });

  it("returns field errors, a clear honeypot error, and respects the studio gate", async () => {
    expect(await submitContact(null, fd({ full_name: "", email: "x", message: "", consent: "" }))).toMatchObject({ fieldErrors: expect.any(Object) });
    expect(await submitContact(null, fd({ full_name: "Ali", email: "ali@example.com", message: "hi", consent: "1", [HONEYPOT_FIELD]: "bot" }))).toMatchObject({ error: expect.stringMatching(/spam check/i) });
    expect(service.writes()).toEqual([]);
    loadPublicStudio.mockResolvedValue(null);
    expect(await submitContact(null, fd({ full_name: "Ali", email: "ali@example.com", message: "hi", consent: "1" }))).toMatchObject({ error: expect.stringMatching(/not open/i) });
  });
});
