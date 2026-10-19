import { describe, expect, it } from "vitest";
import {
  CLIENT_TYPES,
  HONEYPOT_ERROR,
  HONEYPOT_FIELD,
  LEGAL_FIELDS,
  MEDIA_NOT_SURE,
  SERVICE_KINDS,
  SERVICE_LABEL,
  composeDivision,
  defaultServiceKind,
  fieldVisible,
  isPublicRef,
  legacyServiceKind,
  orderedServices,
  parsePublicBookingForm,
  publicBookingFieldNames,
  publicBookingFields,
  resolveWizardEntry,
  stepIndexForField,
  summarizePublicBooking,
  toPublicServiceOption,
  videoFieldName,
  type PublicEventOption,
  type PublicServiceOption,
} from "@/lib/bookings/public-form";
import { BOOKING_TYPES } from "@/lib/bookings/state";
import { LEGACY_SERVICE_KIND, SERVICES, SERVICE_DEFINITIONS } from "@/lib/catalog";

const EVENT_ID = "11111111-1111-4111-8111-111111111111";
const SERVICE_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_SERVICE = "33333333-3333-4333-8333-333333333333";
const QUOTE_SERVICE = "44444444-4444-4444-8444-444444444444";
const KEY = "55555555-5555-4555-8555-555555555555";
const events: PublicEventOption[] = [{ id: EVENT_ID, name: "AJP Qatar National", event_date: "2026-11-20" }];
const services: PublicServiceOption[] = [
  toPublicServiceOption({ id: SERVICE_ID, name: "Tournament photo", booking_type: "tournament_athlete", price_qr: 350, price_mode: "from", description: "All matches. Set your price." }),
  toPublicServiceOption({ id: OTHER_SERVICE, name: "Training 60", booking_type: "training_session", price_qr: null, price_mode: "quote", description: null }),
  toPublicServiceOption({ id: QUOTE_SERVICE, name: "Tournament full day", booking_type: "tournament_athlete", price_qr: 900, price_mode: "quote", description: "Quoted individually." }),
];
const ctx = { events, services, today: "2026-10-06" };

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

const LEGAL = { accept_terms: "1", accept_privacy: "1", consent_media: "1" };
const CONTACT = { full_name: "Hamad Al-Rumaihi", phone: "+974 5555 1234", email: "Hamad@Example.com", instagram: "@Hamad.BJJ", client_type: "individual", usage_type: "personal", subject_is_minor: "no", idempotency_key: KEY, ...LEGAL };
const CUSTOM = { ...CONTACT, service_key: "organizer_custom", media_scope: "photo_video", request: "Seminar day" };
const ATHLETE = { ...CONTACT, service_key: "tournament_athlete", media_scope: "photo", event_id: EVENT_ID };

describe("catalog-driven steps", () => {
  it("defines what, details, contact and legal steps for every catalog service with unique field names", () => {
    for (const s of SERVICES) {
      const steps = publicBookingFields(s);
      expect(steps.map((x) => x.key)).toEqual(["what", "details", "contact", "legal"]);
      const names = publicBookingFieldNames(s);
      expect(new Set(names).size).toBe(names.length);
      for (const n of ["service_key", "media_scope", "service_id", "usage_type", "deadline", "access_notes", "budget_qr", "budget_unknown", "full_name", "email", "phone", "client_type", "accept_terms", "accept_privacy", "consent_media"]) expect(names).toContain(n);
      if (SERVICE_DEFINITIONS[s].bookingType === "club") expect(names).not.toContain("subject_is_minor");
      else expect(names).toEqual(expect.arrayContaining(["subject_is_minor", "guardian_name", "guardian_email", "guardian_phone", "guardian_consent"]));
      // Each thing is asked once: usage lives on the details step, not with the contact details.
      expect(steps[1].fields.some((f) => f.name === "usage_type")).toBe(true);
      expect(steps[2].fields.some((f) => f.name === "usage_type")).toBe(false);
    }
  });

  it("offers the service's media scopes plus 'not sure', and its video deliverables plus 'not sure' only when video is wanted", () => {
    const what = publicBookingFields("athlete_portrait")[0];
    const media = what.fields.find((f) => f.name === "media_scope")!;
    expect(media.options!.map((o) => o.value)).toEqual([...SERVICE_DEFINITIONS.athlete_portrait.mediaScopes, MEDIA_NOT_SURE]);
    const video = what.fields.find((f) => f.name === "video_deliverables")!;
    expect(video.options!.map((o) => o.value)).toEqual([videoFieldName("reels"), videoFieldName("edited_highlights"), videoFieldName("not_sure")]);
    // Raw footage was retired from the offer: no service ever asks for it any more.
    for (const s of SERVICES) expect(publicBookingFields(s)[0].fields.find((f) => f.name === "video_deliverables")!.options!.map((o) => o.value)).not.toContain(videoFieldName("raw_footage"));
    expect(fieldVisible(video, { media_scope: "photo" })).toBe(false);
    expect(fieldVisible(video, { media_scope: "video" })).toBe(true);
    expect(fieldVisible(video, { media_scope: "photo_video" })).toBe(true);
    expect(fieldVisible(video, { media_scope: MEDIA_NOT_SURE })).toBe(false);
  });

  it("asks for the roster size where a group is photographed and allows an unknown bracket for athletes", () => {
    expect(publicBookingFields("team_tournament")[1].fields.find((f) => f.name === "athlete_count")).toMatchObject({ required: true });
    expect(publicBookingFields("training_content")[1].fields.find((f) => f.name === "athlete_count")?.required).toBeFalsy();
    expect(publicBookingFields("organizer_custom")[1].fields.find((f) => f.name === "athlete_count")).toBeTruthy();
    for (const n of ["age_division", "belt", "weight_division", "gi", "competition_date"]) expect(publicBookingFields("tournament_athlete")[1].fields.find((f) => f.name === n)?.required).toBeFalsy();
  });

  it("pre-selects nothing: every consent box is a plain required checkbox", () => {
    for (const f of LEGAL_FIELDS) expect(f).toMatchObject({ kind: "consent", required: true });
    expect(new Set(LEGAL_FIELDS.map((f) => f.name)).size).toBe(3);
    expect(CLIENT_TYPES).toHaveLength(5);
  });

  it("maps field names to wizard steps (0 = what … 3 = review) for error jumps", () => {
    expect(stepIndexForField("tournament_athlete", "service_key")).toBe(0);
    expect(stepIndexForField("tournament_athlete", "media_scope")).toBe(0);
    expect(stepIndexForField("tournament_athlete", videoFieldName("full_match"))).toBe(0);
    expect(stepIndexForField("tournament_athlete", "service_id")).toBe(0);
    expect(stepIndexForField("tournament_athlete", "event_id")).toBe(1);
    expect(stepIndexForField("tournament_athlete", "budget_qr")).toBe(1);
    expect(stepIndexForField("tournament_athlete", "guardian_email")).toBe(2);
    expect(stepIndexForField("tournament_athlete", "accept_terms")).toBe(3);
    expect(stepIndexForField("team_tournament", "athlete_count")).toBe(1);
    expect(stepIndexForField("team_tournament", "nope")).toBeNull();
  });
});

describe("legacy service kinds", () => {
  it("keeps the eight legacy choices, each mapped onto a booking type and a catalog service", () => {
    expect(SERVICE_KINDS.map((k) => k.value)).toEqual(["tournament_athlete_photo", "tournament_athlete_photo_video", "event_coverage", "club_team_coverage", "training_coverage", "athlete_portrait", "private_session", "custom"]);
    for (const k of SERVICE_KINDS) {
      expect(BOOKING_TYPES).toContain(k.booking_type);
      expect(SERVICE_DEFINITIONS[LEGACY_SERVICE_KIND[k.value].service].bookingType).toBe(k.booking_type);
    }
    for (const t of BOOKING_TYPES) expect(SERVICE_KINDS.find((k) => k.value === defaultServiceKind(t))?.booking_type).toBe(t);
  });

  it("picks the closest legacy kind for a catalog choice and round-trips a legacy kind the visitor arrived with", () => {
    expect(legacyServiceKind("tournament_athlete", "photo")).toBe("tournament_athlete_photo");
    expect(legacyServiceKind("tournament_athlete", "photo_video")).toBe("tournament_athlete_photo_video");
    expect(legacyServiceKind("tournament_athlete", "video")).toBe("tournament_athlete_photo_video");
    expect(legacyServiceKind("tournament_athlete", null)).toBe("tournament_athlete_photo");
    expect(legacyServiceKind("team_tournament", "photo")).toBe("club_team_coverage");
    expect(legacyServiceKind("training_content", "video")).toBe("training_coverage");
    expect(legacyServiceKind("athlete_portrait", "photo")).toBe("athlete_portrait");
    expect(legacyServiceKind("organizer_custom", "photo_video")).toBe("event_coverage");
    expect(legacyServiceKind("organizer_custom", "photo_video", "custom")).toBe("custom");
    expect(legacyServiceKind("athlete_portrait", "photo", "private_session")).toBe("private_session");
    // A hint for another service is ignored.
    expect(legacyServiceKind("athlete_portrait", "photo", "custom")).toBe("athlete_portrait");
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

  it("rejects an unknown service, and a booking type that disagrees with it", () => {
    expect(parsePublicBookingForm(fd({ ...CONTACT, service_key: "wedding" }), ctx).fieldErrors.service_key).toBeTruthy();
    expect(parsePublicBookingForm(fd({ ...CONTACT, service_kind: "wedding" }), ctx).fieldErrors.service_key).toBeTruthy();
    expect(parsePublicBookingForm(fd({ ...CUSTOM, booking_type: "club" }), ctx).fieldErrors.booking_type).toBeTruthy();
    expect(parsePublicBookingForm(fd({ ...CUSTOM, booking_type: "custom" }), ctx).fieldErrors).toEqual({});
  });

  it("requires a media choice from the service's scopes or 'not sure', and stores it", () => {
    const missing = parsePublicBookingForm(fd({ ...CUSTOM, media_scope: "" }), ctx);
    expect(missing.values).toBeNull();
    expect(missing.fieldErrors.media_scope).toMatch(/photos, video or both/i);
    expect(parsePublicBookingForm(fd({ ...CUSTOM, media_scope: "audio" }), ctx).fieldErrors.media_scope).toBeTruthy();
    const unsure = parsePublicBookingForm(fd({ ...CUSTOM, media_scope: MEDIA_NOT_SURE }), ctx);
    expect(unsure.fieldErrors).toEqual({});
    expect(unsure.values!.media_scope).toBe(MEDIA_NOT_SURE);
    expect(unsure.values!.details).toMatchObject({ service_key: "organizer_custom", media_scope: MEDIA_NOT_SURE, service_kind: "event_coverage" });
    expect(unsure.values!.details.coverage).toBeUndefined();
  });

  it("records explicit video deliverables (and 'not sure') only when video is wanted", () => {
    const r = parsePublicBookingForm(fd({ ...CUSTOM, [videoFieldName("full_match")]: "1", [videoFieldName("reels")]: "1", [videoFieldName("not_sure")]: "1" }), ctx);
    expect(r.fieldErrors).toEqual({});
    expect(r.values!.video_deliverables).toEqual(["full_match", "reels"]);
    expect(r.values!.details).toMatchObject({ video_deliverables: ["full_match", "reels"], video_deliverables_unknown: true, coverage: "both" });
    const photo = parsePublicBookingForm(fd({ ...CUSTOM, media_scope: "photo", [videoFieldName("full_match")]: "1" }), ctx);
    expect(photo.values!.video_deliverables).toEqual([]);
    expect(photo.values!.details.video_deliverables).toBeUndefined();
    expect(photo.values!.details.coverage).toBe("photo");
    // A deliverable the service does not offer is ignored, never an error.
    const portrait = parsePublicBookingForm(fd({ ...CONTACT, service_key: "athlete_portrait", media_scope: "video", requested_date: "2026-10-20", [videoFieldName("full_match")]: "1", [videoFieldName("reels")]: "1" }), ctx);
    expect(portrait.values!.video_deliverables).toEqual(["reels"]);
  });

  it("requires each legal box separately: terms, privacy, media", () => {
    const r = parsePublicBookingForm(fd({ ...CUSTOM, accept_terms: "", accept_privacy: "", consent_media: "" }), ctx);
    expect(r.values).toBeNull();
    expect(r.fieldErrors.accept_terms).toMatch(/tick/i);
    expect(r.fieldErrors.accept_privacy).toMatch(/tick/i);
    expect(r.fieldErrors.consent_media).toMatch(/tick/i);
    expect(parsePublicBookingForm(fd({ ...CUSTOM, accept_terms: "" }), ctx).fieldErrors).toEqual({ accept_terms: expect.any(String) });
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

  it("validates e-mail and phone, and caps lengths", () => {
    const r = parsePublicBookingForm(fd({ ...CUSTOM, email: "nope", phone: "12" }), ctx);
    expect(r.fieldErrors.email).toMatch(/e-mail/i);
    expect(r.fieldErrors.phone).toMatch(/8 digits/);
    const long = parsePublicBookingForm(fd({ ...CUSTOM, full_name: "x".repeat(121), request: "y".repeat(3001), access_notes: "z".repeat(2001) }), ctx);
    expect(long.fieldErrors.full_name).toMatch(/under 120/);
    expect(long.fieldErrors.request).toMatch(/under 3000/);
    expect(long.fieldErrors.access_notes).toMatch(/under 2000/);
  });

  it("tournament athlete: happy path for self, instagram normalised, division and venue kept, catalog and legacy keys recorded", () => {
    const r = parsePublicBookingForm(
      fd({ ...ATHLETE, media_scope: "photo_video", [videoFieldName("full_match")]: "1", age_division: "Adult", belt: "blue", weight_division: "-77 kg", gi: "both", service_id: SERVICE_ID, source_url: "https://ajptour.com/en/athlete/1", notes: "Mat 3 usually", academy: "Gracie Barra Doha", location: "Lusail Sports Arena", deadline: "2026-12-01", access_notes: "No photos of my teammate Sara", budget_qr: "1,500" }),
      ctx,
    );
    expect(r.fieldErrors).toEqual({});
    const v = r.values!;
    expect(v.booking_type).toBe("tournament_athlete");
    expect(v.service_key).toBe("tournament_athlete");
    expect(v.service_kind).toBe("tournament_athlete_photo_video");
    expect(v.media_scope).toBe("photo_video");
    expect(v.athlete_name).toBe("Hamad Al-Rumaihi");
    expect(v.email).toBe("hamad@example.com");
    expect(v.instagram).toBe("hamad.bjj");
    expect(v.event_id).toBe(EVENT_ID);
    expect(v.event_name).toBe("AJP Qatar National");
    expect(v.service_id).toBe(SERVICE_ID);
    expect(v.location).toBe("Lusail Sports Arena");
    expect(v.details).toMatchObject({ service_kind: "tournament_athlete_photo_video", service_key: "tournament_athlete", media_scope: "photo_video", video_deliverables: ["full_match"], booked_for: "self", belt: "blue", gi: "both", coverage: "both", source_url: "https://ajptour.com/en/athlete/1", academy: "Gracie Barra Doha", event_name: "AJP Qatar National", notes: "Mat 3 usually", location: "Lusail Sports Arena", deadline: "2026-12-01", access_notes: "No photos of my teammate Sara", budget_qr: 1500 });
    expect(v.details.budget_unknown).toBeUndefined();
    expect(composeDivision(v.age_division, v.weight_division)).toBe("Adult / -77 kg");
    const summary = summarizePublicBooking(v, services);
    const row = (k: string) => summary.find(([x]) => x === k)?.[1];
    expect(row("Service")).toBe(SERVICE_LABEL.tournament_athlete.title);
    expect(row("Media")).toBe("Photos and video");
    expect(row("Video")).toBe("Full matches");
    expect(row("Package")).toBe("Tournament photo (from 350 QAR)");
    expect(row("Budget")).toBe("1,500 QAR");
    expect(row("Files wanted by")).toBe("2026-12-01");
    expect(row("Access / privacy")).toBe("No photos of my teammate Sara");
    expect(row("Booked by")).toBe("Myself");
  });

  it("a quote-mode package is summarised as a quote even though it carries a number (issue #10)", () => {
    const r = parsePublicBookingForm(fd({ ...ATHLETE, service_id: QUOTE_SERVICE }), ctx);
    expect(r.fieldErrors).toEqual({});
    expect(summarizePublicBooking(r.values!, services).find(([k]) => k === "Package")?.[1]).toBe("Tournament full day (Quote on request)");
  });

  it("legacy submissions: a bare service_kind (old links, open tabs) still resolves the service and media", () => {
    const photo = parsePublicBookingForm(fd({ ...CONTACT, service_kind: "tournament_athlete_photo", event_id: EVENT_ID }), ctx);
    expect(photo.fieldErrors).toEqual({});
    expect(photo.values).toMatchObject({ service_key: "tournament_athlete", media_scope: "photo", service_kind: "tournament_athlete_photo", booking_type: "tournament_athlete" });
    const legacyCoverage = parsePublicBookingForm(fd({ ...CONTACT, service_key: "tournament_athlete", event_id: EVENT_ID, coverage: "both" }), ctx);
    expect(legacyCoverage.values!.media_scope).toBe("photo_video");
    const custom = parsePublicBookingForm(fd({ ...CONTACT, service_kind: "custom", request: "Seminar day" }), ctx);
    expect(custom.values).toMatchObject({ service_key: "organizer_custom", media_scope: "photo_video", service_kind: "custom" });
    // A legacy kind that names the same service is kept verbatim; one for another service is replaced.
    expect(parsePublicBookingForm(fd({ ...CUSTOM, service_kind: "custom" }), ctx).values!.details.service_kind).toBe("custom");
    expect(parsePublicBookingForm(fd({ ...CUSTOM, service_kind: "training_coverage" }), ctx).values!.details.service_kind).toBe("event_coverage");
  });

  it("tournament athlete: a parent needs the athlete's name; free-text event is allowed", () => {
    const base = { ...ATHLETE, client_type: "parent_guardian", event_id: "other", event_name: "Doha Open" };
    expect(parsePublicBookingForm(fd(base), ctx).fieldErrors.athlete_name).toMatch(/athlete/i);
    const ok = parsePublicBookingForm(fd({ ...base, athlete_name: "Noor Al-Rumaihi" }), ctx);
    expect(ok.fieldErrors).toEqual({});
    expect(ok.values!.athlete_name).toBe("Noor Al-Rumaihi");
    expect(ok.values!.event_id).toBeNull();
    expect(ok.values!.event_name).toBe("Doha Open");
    expect(ok.values!.details.booked_for).toBe("child");
    expect(parsePublicBookingForm(fd({ ...base, client_type: "club_team", athlete_name: "Sara" }), ctx).values!.details.booked_for).toBe("athlete");
  });

  it("rejects an event id that was not offered, a package of another type, a bad URL, past dates and a bad budget", () => {
    const r = parsePublicBookingForm(fd({ ...ATHLETE, event_id: "44444444-4444-4444-8444-444444444445", service_id: OTHER_SERVICE, source_url: "ftp://x", competition_date: "2026-01-01", deadline: "2026-01-01", budget_qr: "abc" }), ctx);
    expect(r.fieldErrors.event_id).toMatch(/no longer listed/);
    expect(r.fieldErrors.service_id).toMatch(/not available/);
    expect(r.fieldErrors.source_url).toMatch(/https/);
    expect(r.fieldErrors.competition_date).toMatch(/passed/);
    expect(r.fieldErrors.deadline).toMatch(/passed/);
    expect(r.fieldErrors.budget_qr).toMatch(/whole number/);
  });

  it("budget: 'not sure' wins over a typed amount, and neither is required", () => {
    const unsure = parsePublicBookingForm(fd({ ...ATHLETE, budget_qr: "abc", budget_unknown: "1" }), ctx);
    expect(unsure.fieldErrors).toEqual({});
    expect(unsure.values!.details).toMatchObject({ budget_unknown: true });
    expect(unsure.values!.details.budget_qr).toBeUndefined();
    expect(summarizePublicBooking(unsure.values!, services).find(([k]) => k === "Budget")?.[1]).toBe("Not sure");
    const none = parsePublicBookingForm(fd(ATHLETE), ctx);
    expect(none.values!.details.budget_qr).toBeUndefined();
    expect(none.values!.details.budget_unknown).toBeUndefined();
  });

  it("club: happy path creates a quote-style request with roster, duration, wants derived from media; no minor question", () => {
    const r = parsePublicBookingForm(fd({ ...CONTACT, service_key: "team_tournament", media_scope: "photo", client_type: "club_team", usage_type: "club_team", subject_is_minor: "", club_name: "Team Nogueira Qatar", event_name: "Doha Open", athlete_count: "14", coverage_hours: "6", notes: "Two mats" }), ctx);
    expect(r.fieldErrors).toEqual({});
    const v = r.values!;
    expect(v.booking_type).toBe("club");
    expect(v.club_name).toBe("Team Nogueira Qatar");
    expect(v.athlete_name).toBe(v.full_name);
    expect(v.subject_is_minor).toBe(false);
    expect(v.details).toMatchObject({ service_kind: "club_team_coverage", service_key: "team_tournament", media_scope: "photo", booked_for: "club", club_name: "Team Nogueira Qatar", athlete_count: 14, coverage_hours: 6, wants_photographer: true, wants_videographer: false, event_name: "Doha Open" });
    const both = parsePublicBookingForm(fd({ ...CONTACT, service_key: "team_tournament", media_scope: "photo_video", client_type: "club_team", club_name: "X", event_name: "Y", athlete_count: "3" }), ctx);
    expect(both.values!.details).toMatchObject({ wants_photographer: true, wants_videographer: true });
    const unsure = parsePublicBookingForm(fd({ ...CONTACT, service_key: "team_tournament", media_scope: MEDIA_NOT_SURE, client_type: "club_team", club_name: "X", event_name: "Y", athlete_count: "3" }), ctx);
    expect(unsure.values!.details.wants_photographer).toBeUndefined();
    expect(summarizePublicBooking(v, services).find(([k]) => k === "Duration")?.[1]).toBe("6 h");
  });

  it("club: needs a club name and a sane athlete count", () => {
    const r = parsePublicBookingForm(fd({ ...CONTACT, service_key: "team_tournament", media_scope: "photo", event_name: "Doha Open", athlete_count: "0", coverage_hours: "99" }), ctx);
    expect(r.fieldErrors.club_name).toBe("Required.");
    expect(r.fieldErrors.athlete_count).toMatch(/between 1 and 500/);
    expect(r.fieldErrors.coverage_hours).toMatch(/between 1 and 48/);
  });

  it("training content: date required, time validated, package optional, headcount optional", () => {
    const bad = parsePublicBookingForm(fd({ ...CONTACT, service_key: "training_content", media_scope: "photo", requested_time: "25:00" }), ctx);
    expect(bad.fieldErrors.requested_date).toBe("Required.");
    expect(bad.fieldErrors.requested_time).toMatch(/24-hour/);
    const ok = parsePublicBookingForm(fd({ ...CONTACT, service_key: "training_content", media_scope: "video", [videoFieldName("reels")]: "1", requested_date: "2026-10-20", requested_time: "18:30", location_preference: "Our academy in Al Sadd", service_id: OTHER_SERVICE, event_name: "Comp prep", academy: "Al Sadd BJJ", athlete_count: "8" }), ctx);
    expect(ok.fieldErrors).toEqual({});
    expect(ok.values!.booking_type).toBe("training_session");
    expect(ok.values!.details).toMatchObject({ service_kind: "training_coverage", media_scope: "video", video_deliverables: ["reels"], requested_date: "2026-10-20", requested_time: "18:30", location_preference: "Our academy in Al Sadd", event_name: "Comp prep", academy: "Al Sadd BJJ", athlete_count: 8 });
    expect(ok.values!.service_id).toBe(OTHER_SERVICE);
    expect(ok.values!.location).toBe("Our academy in Al Sadd");
  });

  it("portraits: optional athlete name is kept and the legacy kind stays athlete_portrait", () => {
    const ok = parsePublicBookingForm(fd({ ...CONTACT, service_key: "athlete_portrait", media_scope: "photo", requested_date: "2026-10-20", athlete_name: "Sara" }), ctx);
    expect(ok.fieldErrors).toEqual({});
    expect(ok.values!.booking_type).toBe("private_session");
    expect(ok.values!.athlete_name).toBe("Sara");
    expect(ok.values!.service_kind).toBe("athlete_portrait");
  });

  it("organiser / custom: free text is required and becomes the notes", () => {
    expect(parsePublicBookingForm(fd({ ...CUSTOM, request: "" }), ctx).fieldErrors.request).toBe("Required.");
    const ok = parsePublicBookingForm(fd({ ...CUSTOM, client_type: "event_organiser", usage_type: "commercial", request: "Black belt promotion ceremony, 40 people", athlete_count: "40" }), ctx);
    expect(ok.fieldErrors).toEqual({});
    expect(ok.values!.booking_type).toBe("custom");
    expect(ok.values!.notes).toBe("Black belt promotion ceremony, 40 people");
    expect(ok.values!.details.request).toBe("Black belt promotion ceremony, 40 people");
    expect(ok.values!.details.athlete_count).toBe(40);
    expect(ok.values!.usage_type).toBe("commercial");
  });
});

describe("toPublicServiceOption", () => {
  it("sends the browser a price label and a quote flag, never the raw price, and strips placeholder text", () => {
    expect(services[0]).toEqual({ id: SERVICE_ID, name: "Tournament photo", booking_type: "tournament_athlete", price_label: "from 350 QAR", quote: false, description: "All matches." });
    expect(services[2]).toEqual({ id: QUOTE_SERVICE, name: "Tournament full day", booking_type: "tournament_athlete", price_label: "Quote on request", quote: true, description: null });
    expect(JSON.stringify(services)).not.toMatch(/900|price_qr|Set your price/);
    // A quote-first catalog service (clubs) is a quote even with a priced package.
    expect(toPublicServiceOption({ id: "x", name: "Club day", booking_type: "club", price_qr: 1200, price_mode: "fixed", description: null })).toMatchObject({ price_label: "Quote on request", quote: true });
  });
});

describe("resolveWizardEntry", () => {
  const ctxEntry = { events, services };
  it("opens on a catalog service, an audience's first service, a legacy type or kind, or nothing", () => {
    expect(resolveWizardEntry({ service: "athlete_portrait" }, ctxEntry)).toMatchObject({ service: "athlete_portrait", media: null, audience: null, legacyKind: null, serviceId: null });
    expect(resolveWizardEntry({ audience: "clubs" }, ctxEntry)).toMatchObject({ service: "team_tournament", audience: "clubs" });
    expect(resolveWizardEntry({ type: "tournament_athlete" }, ctxEntry)).toMatchObject({ service: "tournament_athlete", media: null });
    expect(resolveWizardEntry({ kind: "tournament_athlete_photo_video" }, ctxEntry)).toMatchObject({ service: "tournament_athlete", media: "photo_video", legacyKind: "tournament_athlete_photo_video" });
    expect(resolveWizardEntry({ kind: "custom" }, ctxEntry)).toMatchObject({ service: "organizer_custom", legacyKind: "custom" });
    expect(resolveWizardEntry({ service: "training_content", media: "video" }, ctxEntry)).toMatchObject({ service: "training_content", media: "video" });
    expect(resolveWizardEntry({ service: "training_content", media: "audio" }, ctxEntry).media).toBeNull();
    expect(resolveWizardEntry({ media: "video" }, ctxEntry)).toMatchObject({ service: null, media: null });
    expect(resolveWizardEntry({ type: "wedding", kind: "nope", service: "x", audience: "robots" }, ctxEntry)).toMatchObject({ service: null, media: null, audience: null });
  });
  it("accepts a package id as ?service= (the services page) and preselects it with its service", () => {
    expect(resolveWizardEntry({ service: SERVICE_ID }, ctxEntry)).toMatchObject({ service: "tournament_athlete", serviceId: SERVICE_ID });
    expect(resolveWizardEntry({ type: "tournament_athlete", service: SERVICE_ID }, ctxEntry)).toMatchObject({ service: "tournament_athlete", serviceId: SERVICE_ID });
    // A package of another type than the requested service is not carried over.
    expect(resolveWizardEntry({ type: "club", service: SERVICE_ID }, ctxEntry)).toMatchObject({ service: "team_tournament", serviceId: null });
    expect(resolveWizardEntry({ service: "66666666-6666-4666-8666-666666666666" }, ctxEntry).service).toBeNull();
  });
  it("keeps a listed event and drops an unknown one", () => {
    expect(resolveWizardEntry({ event: EVENT_ID }, ctxEntry).eventId).toBe(EVENT_ID);
    expect(resolveWizardEntry({ event: "77777777-7777-4777-8777-777777777777" }, ctxEntry).eventId).toBeNull();
  });
  it("orders services with the audience's own first", () => {
    expect(orderedServices("parents").slice(0, 2)).toEqual(["tournament_athlete", "athlete_portrait"]);
    expect(orderedServices(null)).toEqual([...SERVICES]);
    expect(new Set(orderedServices("clubs")).size).toBe(SERVICES.length);
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
