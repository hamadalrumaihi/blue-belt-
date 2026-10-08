import { describe, expect, it } from "vitest";
import {
  CLIENT_TYPES,
  HONEYPOT_ERROR,
  HONEYPOT_FIELD,
  LEGAL_FIELDS,
  SERVICE_KINDS,
  composeDivision,
  defaultServiceKind,
  isPublicRef,
  parseContactForm,
  parsePublicBookingForm,
  publicBookingFieldNames,
  publicBookingFields,
  stepIndexForField,
  summarizePublicBooking,
  type PublicEventOption,
  type PublicServiceOption,
} from "@/lib/bookings/public-form";
import { BOOKING_TYPES } from "@/lib/bookings/state";

const EVENT_ID = "11111111-1111-4111-8111-111111111111";
const SERVICE_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_SERVICE = "33333333-3333-4333-8333-333333333333";
const KEY = "55555555-5555-4555-8555-555555555555";
const events: PublicEventOption[] = [{ id: EVENT_ID, name: "AJP Qatar National", event_date: "2026-11-20" }];
const services: PublicServiceOption[] = [
  { id: SERVICE_ID, name: "Tournament photo", booking_type: "tournament_athlete", price_qr: 350, currency: "QAR" },
  { id: OTHER_SERVICE, name: "Training 60", booking_type: "training_session", price_qr: null, currency: "QAR" },
];
const ctx = { events, services, today: "2026-10-06" };

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

const LEGAL = { accept_terms: "1", accept_privacy: "1", consent_media: "1" };
const CONTACT = { full_name: "Hamad Al-Rumaihi", phone: "+974 5555 1234", email: "Hamad@Example.com", instagram: "@Hamad.BJJ", client_type: "individual", usage_type: "personal", subject_is_minor: "no", idempotency_key: KEY, ...LEGAL };
const CUSTOM = { ...CONTACT, service_kind: "custom", request: "Seminar day" };

describe("service kinds", () => {
  it("offers the eight choices, each mapped onto an existing booking type", () => {
    expect(SERVICE_KINDS.map((k) => k.value)).toEqual(["tournament_athlete_photo", "tournament_athlete_photo_video", "event_coverage", "club_team_coverage", "training_coverage", "athlete_portrait", "private_session", "custom"]);
    for (const k of SERVICE_KINDS) expect(BOOKING_TYPES).toContain(k.booking_type);
    for (const t of BOOKING_TYPES) expect(SERVICE_KINDS.find((k) => k.value === defaultServiceKind(t))?.booking_type).toBe(t);
  });
});

describe("publicBookingFields", () => {
  it("defines details, contact and legal steps for every booking type with unique field names", () => {
    for (const t of BOOKING_TYPES) {
      const steps = publicBookingFields(t);
      expect(steps.map((s) => s.key)).toEqual(["details", "contact", "legal"]);
      const names = publicBookingFieldNames(t);
      expect(new Set(names).size).toBe(names.length);
      for (const n of ["full_name", "email", "phone", "client_type", "usage_type", "accept_terms", "accept_privacy", "consent_media"]) expect(names).toContain(n);
      if (t === "club") expect(names).not.toContain("subject_is_minor");
      else expect(names).toEqual(expect.arrayContaining(["subject_is_minor", "guardian_name", "guardian_email", "guardian_phone", "guardian_consent"]));
    }
  });

  it("pre-selects nothing: every consent box is a plain required checkbox", () => {
    for (const f of LEGAL_FIELDS) expect(f).toMatchObject({ kind: "consent", required: true });
    expect(new Set(LEGAL_FIELDS.map((f) => f.name)).size).toBe(3);
    expect(CLIENT_TYPES).toHaveLength(5);
  });

  it("maps field names to wizard steps for server-error jumps", () => {
    expect(stepIndexForField("tournament_athlete", "event_id")).toBe(1);
    expect(stepIndexForField("tournament_athlete", "guardian_email")).toBe(2);
    expect(stepIndexForField("tournament_athlete", "accept_terms")).toBe(3);
    expect(stepIndexForField("club", "wants_videographer")).toBe(1);
    expect(stepIndexForField("club", "nope")).toBeNull();
  });
});

describe("parsePublicBookingForm", () => {
  it("rejects the honeypot before anything else with a clear message", () => {
    const r = parsePublicBookingForm(fd({ ...CUSTOM, [HONEYPOT_FIELD]: "http://spam" }), ctx);
    expect(r.values).toBeNull();
    expect(r.fieldErrors).toEqual({ [HONEYPOT_FIELD]: HONEYPOT_ERROR });
    expect(HONEYPOT_ERROR).toMatch(/reload/i);
    expect(HONEYPOT_FIELD).not.toMatch(/website|url|name|email|phone|address/i);
  });

  it("rejects an unknown service kind, and a booking type that disagrees with it", () => {
    expect(parsePublicBookingForm(fd({ ...CONTACT, service_kind: "wedding" }), ctx).fieldErrors.service_kind).toBeTruthy();
    expect(parsePublicBookingForm(fd({ ...CUSTOM, booking_type: "club" }), ctx).fieldErrors.booking_type).toBeTruthy();
    expect(parsePublicBookingForm(fd({ ...CUSTOM, booking_type: "custom" }), ctx).fieldErrors).toEqual({});
  });

  it("requires each legal box separately: terms, privacy, media", () => {
    const r = parsePublicBookingForm(fd({ ...CUSTOM, accept_terms: "", accept_privacy: "", consent_media: "" }), ctx);
    expect(r.values).toBeNull();
    expect(r.fieldErrors.accept_terms).toMatch(/tick/i);
    expect(r.fieldErrors.accept_privacy).toMatch(/tick/i);
    expect(r.fieldErrors.consent_media).toMatch(/tick/i);
    expect(parsePublicBookingForm(fd({ ...CUSTOM, accept_terms: "" }), ctx).fieldErrors).toEqual({ accept_terms: expect.any(String) });
    expect(parsePublicBookingForm(fd({ ...CUSTOM, accept_privacy: "" }), ctx).fieldErrors).toEqual({ accept_privacy: expect.any(String) });
  });

  it("requires the idempotency key to be a UUID", () => {
    expect(parsePublicBookingForm(fd({ ...CUSTOM, idempotency_key: "" }), ctx).fieldErrors.idempotency_key).toMatch(/reload/i);
    expect(parsePublicBookingForm(fd({ ...CUSTOM, idempotency_key: "not-a-uuid" }), ctx).fieldErrors.idempotency_key).toMatch(/reload/i);
    expect(parsePublicBookingForm(fd(CUSTOM), ctx).values?.idempotency_key).toBe(KEY);
  });

  it("requires client type, usage and the under-18 answer", () => {
    const r = parsePublicBookingForm(fd({ ...CUSTOM, client_type: "", usage_type: "sponsor", subject_is_minor: "" }), ctx);
    expect(r.fieldErrors).toMatchObject({ client_type: "Required.", usage_type: expect.stringMatching(/pick/i), subject_is_minor: "Required." });
  });

  it("minor: guardian name, e-mail, phone and consent become mandatory and are kept", () => {
    const r = parsePublicBookingForm(fd({ ...CUSTOM, client_type: "parent_guardian", subject_is_minor: "yes" }), ctx);
    expect(r.values).toBeNull();
    expect(r.fieldErrors).toMatchObject({ guardian_name: "Required.", guardian_email: "Required.", guardian_phone: "Required.", guardian_consent: expect.stringMatching(/tick/i) });
    const bad = parsePublicBookingForm(fd({ ...CUSTOM, client_type: "parent_guardian", subject_is_minor: "yes", guardian_name: "Noora", guardian_email: "nope", guardian_phone: "12", guardian_consent: "1" }), ctx);
    expect(bad.fieldErrors).toEqual({ guardian_email: expect.stringMatching(/e-mail/i), guardian_phone: expect.stringMatching(/8 digits/) });
    const ok = parsePublicBookingForm(fd({ ...CUSTOM, client_type: "parent_guardian", subject_is_minor: "yes", guardian_name: "Noora Al-Rumaihi", guardian_email: "Noora@Example.com", guardian_phone: "+974 5555 0000", guardian_consent: "1" }), ctx);
    expect(ok.fieldErrors).toEqual({});
    expect(ok.values).toMatchObject({ subject_is_minor: true, guardian: { name: "Noora Al-Rumaihi", email: "noora@example.com", phone: "+974 5555 0000" }, consents: { terms: true, privacy: true, media: true, guardian: true } });
  });

  it("not a minor: guardian fields are ignored even when sent", () => {
    const r = parsePublicBookingForm(fd({ ...CUSTOM, subject_is_minor: "no", guardian_name: "x", guardian_email: "bad" }), ctx);
    expect(r.fieldErrors).toEqual({});
    expect(r.values).toMatchObject({ subject_is_minor: false, guardian: null, consents: { guardian: false } });
  });

  it("validates e-mail and phone", () => {
    const r = parsePublicBookingForm(fd({ ...CUSTOM, email: "nope", phone: "12" }), ctx);
    expect(r.fieldErrors.email).toMatch(/e-mail/i);
    expect(r.fieldErrors.phone).toMatch(/8 digits/);
  });

  it("caps lengths", () => {
    const r = parsePublicBookingForm(fd({ ...CUSTOM, full_name: "x".repeat(121), request: "y".repeat(3001) }), ctx);
    expect(r.fieldErrors.full_name).toMatch(/under 120/);
    expect(r.fieldErrors.request).toMatch(/under 3000/);
  });

  it("tournament athlete: happy path for self, instagram normalised, division and venue kept, service kind recorded", () => {
    const r = parsePublicBookingForm(
      fd({ ...CONTACT, service_kind: "tournament_athlete_photo_video", event_id: EVENT_ID, age_division: "Adult", belt: "blue", weight_division: "-77 kg", gi: "both", service_id: SERVICE_ID, coverage: "both", source_url: "https://ajptour.com/en/athlete/1", notes: "Mat 3 usually", academy: "Gracie Barra Doha", location: "Lusail Sports Arena" }),
      ctx,
    );
    expect(r.fieldErrors).toEqual({});
    const v = r.values!;
    expect(v.booking_type).toBe("tournament_athlete");
    expect(v.service_kind).toBe("tournament_athlete_photo_video");
    expect(v.athlete_name).toBe("Hamad Al-Rumaihi");
    expect(v.email).toBe("hamad@example.com");
    expect(v.instagram).toBe("hamad.bjj");
    expect(v.event_id).toBe(EVENT_ID);
    expect(v.event_name).toBe("AJP Qatar National");
    expect(v.service_id).toBe(SERVICE_ID);
    expect(v.location).toBe("Lusail Sports Arena");
    expect(v.details).toMatchObject({ service_kind: "tournament_athlete_photo_video", booked_for: "self", belt: "blue", gi: "both", coverage: "both", source_url: "https://ajptour.com/en/athlete/1", academy: "Gracie Barra Doha", event_name: "AJP Qatar National", notes: "Mat 3 usually", location: "Lusail Sports Arena" });
    expect(composeDivision(v.age_division, v.weight_division)).toBe("Adult / -77 kg");
    const summary = summarizePublicBooking(v, services);
    expect(summary.find(([k]) => k === "Package")?.[1]).toBe("Tournament photo");
    expect(summary.find(([k]) => k === "Service")?.[1]).toBe("Photography and video");
    expect(summary.find(([k]) => k === "Booked by")?.[1]).toBe("Myself");
  });

  it("tournament athlete: a parent needs the athlete's name; free-text event is allowed", () => {
    const base = { ...CONTACT, service_kind: "tournament_athlete_photo", client_type: "parent_guardian", event_id: "other", event_name: "Doha Open", coverage: "photo" };
    expect(parsePublicBookingForm(fd(base), ctx).fieldErrors.athlete_name).toMatch(/athlete/i);
    const ok = parsePublicBookingForm(fd({ ...base, athlete_name: "Noor Al-Rumaihi" }), ctx);
    expect(ok.fieldErrors).toEqual({});
    expect(ok.values!.athlete_name).toBe("Noor Al-Rumaihi");
    expect(ok.values!.event_id).toBeNull();
    expect(ok.values!.event_name).toBe("Doha Open");
    expect(ok.values!.details.booked_for).toBe("child");
    expect(parsePublicBookingForm(fd({ ...base, client_type: "club_team", athlete_name: "Sara" }), ctx).values!.details.booked_for).toBe("athlete");
  });

  it("rejects an event id that was not offered, a service of another type, a bad URL and a past date", () => {
    const r = parsePublicBookingForm(fd({ ...CONTACT, service_kind: "tournament_athlete_photo", event_id: "44444444-4444-4444-8444-444444444444", service_id: OTHER_SERVICE, coverage: "photo", source_url: "ftp://x", competition_date: "2026-01-01" }), ctx);
    expect(r.fieldErrors.event_id).toMatch(/no longer listed/);
    expect(r.fieldErrors.service_id).toMatch(/not available/);
    expect(r.fieldErrors.source_url).toMatch(/https/);
    expect(r.fieldErrors.competition_date).toMatch(/passed/);
  });

  it("club: happy path creates a quote-style request with athlete count and wants; no minor question", () => {
    const r = parsePublicBookingForm(fd({ ...CONTACT, service_kind: "club_team_coverage", client_type: "club_team", usage_type: "club_team", subject_is_minor: "", club_name: "Team Nogueira Qatar", event_name: "Doha Open", athlete_count: "14", wants_photographer: "1", notes: "Two mats" }), ctx);
    expect(r.fieldErrors).toEqual({});
    const v = r.values!;
    expect(v.booking_type).toBe("club");
    expect(v.club_name).toBe("Team Nogueira Qatar");
    expect(v.athlete_name).toBe(v.full_name);
    expect(v.subject_is_minor).toBe(false);
    expect(v.details).toMatchObject({ service_kind: "club_team_coverage", booked_for: "club", club_name: "Team Nogueira Qatar", athlete_count: 14, wants_photographer: true, wants_videographer: false, event_name: "Doha Open" });
  });

  it("club: needs a club name, a sane athlete count and at least one of photo/video", () => {
    const r = parsePublicBookingForm(fd({ ...CONTACT, service_kind: "club_team_coverage", event_name: "Doha Open", athlete_count: "0" }), ctx);
    expect(r.fieldErrors.club_name).toBe("Required.");
    expect(r.fieldErrors.athlete_count).toMatch(/between 1 and 500/);
    expect(r.fieldErrors.wants).toMatch(/at least one/);
  });

  it("training session: date required, time validated, service optional", () => {
    const bad = parsePublicBookingForm(fd({ ...CONTACT, service_kind: "training_coverage", requested_time: "25:00" }), ctx);
    expect(bad.fieldErrors.requested_date).toBe("Required.");
    expect(bad.fieldErrors.requested_time).toMatch(/24-hour/);
    const ok = parsePublicBookingForm(fd({ ...CONTACT, service_kind: "training_coverage", requested_date: "2026-10-20", requested_time: "18:30", location_preference: "Our academy in Al Sadd", service_id: OTHER_SERVICE, event_name: "Comp prep", academy: "Al Sadd BJJ" }), ctx);
    expect(ok.fieldErrors).toEqual({});
    expect(ok.values!.booking_type).toBe("training_session");
    expect(ok.values!.details).toMatchObject({ requested_date: "2026-10-20", requested_time: "18:30", location_preference: "Our academy in Al Sadd", event_name: "Comp prep", academy: "Al Sadd BJJ" });
    expect(ok.values!.service_id).toBe(OTHER_SERVICE);
    expect(ok.values!.location).toBe("Our academy in Al Sadd");
  });

  it("portrait and private sessions: optional athlete name is kept", () => {
    for (const kind of ["athlete_portrait", "private_session"]) {
      const ok = parsePublicBookingForm(fd({ ...CONTACT, service_kind: kind, requested_date: "2026-10-20", athlete_name: "Sara" }), ctx);
      expect(ok.fieldErrors).toEqual({});
      expect(ok.values!.booking_type).toBe("private_session");
      expect(ok.values!.athlete_name).toBe("Sara");
      expect(ok.values!.service_kind).toBe(kind);
    }
  });

  it("custom and event coverage: free text is required and becomes the notes", () => {
    expect(parsePublicBookingForm(fd({ ...CONTACT, service_kind: "custom" }), ctx).fieldErrors.request).toBe("Required.");
    const ok = parsePublicBookingForm(fd({ ...CONTACT, service_kind: "event_coverage", client_type: "event_organiser", usage_type: "commercial", request: "Black belt promotion ceremony, 40 people" }), ctx);
    expect(ok.fieldErrors).toEqual({});
    expect(ok.values!.booking_type).toBe("custom");
    expect(ok.values!.notes).toBe("Black belt promotion ceremony, 40 people");
    expect(ok.values!.details.request).toBe("Black belt promotion ceremony, 40 people");
    expect(ok.values!.usage_type).toBe("commercial");
  });
});

describe("parseContactForm", () => {
  it("accepts a plain message and lower-cases the e-mail", () => {
    const r = parseContactForm(fd({ full_name: "Ali", email: "ALI@example.com", message: "Do you cover Dubai?", consent: "1" }));
    expect(r.fieldErrors).toEqual({});
    expect(r.values).toEqual({ full_name: "Ali", email: "ali@example.com", phone: null, message: "Do you cover Dubai?" });
  });
  it("rejects honeypot, missing consent, bad email, bad phone, long message", () => {
    expect(parseContactForm(fd({ full_name: "Ali", email: "a@b.co", message: "x", consent: "1", [HONEYPOT_FIELD]: "spam" })).fieldErrors[HONEYPOT_FIELD]).toBe(HONEYPOT_ERROR);
    const r = parseContactForm(fd({ full_name: "", email: "nope", phone: "1", message: "m".repeat(3001) }));
    expect(r.fieldErrors).toMatchObject({ full_name: "Required.", email: expect.stringMatching(/e-mail/i), phone: expect.stringMatching(/digits/), message: expect.stringMatching(/under 3000/), consent: expect.any(String) });
  });
});

describe("isPublicRef", () => {
  it("accepts the BB-XXXXXX alphabet only", () => {
    expect(isPublicRef("BB-7K3PQ2")).toBe(true);
    expect(isPublicRef("BB-7K3PQ0")).toBe(false);
    expect(isPublicRef("bb-7K3PQ2")).toBe(false);
    expect(isPublicRef("BB-7K3PQ2X")).toBe(false);
    expect(isPublicRef(null)).toBe(false);
  });
});
