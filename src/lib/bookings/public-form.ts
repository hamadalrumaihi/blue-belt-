/**
 * Public booking wizard: one definition of the fields per booking type,
 * shared by the UI (which renders the steps) and the server action (which
 * parses the submitted FormData). Pure: no I/O, no server-only imports, so it
 * is unit-tested directly and safe to import from a client component.
 */
import type { BookingType } from "@/lib/supabase/database.types";
import { BOOKING_TYPE_LABEL, isBookingType, type BookingDetails } from "@/lib/bookings/state";
import { normalizeInstagram, phoneKey } from "@/lib/people/match";
import { isValidEmail, isValidHttpUrl, trimOrNull } from "@/lib/utils";
import { isUuid, isValidCalendarDate } from "@/lib/validation";

export const MAX = { name: 120, short: 200, url: 2048, notes: 2000, request: 3000, phone: 30, email: 254, athleteCount: 500 } as const;

export type FieldKind = "text" | "email" | "tel" | "date" | "time" | "number" | "url" | "textarea" | "select" | "radio" | "checkbox" | "event" | "service";

export type PublicField = {
  name: string;
  label: string;
  kind: FieldKind;
  required?: boolean;
  options?: Array<{ value: string; label: string; hint?: string }>;
  hint?: string;
  placeholder?: string;
  max?: number;
  inputMode?: "text" | "tel" | "email" | "numeric" | "url";
  autoComplete?: string;
};

export type PublicStep = { key: "details" | "contact"; title: string; intro: string; fields: PublicField[] };

export type PublicEventOption = { id: string; name: string; event_date: string | null };
export type PublicServiceOption = { id: string; name: string; booking_type: BookingType; price_qr: number | null; currency: string; description?: string | null };

/** What the type-picker step shows, in display order. */
export const PUBLIC_BOOKING_TYPES: Array<{ value: BookingType; title: string; body: string }> = [
  { value: "tournament_athlete", title: BOOKING_TYPE_LABEL.tournament_athlete, body: "Your matches photographed or filmed at a competition. Book for yourself, your child or an athlete you coach." },
  { value: "club", title: BOOKING_TYPE_LABEL.club, body: "Coverage for a whole academy or team at an event. We send a quote for the day." },
  { value: "training_session", title: BOOKING_TYPE_LABEL.training_session, body: "Photos or video at your academy during a regular class or open mat." },
  { value: "private_session", title: BOOKING_TYPE_LABEL.private_session, body: "A dedicated session for one athlete: portraits, technique, sponsorship material." },
  { value: "custom", title: BOOKING_TYPE_LABEL.custom, body: "Seminars, grading days, promotions or anything else. Tell us what you have in mind." },
];

export const BELT_OPTIONS = ["White", "Grey", "Yellow", "Orange", "Green", "Blue", "Purple", "Brown", "Black"].map((b) => ({ value: b.toLowerCase(), label: b }));

const CONTACT_BASE: PublicField[] = [
  { name: "full_name", label: "Your name", kind: "text", required: true, max: MAX.name, autoComplete: "name" },
  { name: "phone", label: "Phone / WhatsApp", kind: "tel", required: true, max: MAX.phone, inputMode: "tel", autoComplete: "tel", placeholder: "+974 …", hint: "We confirm bookings by WhatsApp or phone." },
  { name: "email", label: "E-mail", kind: "email", required: true, max: MAX.email, inputMode: "email", autoComplete: "email", hint: "Your booking reference and gallery link are sent here." },
  { name: "instagram", label: "Instagram", kind: "text", max: 60, placeholder: "@handle", hint: "Optional. Handy for tagging you when the gallery is out." },
];

const NOTES: PublicField = { name: "notes", label: "Anything else we should know?", kind: "textarea", max: MAX.notes, placeholder: "Mat preferences, timing, special requests…" };

/** The wizard's details and contact steps for one booking type. */
export function publicBookingFields(type: BookingType): PublicStep[] {
  switch (type) {
    case "tournament_athlete":
      return [
        {
          key: "details",
          title: "The competition",
          intro: "Tell us who is competing and where. We match the athlete on the day from the bracket.",
          fields: [
            {
              name: "booked_for",
              label: "Who is this booking for?",
              kind: "radio",
              required: true,
              options: [
                { value: "self", label: "Myself" },
                { value: "child", label: "My child" },
                { value: "athlete", label: "An athlete I coach or manage" },
              ],
            },
            { name: "athlete_name", label: "Athlete's full name", kind: "text", max: MAX.name, hint: "As registered with the organiser. Leave empty if it is you.", autoComplete: "off" },
            { name: "academy", label: "Academy / team", kind: "text", max: MAX.short, autoComplete: "organization" },
            { name: "event", label: "Competition", kind: "event", required: true, hint: "Pick an event we are covering, or type the name if it is not listed." },
            { name: "competition_date", label: "Competition date", kind: "date", hint: "If you know it. Leave empty when you picked a listed event." },
            { name: "age_division", label: "Age division", kind: "text", max: 60, placeholder: "Adult, Master 1, Juvenile…" },
            { name: "belt", label: "Belt", kind: "select", options: BELT_OPTIONS },
            { name: "weight_division", label: "Weight division", kind: "text", max: 60, placeholder: "-77 kg, Light feather…" },
            {
              name: "gi",
              label: "Gi or No-Gi",
              kind: "radio",
              options: [
                { value: "gi", label: "Gi" },
                { value: "no-gi", label: "No-Gi" },
                { value: "both", label: "Both" },
              ],
            },
            { name: "service_id", label: "Package", kind: "service", hint: "Prices are confirmed before anything is paid." },
            {
              name: "coverage",
              label: "What do you want?",
              kind: "radio",
              required: true,
              options: [
                { value: "photo", label: "Photos" },
                { value: "video", label: "Video" },
                { value: "both", label: "Photos and video" },
              ],
            },
            { name: "source_url", label: "AJP / Smoothcomp profile or bracket link", kind: "url", max: MAX.url, inputMode: "url", placeholder: "https://…", hint: "Optional, but it helps us find the right mat and time." },
            NOTES,
          ],
        },
        { key: "contact", title: "How to reach you", intro: "We confirm within 24 hours. Nothing is paid now.", fields: CONTACT_BASE },
      ];
    case "club":
      return [
        {
          key: "details",
          title: "Your team",
          intro: "Team days are quoted individually: tell us the event and roughly how many athletes compete.",
          fields: [
            { name: "club_name", label: "Club / academy name", kind: "text", required: true, max: MAX.short, autoComplete: "organization" },
            { name: "event", label: "Tournament / event", kind: "event", required: true, hint: "Pick an event we are covering, or type the name." },
            { name: "competition_date", label: "Event date", kind: "date", hint: "If known." },
            { name: "athlete_count", label: "How many athletes?", kind: "number", required: true, inputMode: "numeric", placeholder: "12", hint: "A rough number is fine." },
            {
              name: "wants",
              label: "What do you need on the day?",
              kind: "checkbox",
              required: true,
              options: [
                { value: "wants_photographer", label: "Photographer" },
                { value: "wants_videographer", label: "Videographer" },
              ],
            },
            NOTES,
          ],
        },
        {
          key: "contact",
          title: "Who should we talk to?",
          intro: "The coach or team manager who will receive the quote.",
          fields: [{ ...CONTACT_BASE[0], label: "Contact name" }, CONTACT_BASE[1], CONTACT_BASE[2], { ...CONTACT_BASE[3], label: "Club Instagram", hint: "Optional." }],
        },
      ];
    case "training_session":
    case "private_session":
      return [
        {
          key: "details",
          title: type === "training_session" ? "The session" : "Your session",
          intro: type === "training_session" ? "Photos or video during a class, open mat or sparring round." : "A dedicated shoot for one athlete: portraits, technique or sponsor material.",
          fields: [
            { name: "service_id", label: "Package", kind: "service", hint: "Prices are confirmed before anything is paid." },
            { name: "requested_date", label: "Preferred date", kind: "date", required: true },
            { name: "requested_time", label: "Preferred time", kind: "time", hint: "Optional. We confirm the exact slot with you." },
            { name: "location_preference", label: "Where?", kind: "text", max: MAX.short, placeholder: "Your academy, outdoor, our studio…", hint: "Academy name or area in Doha." },
            ...(type === "private_session" ? [{ name: "athlete_name", label: "Athlete's name (if not you)", kind: "text", max: MAX.name, autoComplete: "off" } satisfies PublicField] : []),
            NOTES,
          ],
        },
        { key: "contact", title: "How to reach you", intro: "We confirm within 24 hours. Nothing is paid now.", fields: CONTACT_BASE },
      ];
    case "custom":
      return [
        {
          key: "details",
          title: "What do you have in mind?",
          intro: "Seminars, gradings, promotions, documentary pieces — describe it and we will come back with a plan and a quote.",
          fields: [
            { name: "request", label: "Describe the coverage you need", kind: "textarea", required: true, max: MAX.request, placeholder: "What, where, when, and for whom." },
            { name: "requested_date", label: "Date (if known)", kind: "date" },
            { name: "location_preference", label: "Location (if known)", kind: "text", max: MAX.short },
          ],
        },
        { key: "contact", title: "How to reach you", intro: "We reply within 24 hours.", fields: CONTACT_BASE },
      ];
  }
}

/** Every field name the wizard may submit, for the review step and tests. */
export function publicBookingFieldNames(type: BookingType): string[] {
  return publicBookingFields(type).flatMap((s) => s.fields.flatMap((f) => (f.kind === "event" ? ["event_id", "event_name"] : f.kind === "checkbox" ? (f.options ?? []).map((o) => o.value) : [f.name])));
}

/** photo_bookings.details for a website booking: the shared shape plus a few public-only keys. */
export type PublicBookingDetails = BookingDetails & {
  event_name?: string;
  club_name?: string;
  location_preference?: string;
  request?: string;
  notes?: string;
};

export type PublicBookingValues = {
  booking_type: BookingType;
  full_name: string;
  phone: string;
  email: string;
  instagram: string | null;
  /** Validated against the events the page offered; null when the visitor typed a name instead. */
  event_id: string | null;
  event_name: string | null;
  service_id: string | null;
  /** The person photographed, or the contact for a club. */
  athlete_name: string;
  club_name: string | null;
  academy: string | null;
  age_division: string | null;
  weight_division: string | null;
  notes: string | null;
  details: PublicBookingDetails;
};

export type ParsedPublicBooking = { fieldErrors: Record<string, string>; values: PublicBookingValues | null };

export type ParsePublicBookingContext = {
  events: PublicEventOption[];
  services: PublicServiceOption[];
  /** "Today" as YYYY-MM-DD; dates before it are rejected. */
  today?: string;
};

export const CONSENT_TEXT = "I agree to the photography terms and to be contacted about this booking";

function str(fd: FormData, name: string): string | null {
  return trimOrNull(fd.get(name));
}

function tooLong(v: string | null, max: number): boolean {
  return Boolean(v && v.length > max);
}

/** Phone numbers people actually type: digits, +, spaces, dashes, brackets; at least 8 digits. */
export function isPlausiblePhone(v: string): boolean {
  return v.length <= MAX.phone && /^[+\d\s().-]+$/.test(v) && phoneKey(v) !== null;
}

function isValidTime(v: string): boolean {
  const m = /^(\d{2}):(\d{2})$/.exec(v);
  return Boolean(m && Number(m[1]) < 24 && Number(m[2]) < 60);
}

/**
 * Validates the whole wizard submission. Owner, prices and payment state are
 * never read from the form: the caller resolves those from the studio row and
 * the service the visitor picked (validated here against the offered list).
 */
export function parsePublicBookingForm(fd: FormData, ctx: ParsePublicBookingContext): ParsedPublicBooking {
  const fieldErrors: Record<string, string> = {};
  const today = ctx.today ?? new Date().toISOString().slice(0, 10);

  // Bots fill every input; humans never see this one.
  if (str(fd, "website")) return { fieldErrors: { website: "Spam check failed." }, values: null };

  const typeRaw = str(fd, "booking_type");
  if (!isBookingType(typeRaw)) return { fieldErrors: { booking_type: "Choose what you would like to book." }, values: null };
  const type = typeRaw;

  if (fd.get("consent") !== "1") fieldErrors.consent = "Please agree to the terms to continue.";

  const steps = publicBookingFields(type);
  const raw: Record<string, string | null> = {};

  for (const field of steps.flatMap((s) => s.fields)) {
    if (field.kind === "checkbox") {
      let any = false;
      for (const opt of field.options ?? []) {
        const on = fd.get(opt.value) === "1";
        raw[opt.value] = on ? "1" : null;
        if (on) any = true;
      }
      if (field.required && !any) fieldErrors[field.name] = "Pick at least one.";
      continue;
    }
    if (field.kind === "event") {
      const id = str(fd, "event_id");
      const name = str(fd, "event_name");
      if (id && id !== "other") {
        if (!isUuid(id) || !ctx.events.some((e) => e.id === id)) {
          fieldErrors.event_id = "That event is no longer listed. Pick another or type its name.";
        } else {
          raw.event_id = id;
          raw.event_name = ctx.events.find((e) => e.id === id)?.name ?? null;
        }
      } else if (name) {
        if (tooLong(name, MAX.short)) fieldErrors.event_name = `Keep this under ${MAX.short} characters.`;
        raw.event_id = null;
        raw.event_name = name;
      } else if (field.required) {
        fieldErrors.event_id = "Tell us which competition.";
      }
      continue;
    }
    if (field.kind === "service") {
      const id = str(fd, field.name);
      if (!id) {
        raw[field.name] = null;
        if (field.required) fieldErrors[field.name] = "Pick a package.";
      } else if (!isUuid(id) || !ctx.services.some((s) => s.id === id && s.booking_type === type)) {
        fieldErrors[field.name] = "That package is not available. Pick another.";
      } else raw[field.name] = id;
      continue;
    }

    const v = str(fd, field.name);
    raw[field.name] = v;
    if (!v) {
      if (field.required) fieldErrors[field.name] = "Required.";
      continue;
    }
    if (field.max && tooLong(v, field.max)) {
      fieldErrors[field.name] = `Keep this under ${field.max} characters.`;
      continue;
    }
    switch (field.kind) {
      case "email":
        if (!isValidEmail(v)) fieldErrors[field.name] = "Enter a valid e-mail address.";
        break;
      case "tel":
        if (!isPlausiblePhone(v)) fieldErrors[field.name] = "Enter a phone number with at least 8 digits.";
        break;
      case "date":
        if (!isValidCalendarDate(v)) fieldErrors[field.name] = "Enter a real date.";
        else if (v < today) fieldErrors[field.name] = "That date has already passed.";
        break;
      case "time":
        if (!isValidTime(v)) fieldErrors[field.name] = "Use 24-hour time, e.g. 18:30.";
        break;
      case "number": {
        const n = Number(v);
        if (!Number.isInteger(n) || n < 1 || n > MAX.athleteCount) fieldErrors[field.name] = `Enter a whole number between 1 and ${MAX.athleteCount}.`;
        break;
      }
      case "url":
        if (!isValidHttpUrl(v)) fieldErrors[field.name] = "Enter a full link starting with https://";
        break;
      case "select":
      case "radio":
        if (!(field.options ?? []).some((o) => o.value === v)) fieldErrors[field.name] = "Pick one of the options.";
        break;
      default:
        break;
    }
  }

  // Instagram is normalised, never rejected: a bad handle just drops.
  const instagram = normalizeInstagram(raw.instagram);
  if (type === "tournament_athlete" && raw.booked_for && raw.booked_for !== "self" && !raw.athlete_name && !fieldErrors.athlete_name) fieldErrors.athlete_name = "Enter the athlete's name.";

  if (Object.keys(fieldErrors).length) return { fieldErrors, values: null };

  const fullName = raw.full_name!;
  const bookedFor = (raw.booked_for ?? undefined) as PublicBookingDetails["booked_for"];
  const athleteName = type === "club" ? fullName : raw.athlete_name ?? fullName;
  const details: PublicBookingDetails = {};
  if (instagram) details.instagram = instagram;
  if (type === "tournament_athlete") {
    details.booked_for = bookedFor ?? "self";
    details.athlete_name = athleteName;
    if (raw.academy) details.academy = raw.academy;
    if (raw.age_division) details.age_division = raw.age_division;
    if (raw.belt) details.belt = raw.belt;
    if (raw.weight_division) details.weight_division = raw.weight_division;
    if (raw.gi) details.gi = raw.gi as PublicBookingDetails["gi"];
    if (raw.coverage) details.coverage = raw.coverage as PublicBookingDetails["coverage"];
    if (raw.source_url) details.source_url = raw.source_url;
    if (raw.competition_date) details.competition_date = raw.competition_date;
  }
  if (type === "club") {
    details.booked_for = "club";
    details.club_name = raw.club_name!;
    details.athlete_count = Number(raw.athlete_count);
    details.wants_photographer = raw.wants_photographer === "1";
    details.wants_videographer = raw.wants_videographer === "1";
    if (raw.competition_date) details.competition_date = raw.competition_date;
  }
  if (type === "training_session" || type === "private_session" || type === "custom") {
    if (raw.requested_date) details.requested_date = raw.requested_date;
    if (raw.requested_time) details.requested_time = raw.requested_time;
    if (raw.location_preference) details.location_preference = raw.location_preference;
    if (raw.request) details.request = raw.request;
    if (raw.athlete_name) details.athlete_name = raw.athlete_name;
  }
  if (raw.event_name) details.event_name = raw.event_name;
  if (raw.notes) details.notes = raw.notes;

  return {
    fieldErrors,
    values: {
      booking_type: type,
      full_name: fullName,
      phone: raw.phone!,
      email: raw.email!.toLowerCase(),
      instagram,
      event_id: raw.event_id ?? null,
      event_name: raw.event_name ?? null,
      service_id: raw.service_id ?? null,
      athlete_name: athleteName,
      club_name: raw.club_name ?? null,
      academy: raw.academy ?? null,
      age_division: raw.age_division ?? null,
      weight_division: raw.weight_division ?? null,
      notes: raw.notes ?? raw.request ?? null,
      details,
    },
  };
}

/** "Adult / -77 kg" style label for photo_bookings.division. */
export function composeDivision(age: string | null, weight: string | null): string | null {
  const parts = [age, weight].filter((p): p is string => Boolean(p && p.trim()));
  return parts.length ? parts.join(" / ") : null;
}

export type ContactValues = { full_name: string; email: string; phone: string | null; message: string };
export type ParsedContact = { fieldErrors: Record<string, string>; values: ContactValues | null };

/** The short contact form: name, e-mail, optional phone, message, honeypot, consent. */
export function parseContactForm(fd: FormData): ParsedContact {
  if (str(fd, "website")) return { fieldErrors: { website: "Spam check failed." }, values: null };
  const fieldErrors: Record<string, string> = {};
  const full_name = str(fd, "full_name");
  const email = str(fd, "email");
  const phone = str(fd, "phone");
  const message = str(fd, "message");
  if (!full_name) fieldErrors.full_name = "Required.";
  else if (tooLong(full_name, MAX.name)) fieldErrors.full_name = `Keep this under ${MAX.name} characters.`;
  if (!email) fieldErrors.email = "Required.";
  else if (tooLong(email, MAX.email) || !isValidEmail(email)) fieldErrors.email = "Enter a valid e-mail address.";
  if (phone && !isPlausiblePhone(phone)) fieldErrors.phone = "Enter a phone number with at least 8 digits.";
  if (!message) fieldErrors.message = "Tell us a little about what you need.";
  else if (tooLong(message, MAX.request)) fieldErrors.message = `Keep this under ${MAX.request} characters.`;
  if (fd.get("consent") !== "1") fieldErrors.consent = "Please agree to be contacted.";
  if (Object.keys(fieldErrors).length) return { fieldErrors, values: null };
  return { fieldErrors, values: { full_name: full_name!, email: email!.toLowerCase(), phone, message: message! } };
}

export const PUBLIC_REF_RE = /^BB-[A-HJ-NP-Z2-9]{6}$/;

export function isPublicRef(v: unknown): v is string {
  return typeof v === "string" && PUBLIC_REF_RE.test(v);
}

/** Human summary lines for the review step and the owner's Telegram notice. */
export function summarizePublicBooking(v: PublicBookingValues, services: PublicServiceOption[]): Array<[string, string]> {
  const rows: Array<[string, string]> = [["Booking", BOOKING_TYPE_LABEL[v.booking_type]]];
  const service = v.service_id ? services.find((s) => s.id === v.service_id) : null;
  if (service) rows.push(["Package", service.name]);
  const d = v.details;
  if (v.booking_type === "club") {
    rows.push(["Club", v.club_name ?? "—"]);
    if (d.athlete_count) rows.push(["Athletes", String(d.athlete_count)]);
    rows.push(["Needs", [d.wants_photographer && "Photographer", d.wants_videographer && "Videographer"].filter(Boolean).join(" + ") || "—"]);
  } else if (v.athlete_name !== v.full_name) rows.push(["Athlete", v.athlete_name]);
  if (d.event_name) rows.push(["Event", d.event_name]);
  if (d.competition_date) rows.push(["Date", d.competition_date]);
  if (d.academy) rows.push(["Academy", d.academy]);
  const division = composeDivision(d.age_division ?? null, d.weight_division ?? null);
  if (division) rows.push(["Division", division]);
  if (d.belt) rows.push(["Belt", d.belt]);
  if (d.gi) rows.push(["Style", d.gi === "both" ? "Gi and No-Gi" : d.gi === "gi" ? "Gi" : "No-Gi"]);
  if (d.coverage) rows.push(["Coverage", d.coverage === "both" ? "Photos and video" : d.coverage === "photo" ? "Photos" : "Video"]);
  if (d.requested_date) rows.push(["Preferred date", d.requested_time ? `${d.requested_date} ${d.requested_time}` : d.requested_date]);
  if (d.location_preference) rows.push(["Where", d.location_preference]);
  if (d.request) rows.push(["Request", d.request]);
  rows.push(["Name", v.full_name], ["Phone", v.phone], ["E-mail", v.email]);
  if (v.instagram) rows.push(["Instagram", `@${v.instagram}`]);
  if (d.notes) rows.push(["Notes", d.notes]);
  return rows;
}
