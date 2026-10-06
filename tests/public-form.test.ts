import { describe, expect, it } from "vitest";
import { composeDivision, isPublicRef, parseContactForm, parsePublicBookingForm, publicBookingFieldNames, publicBookingFields, summarizePublicBooking, type PublicEventOption, type PublicServiceOption } from "@/lib/bookings/public-form";
import { BOOKING_TYPES } from "@/lib/bookings/state";

const EVENT_ID = "11111111-1111-4111-8111-111111111111";
const SERVICE_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_SERVICE = "33333333-3333-4333-8333-333333333333";
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

const CONTACT = { full_name: "Hamad Al-Rumaihi", phone: "+974 5555 1234", email: "Hamad@Example.com", instagram: "@Hamad.BJJ", consent: "1" };

describe("publicBookingFields", () => {
  it("defines details + contact steps for every booking type with unique field names", () => {
    for (const t of BOOKING_TYPES) {
      const steps = publicBookingFields(t);
      expect(steps.map((s) => s.key)).toEqual(["details", "contact"]);
      const names = publicBookingFieldNames(t);
      expect(new Set(names).size).toBe(names.length);
      expect(names).toContain("full_name");
      expect(names).toContain("email");
      expect(names).toContain("phone");
    }
  });
});

describe("parsePublicBookingForm", () => {
  it("rejects the honeypot before anything else", () => {
    const r = parsePublicBookingForm(fd({ ...CONTACT, booking_type: "custom", request: "x", website: "http://spam" }), ctx);
    expect(r.values).toBeNull();
    expect(r.fieldErrors).toEqual({ website: expect.stringMatching(/spam/i) });
  });

  it("rejects an unknown booking type", () => {
    const r = parsePublicBookingForm(fd({ ...CONTACT, booking_type: "wedding" }), ctx);
    expect(r.fieldErrors.booking_type).toBeTruthy();
  });

  it("requires consent", () => {
    const r = parsePublicBookingForm(fd({ ...CONTACT, consent: "", booking_type: "custom", request: "Seminar day" }), ctx);
    expect(r.values).toBeNull();
    expect(r.fieldErrors.consent).toMatch(/agree/i);
  });

  it("validates e-mail and phone", () => {
    const r = parsePublicBookingForm(fd({ ...CONTACT, email: "nope", phone: "12", booking_type: "custom", request: "Seminar day" }), ctx);
    expect(r.fieldErrors.email).toMatch(/e-mail/i);
    expect(r.fieldErrors.phone).toMatch(/8 digits/);
  });

  it("caps lengths", () => {
    const r = parsePublicBookingForm(fd({ ...CONTACT, full_name: "x".repeat(121), booking_type: "custom", request: "y".repeat(3001) }), ctx);
    expect(r.fieldErrors.full_name).toMatch(/under 120/);
    expect(r.fieldErrors.request).toMatch(/under 3000/);
  });

  it("tournament athlete: happy path for self, instagram normalised, division fields kept", () => {
    const r = parsePublicBookingForm(
      fd({ ...CONTACT, booking_type: "tournament_athlete", booked_for: "self", event_id: EVENT_ID, age_division: "Adult", belt: "blue", weight_division: "-77 kg", gi: "both", service_id: SERVICE_ID, coverage: "both", source_url: "https://ajptour.com/en/athlete/1", notes: "Mat 3 usually", academy: "Gracie Barra Doha" }),
      ctx,
    );
    expect(r.fieldErrors).toEqual({});
    const v = r.values!;
    expect(v.booking_type).toBe("tournament_athlete");
    expect(v.athlete_name).toBe("Hamad Al-Rumaihi");
    expect(v.email).toBe("hamad@example.com");
    expect(v.instagram).toBe("hamad.bjj");
    expect(v.event_id).toBe(EVENT_ID);
    expect(v.event_name).toBe("AJP Qatar National");
    expect(v.service_id).toBe(SERVICE_ID);
    expect(v.details).toMatchObject({ booked_for: "self", belt: "blue", gi: "both", coverage: "both", source_url: "https://ajptour.com/en/athlete/1", academy: "Gracie Barra Doha", event_name: "AJP Qatar National", notes: "Mat 3 usually" });
    expect(composeDivision(v.age_division, v.weight_division)).toBe("Adult / -77 kg");
    expect(summarizePublicBooking(v, services).find(([k]) => k === "Package")?.[1]).toBe("Tournament photo");
  });

  it("tournament athlete: booking for a child needs the athlete's name; free-text event is allowed", () => {
    const base = { ...CONTACT, booking_type: "tournament_athlete", booked_for: "child", event_id: "other", event_name: "Doha Open", coverage: "photo" };
    expect(parsePublicBookingForm(fd(base), ctx).fieldErrors.athlete_name).toMatch(/athlete/i);
    const ok = parsePublicBookingForm(fd({ ...base, athlete_name: "Noor Al-Rumaihi" }), ctx);
    expect(ok.fieldErrors).toEqual({});
    expect(ok.values!.athlete_name).toBe("Noor Al-Rumaihi");
    expect(ok.values!.event_id).toBeNull();
    expect(ok.values!.event_name).toBe("Doha Open");
    expect(ok.values!.details.booked_for).toBe("child");
  });

  it("rejects an event id that was not offered, a service of another type, a bad URL and a past date", () => {
    const r = parsePublicBookingForm(fd({ ...CONTACT, booking_type: "tournament_athlete", booked_for: "self", event_id: "44444444-4444-4444-8444-444444444444", service_id: OTHER_SERVICE, coverage: "photo", source_url: "ftp://x", competition_date: "2026-01-01" }), ctx);
    expect(r.fieldErrors.event_id).toMatch(/no longer listed/);
    expect(r.fieldErrors.service_id).toMatch(/not available/);
    expect(r.fieldErrors.source_url).toMatch(/https/);
    expect(r.fieldErrors.competition_date).toMatch(/passed/);
  });

  it("club: happy path creates a quote-style request with athlete count and wants", () => {
    const r = parsePublicBookingForm(fd({ ...CONTACT, booking_type: "club", club_name: "Team Nogueira Qatar", event_name: "Doha Open", athlete_count: "14", wants_photographer: "1", notes: "Two mats" }), ctx);
    expect(r.fieldErrors).toEqual({});
    const v = r.values!;
    expect(v.club_name).toBe("Team Nogueira Qatar");
    expect(v.athlete_name).toBe(v.full_name);
    expect(v.details).toMatchObject({ booked_for: "club", club_name: "Team Nogueira Qatar", athlete_count: 14, wants_photographer: true, wants_videographer: false, event_name: "Doha Open" });
  });

  it("club: needs a club name, a sane athlete count and at least one of photo/video", () => {
    const r = parsePublicBookingForm(fd({ ...CONTACT, booking_type: "club", event_name: "Doha Open", athlete_count: "0" }), ctx);
    expect(r.fieldErrors.club_name).toBe("Required.");
    expect(r.fieldErrors.athlete_count).toMatch(/between 1 and 500/);
    expect(r.fieldErrors.wants).toMatch(/at least one/);
  });

  it("training session: date required, time validated, service optional", () => {
    const bad = parsePublicBookingForm(fd({ ...CONTACT, booking_type: "training_session", requested_time: "25:00" }), ctx);
    expect(bad.fieldErrors.requested_date).toBe("Required.");
    expect(bad.fieldErrors.requested_time).toMatch(/24-hour/);
    const ok = parsePublicBookingForm(fd({ ...CONTACT, booking_type: "training_session", requested_date: "2026-10-20", requested_time: "18:30", location_preference: "Our academy in Al Sadd", service_id: OTHER_SERVICE }), ctx);
    expect(ok.fieldErrors).toEqual({});
    expect(ok.values!.details).toMatchObject({ requested_date: "2026-10-20", requested_time: "18:30", location_preference: "Our academy in Al Sadd" });
    expect(ok.values!.service_id).toBe(OTHER_SERVICE);
  });

  it("private session: optional athlete name is kept", () => {
    const ok = parsePublicBookingForm(fd({ ...CONTACT, booking_type: "private_session", requested_date: "2026-10-20", athlete_name: "Sara" }), ctx);
    expect(ok.fieldErrors).toEqual({});
    expect(ok.values!.athlete_name).toBe("Sara");
  });

  it("custom: free text is required and becomes the notes", () => {
    expect(parsePublicBookingForm(fd({ ...CONTACT, booking_type: "custom" }), ctx).fieldErrors.request).toBe("Required.");
    const ok = parsePublicBookingForm(fd({ ...CONTACT, booking_type: "custom", request: "Black belt promotion ceremony, 40 people" }), ctx);
    expect(ok.fieldErrors).toEqual({});
    expect(ok.values!.notes).toBe("Black belt promotion ceremony, 40 people");
    expect(ok.values!.details.request).toBe("Black belt promotion ceremony, 40 people");
  });
});

describe("parseContactForm", () => {
  it("accepts a plain message and lower-cases the e-mail", () => {
    const r = parseContactForm(fd({ full_name: "Ali", email: "ALI@example.com", message: "Do you cover Dubai?", consent: "1" }));
    expect(r.fieldErrors).toEqual({});
    expect(r.values).toEqual({ full_name: "Ali", email: "ali@example.com", phone: null, message: "Do you cover Dubai?" });
  });
  it("rejects honeypot, missing consent, bad email, bad phone, long message", () => {
    expect(parseContactForm(fd({ full_name: "Ali", email: "a@b.co", message: "x", consent: "1", website: "spam" })).fieldErrors.website).toBeTruthy();
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
