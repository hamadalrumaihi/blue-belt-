/**
 * Public booking wizard: one definition of the fields per booking type,
 * shared by the UI (which renders the steps) and the server action (which
 * parses the submitted FormData). Pure: no I/O, no server-only imports, so it
 * is unit-tested directly and safe to import from a client component.
 */
import type { BookingType, ClientType, UsageType } from "@/lib/supabase/database.types";
import { BOOKING_TYPE_LABEL, isBookingType, type BookingDetails } from "@/lib/bookings/state";
import { normalizeInstagram, phoneKey } from "@/lib/people/match";
import { isValidEmail, isValidHttpUrl, trimOrNull } from "@/lib/utils";
import { isUuid, isValidCalendarDate } from "@/lib/validation";

export const MAX = { name: 120, short: 200, url: 2048, notes: 2000, request: 3000, phone: 30, email: 254, athleteCount: 500 } as const;

export type FieldKind = "text" | "email" | "tel" | "date" | "time" | "number" | "url" | "textarea" | "select" | "radio" | "checkbox" | "consent" | "event" | "service";

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
  /** Rendered and validated only while another field holds this value. */
  showWhen?: { field: string; value: string };
  /** For "consent": the sentence next to the checkbox. `label` stays the short name used in error summaries. */
  text?: string;
};

export type StepKey = "details" | "contact" | "legal";
export type PublicStep = { key: StepKey; title: string; intro: string; fields: PublicField[] };

export type PublicEventOption = { id: string; name: string; event_date: string | null };
export type PublicServiceOption = { id: string; name: string; booking_type: BookingType; price_qr: number | null; currency: string; description?: string | null };

/** What the home and services pages show per booking type, in display order. */
export const PUBLIC_BOOKING_TYPES: Array<{ value: BookingType; title: string; body: string }> = [
  { value: "tournament_athlete", title: BOOKING_TYPE_LABEL.tournament_athlete, body: "Your matches photographed or filmed at a competition. Book for yourself, your child or an athlete you coach." },
  { value: "club", title: BOOKING_TYPE_LABEL.club, body: "Coverage for a whole academy or team at an event. We send a quote for the day." },
  { value: "training_session", title: BOOKING_TYPE_LABEL.training_session, body: "Photos or video at your academy during a regular class or open mat." },
  { value: "private_session", title: BOOKING_TYPE_LABEL.private_session, body: "A dedicated session for one athlete: portraits, technique, sponsorship material." },
  { value: "custom", title: BOOKING_TYPE_LABEL.custom, body: "Seminars, grading days, promotions or anything else. Tell us what you have in mind." },
];

/**
 * What the wizard's first step offers. Each choice maps onto the existing
 * booking_type enum (the lifecycle, pricing and dashboards key off it) and is
 * kept verbatim in `details.service_kind`.
 */
export const SERVICE_KINDS = [
  { value: "tournament_athlete_photo", booking_type: "tournament_athlete", title: "Tournament athlete photography", body: "Your matches photographed at a competition. For yourself, your child or an athlete you coach." },
  { value: "tournament_athlete_photo_video", booking_type: "tournament_athlete", title: "Photography and video", body: "Your matches photographed and filmed at a competition." },
  { value: "event_coverage", booking_type: "custom", title: "Tournament or event coverage", body: "Coverage of a whole competition, seminar or grading for the organiser. Quoted per event." },
  { value: "club_team_coverage", booking_type: "club", title: "Club or team coverage", body: "Coverage for a whole academy or team at an event. Quoted per day." },
  { value: "training_coverage", booking_type: "training_session", title: "Training coverage", body: "Photos or video at your academy during a class, open mat or sparring round." },
  { value: "athlete_portrait", booking_type: "private_session", title: "Fighter or athlete portrait session", body: "A dedicated portrait shoot for one athlete: profile, sponsor and media images." },
  { value: "private_session", booking_type: "private_session", title: "Private session", body: "A private photo or video session planned around you: technique, a drill, a story." },
  { value: "custom", booking_type: "custom", title: "Custom request", body: "Something else. Describe it and we come back with a plan and a quote." },
] as const satisfies ReadonlyArray<{ value: string; booking_type: BookingType; title: string; body: string }>;

export type ServiceKind = (typeof SERVICE_KINDS)[number]["value"];

export function isServiceKind(v: unknown): v is ServiceKind {
  return typeof v === "string" && SERVICE_KINDS.some((k) => k.value === v);
}

export function serviceKindInfo(kind: ServiceKind): (typeof SERVICE_KINDS)[number] {
  return SERVICE_KINDS.find((k) => k.value === kind)!;
}

/** The first choice offered for a booking type (used by `/book?type=` links). */
export function defaultServiceKind(type: BookingType): ServiceKind {
  return SERVICE_KINDS.find((k) => k.booking_type === type)!.value;
}

export const CLIENT_TYPES = ["individual", "parent_guardian", "club_team", "company_brand", "event_organiser"] as const satisfies readonly ClientType[];
export const CLIENT_TYPE_LABEL: Record<ClientType, string> = {
  individual: "Myself",
  parent_guardian: "Parent or guardian",
  club_team: "Club or team",
  company_brand: "Company or brand",
  event_organiser: "Event organiser",
};
export function isClientType(v: unknown): v is ClientType {
  return typeof v === "string" && (CLIENT_TYPES as readonly string[]).includes(v);
}

export const USAGE_TYPES = ["personal", "club_team", "commercial"] as const satisfies readonly UsageType[];
export const USAGE_TYPE_LABEL: Record<UsageType, string> = {
  personal: "Personal",
  club_team: "Club or team",
  commercial: "Brand or commercial",
};
export function isUsageType(v: unknown): v is UsageType {
  return typeof v === "string" && (USAGE_TYPES as readonly string[]).includes(v);
}

export const BELT_OPTIONS = ["White", "Grey", "Yellow", "Orange", "Green", "Blue", "Purple", "Brown", "Black"].map((b) => ({ value: b.toLowerCase(), label: b }));

/**
 * Honeypot. Browsers autofill by field name and label, so the name must look
 * like nothing an address book holds; the UI also sets tabindex -1,
 * aria-hidden and moves it off screen. When it trips, the visitor gets a
 * clear message instead of a generic failure.
 */
export const HONEYPOT_FIELD = "extra_notes_check";
export const HONEYPOT_ERROR = "The form could not be sent because a hidden spam check was filled in. If your browser auto-filled the form, reload the page and try again.";

const CONTACT_BASE: PublicField[] = [
  { name: "full_name", label: "Your name", kind: "text", required: true, max: MAX.name, autoComplete: "name" },
  { name: "phone", label: "Phone / WhatsApp", kind: "tel", required: true, max: MAX.phone, inputMode: "tel", autoComplete: "tel", placeholder: "+974 5555 1234", hint: "With the country code. We confirm bookings by WhatsApp or phone." },
  { name: "email", label: "E-mail", kind: "email", required: true, max: MAX.email, inputMode: "email", autoComplete: "email", hint: "Your booking reference, agreement and gallery link are sent here." },
  { name: "instagram", label: "Instagram", kind: "text", max: 60, placeholder: "@handle", hint: "Optional. Handy for tagging you when the gallery is out." },
];

const CLIENT_TYPE_FIELD: PublicField = {
  name: "client_type",
  label: "Who is booking?",
  kind: "radio",
  required: true,
  options: CLIENT_TYPES.map((value) => ({ value, label: CLIENT_TYPE_LABEL[value] })),
};

const USAGE_FIELD: PublicField = {
  name: "usage_type",
  label: "How will the photos and video be used?",
  kind: "radio",
  required: true,
  options: USAGE_TYPES.map((value) => ({ value, label: USAGE_TYPE_LABEL[value] })),
  hint: "Brand or commercial use needs a separate licence. We include it in the quote.",
};

const MINOR_FIELDS: PublicField[] = [
  {
    name: "subject_is_minor",
    label: "Is the athlete or subject under 18?",
    kind: "radio",
    required: true,
    options: [
      { value: "no", label: "No" },
      { value: "yes", label: "Yes" },
    ],
  },
  { name: "guardian_name", label: "Parent or guardian's full name", kind: "text", required: true, max: MAX.name, autoComplete: "off", showWhen: { field: "subject_is_minor", value: "yes" } },
  { name: "guardian_email", label: "Parent or guardian's e-mail", kind: "email", required: true, max: MAX.email, inputMode: "email", autoComplete: "off", showWhen: { field: "subject_is_minor", value: "yes" }, hint: "The guardian release is sent here for signature." },
  { name: "guardian_phone", label: "Parent or guardian's phone / WhatsApp", kind: "tel", required: true, max: MAX.phone, inputMode: "tel", autoComplete: "off", placeholder: "+974 5555 1234", showWhen: { field: "subject_is_minor", value: "yes" } },
  {
    name: "guardian_consent",
    label: "Guardian consent",
    kind: "consent",
    required: true,
    showWhen: { field: "subject_is_minor", value: "yes" },
    text: "I am the parent or legal guardian of the athlete named above, or I am booking with that guardian's permission, and I consent to the athlete being photographed and filmed under this booking.",
  },
];

/** Shown on the review step. None is pre-selected. */
export const LEGAL_FIELDS: PublicField[] = [
  { name: "accept_terms", label: "Photography terms", kind: "consent", required: true, text: "I have read and agree to the photography terms." },
  { name: "accept_privacy", label: "Privacy policy", kind: "consent", required: true, text: "I have read the privacy policy and agree to my details being used as described there." },
  {
    name: "consent_media",
    label: "Media consent",
    kind: "consent",
    required: true,
    text: "I consent to being photographed and filmed under this booking. Where I book for someone else, I confirm they have agreed, and where they are under 18, that their parent or guardian has agreed.",
  },
];

const NOTES: PublicField = { name: "notes", label: "Anything else we should know?", kind: "textarea", max: MAX.notes, placeholder: "Mat preferences, timing, special requests" };
const ACADEMY: PublicField = { name: "academy", label: "Academy / team", kind: "text", max: MAX.short, autoComplete: "organization" };
const VENUE: PublicField = { name: "location", label: "Venue / location", kind: "text", max: MAX.short, placeholder: "Hall or venue name, area", hint: "If you know it." };
const SERVICE: PublicField = { name: "service_id", label: "Package", kind: "service", hint: "Prices are confirmed with you before you sign and pay the deposit." };

function contactStep(type: BookingType): PublicStep {
  const club = type === "club";
  return {
    key: "contact",
    title: club ? "Who should we talk to?" : "About you",
    intro: club ? "The coach or team manager who will receive the quote and sign the agreement." : "How to reach you, and who the booking is for.",
    fields: [
      CLIENT_TYPE_FIELD,
      ...(club ? [{ ...CONTACT_BASE[0], label: "Contact name" }, CONTACT_BASE[1], CONTACT_BASE[2], { ...CONTACT_BASE[3], label: "Club Instagram", hint: "Optional." }] : CONTACT_BASE),
      USAGE_FIELD,
      ...(club ? [] : MINOR_FIELDS),
    ],
  };
}

const LEGAL_STEP: PublicStep = { key: "legal", title: "Agree and send", intro: "Read and tick each box. Nothing is pre-selected.", fields: LEGAL_FIELDS };

/** The wizard's details, contact and legal steps for one booking type. */
export function publicBookingFields(type: BookingType): PublicStep[] {
  switch (type) {
    case "tournament_athlete":
      return [
        {
          key: "details",
          title: "The competition",
          intro: "Tell us who is competing and where. We match the athlete on the day from the bracket.",
          fields: [
            { name: "athlete_name", label: "Athlete's full name", kind: "text", max: MAX.name, hint: "As registered with the organiser. Leave empty if it is you.", autoComplete: "off" },
            ACADEMY,
            { name: "event", label: "Competition", kind: "event", required: true, hint: "Pick an event we are covering, or type the name if it is not listed." },
            { name: "competition_date", label: "Competition date", kind: "date", hint: "If you know it. Leave empty when you picked a listed event." },
            VENUE,
            { name: "age_division", label: "Age division", kind: "text", max: 60, placeholder: "Adult, Master 1, Juvenile" },
            { name: "belt", label: "Belt", kind: "select", options: BELT_OPTIONS },
            { name: "weight_division", label: "Weight division", kind: "text", max: 60, placeholder: "-77 kg, Light feather" },
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
            SERVICE,
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
            { name: "source_url", label: "AJP / Smoothcomp profile or bracket link", kind: "url", max: MAX.url, inputMode: "url", placeholder: "https://", hint: "Optional, but it helps us find the right mat and time." },
            NOTES,
          ],
        },
        contactStep(type),
        LEGAL_STEP,
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
            VENUE,
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
        contactStep(type),
        LEGAL_STEP,
      ];
    case "training_session":
    case "private_session":
      return [
        {
          key: "details",
          title: type === "training_session" ? "The session" : "Your session",
          intro: type === "training_session" ? "Photos or video during a class, open mat or sparring round." : "A dedicated shoot for one athlete: portraits, technique or sponsor material.",
          fields: [
            SERVICE,
            { name: "event_name", label: "Session name or purpose", kind: "text", max: MAX.short, placeholder: "Competition prep, sponsor shoot, belt promotion", hint: "Optional." },
            { name: "requested_date", label: "Preferred date", kind: "date", required: true },
            { name: "requested_time", label: "Preferred time", kind: "time", hint: "Optional. We confirm the exact slot with you." },
            { name: "location_preference", label: "Where?", kind: "text", max: MAX.short, placeholder: "Your academy, outdoor, our studio", hint: "Academy name or area in Doha." },
            ACADEMY,
            { name: "athlete_name", label: "Athlete's name (if not you)", kind: "text", max: MAX.name, autoComplete: "off" },
            NOTES,
          ],
        },
        contactStep(type),
        LEGAL_STEP,
      ];
    case "custom":
      return [
        {
          key: "details",
          title: "What do you have in mind?",
          intro: "Event coverage, seminars, gradings, promotions, documentary pieces: describe it and we will come back with a plan and a quote.",
          fields: [
            { name: "request", label: "Describe the coverage you need", kind: "textarea", required: true, max: MAX.request, placeholder: "What, where, when, and for whom." },
            { name: "event_name", label: "Event or session name", kind: "text", max: MAX.short, hint: "If it has one." },
            { name: "requested_date", label: "Date (if known)", kind: "date" },
            { name: "requested_time", label: "Start time (if known)", kind: "time" },
            { name: "location_preference", label: "Venue / location (if known)", kind: "text", max: MAX.short },
            { ...ACADEMY, label: "Club / organisation" },
            { name: "athlete_name", label: "Athlete's name (if this is about one athlete)", kind: "text", max: MAX.name, autoComplete: "off" },
          ],
        },
        contactStep(type),
        LEGAL_STEP,
      ];
  }
}

/** Every field name the wizard may submit, for the review step and tests. */
export function publicBookingFieldNames(type: BookingType): string[] {
  return publicBookingFields(type).flatMap((s) => s.fields.flatMap((f) => (f.kind === "event" ? ["event_id", "event_name"] : f.kind === "checkbox" ? (f.options ?? []).map((o) => o.value) : [f.name])));
}

/** Which wizard step (1 = details, 2 = contact, 3 = review/legal) holds a field, for jumping to server errors. */
export function stepIndexForField(type: BookingType, name: string): number | null {
  const steps = publicBookingFields(type);
  const idx = steps.findIndex((s) => s.fields.some((f) => fieldInputNames(f).includes(name)));
  return idx >= 0 ? idx + 1 : null;
}

export function fieldInputNames(f: PublicField): string[] {
  if (f.kind === "event") return ["event_id", "event_name"];
  if (f.kind === "checkbox") return [f.name, ...(f.options ?? []).map((o) => o.value)];
  return [f.name];
}

/** True when a conditional field is currently shown for these values. */
export function fieldVisible(f: PublicField, values: Record<string, string | null | undefined>): boolean {
  return !f.showWhen || values[f.showWhen.field] === f.showWhen.value;
}

/** photo_bookings.details for a website booking: the shared shape plus a few public-only keys. */
export type PublicBookingDetails = BookingDetails & {
  service_kind?: ServiceKind;
  event_name?: string;
  club_name?: string;
  location?: string;
  location_preference?: string;
  request?: string;
  notes?: string;
};

export type GuardianValues = { name: string; email: string; phone: string };

export type PublicBookingValues = {
  booking_type: BookingType;
  service_kind: ServiceKind;
  client_type: ClientType;
  usage_type: UsageType;
  subject_is_minor: boolean;
  guardian: GuardianValues | null;
  /** Every consent box was ticked (the parser rejects otherwise); guardian only when a minor. */
  consents: { terms: true; privacy: true; media: true; guardian: boolean };
  /** Generated once per wizard session; makes a retried submit land on the same booking. */
  idempotency_key: string;
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
  location: string | null;
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

/** Per-field messages readable next to the input and in the summary. */
export const MESSAGES = {
  required: "Required.",
  pickOne: "Pick one of the options.",
  pickAtLeastOne: "Pick at least one.",
  consent: "Please tick this box to continue.",
  email: "Enter a valid e-mail address.",
  phone: "Enter a phone number with at least 8 digits.",
  date: "Enter a real date.",
  past: "That date has already passed.",
  time: "Use 24-hour time, e.g. 18:30.",
  url: "Enter a full link starting with https://",
  service: "Choose what you would like to book.",
  reload: "Please reload the page and try again.",
} as const;

/** Validates one simple field value; null when fine. Shared by the wizard's step validation and the server parser. */
export function validateFieldValue(field: PublicField, v: string, today: string): string | null {
  if (field.max && tooLong(v, field.max)) return `Keep this under ${field.max} characters.`;
  switch (field.kind) {
    case "email":
      return isValidEmail(v) ? null : MESSAGES.email;
    case "tel":
      return isPlausiblePhone(v) ? null : MESSAGES.phone;
    case "date":
      if (!isValidCalendarDate(v)) return MESSAGES.date;
      return v < today ? MESSAGES.past : null;
    case "time":
      return isValidTime(v) ? null : MESSAGES.time;
    case "number": {
      const n = Number(v);
      return Number.isInteger(n) && n >= 1 && n <= MAX.athleteCount ? null : `Enter a whole number between 1 and ${MAX.athleteCount}.`;
    }
    case "url":
      return isValidHttpUrl(v) ? null : MESSAGES.url;
    case "select":
    case "radio":
      return (field.options ?? []).some((o) => o.value === v) ? null : MESSAGES.pickOne;
    default:
      return null;
  }
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
  if (str(fd, HONEYPOT_FIELD)) return { fieldErrors: { [HONEYPOT_FIELD]: HONEYPOT_ERROR }, values: null };

  const kindRaw = str(fd, "service_kind");
  const typeRaw = str(fd, "booking_type");
  if (!isServiceKind(kindRaw)) return { fieldErrors: { service_kind: MESSAGES.service }, values: null };
  const kind = serviceKindInfo(kindRaw);
  // The booking type travels too (older links, tests); it must agree with the service kind.
  if (typeRaw && (!isBookingType(typeRaw) || typeRaw !== kind.booking_type)) return { fieldErrors: { booking_type: MESSAGES.service }, values: null };
  const type = kind.booking_type;

  const idempotencyKey = str(fd, "idempotency_key");
  if (!isUuid(idempotencyKey)) fieldErrors.idempotency_key = MESSAGES.reload;

  const steps = publicBookingFields(type);
  const raw: Record<string, string | null> = {};

  for (const field of steps.flatMap((s) => s.fields)) {
    if (!fieldVisible(field, raw)) {
      raw[field.name] = null;
      continue;
    }
    if (field.kind === "checkbox") {
      let any = false;
      for (const opt of field.options ?? []) {
        const on = fd.get(opt.value) === "1";
        raw[opt.value] = on ? "1" : null;
        if (on) any = true;
      }
      if (field.required && !any) fieldErrors[field.name] = MESSAGES.pickAtLeastOne;
      continue;
    }
    if (field.kind === "consent") {
      const on = fd.get(field.name) === "1";
      raw[field.name] = on ? "1" : null;
      if (field.required && !on) fieldErrors[field.name] = MESSAGES.consent;
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
      if (field.required) fieldErrors[field.name] = MESSAGES.required;
      continue;
    }
    const problem = validateFieldValue(field, v, today);
    if (problem) fieldErrors[field.name] = problem;
  }

  // Instagram is normalised, never rejected: a bad handle just drops.
  const instagram = normalizeInstagram(raw.instagram);
  if (type === "tournament_athlete" && raw.client_type && raw.client_type !== "individual" && !raw.athlete_name && !fieldErrors.athlete_name) fieldErrors.athlete_name = "Enter the athlete's name.";

  if (Object.keys(fieldErrors).length) return { fieldErrors, values: null };

  const fullName = raw.full_name!;
  const clientType = raw.client_type as ClientType;
  const usageType = raw.usage_type as UsageType;
  const isMinor = raw.subject_is_minor === "yes";
  const athleteName = type === "club" ? fullName : raw.athlete_name ?? fullName;
  const details: PublicBookingDetails = { service_kind: kind.value };
  if (instagram) details.instagram = instagram;
  if (type === "tournament_athlete") {
    details.booked_for = clientType === "individual" ? "self" : clientType === "parent_guardian" ? "child" : "athlete";
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
    if (raw.academy) details.academy = raw.academy;
  }
  if (raw.location) details.location = raw.location;
  if (raw.event_name) details.event_name = raw.event_name;
  if (raw.notes) details.notes = raw.notes;

  return {
    fieldErrors,
    values: {
      booking_type: type,
      service_kind: kind.value,
      client_type: clientType,
      usage_type: usageType,
      subject_is_minor: isMinor,
      guardian: isMinor ? { name: raw.guardian_name!, email: raw.guardian_email!.toLowerCase(), phone: raw.guardian_phone! } : null,
      consents: { terms: true, privacy: true, media: true, guardian: isMinor },
      idempotency_key: idempotencyKey!,
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
      location: raw.location ?? raw.location_preference ?? null,
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
  if (str(fd, HONEYPOT_FIELD)) return { fieldErrors: { [HONEYPOT_FIELD]: HONEYPOT_ERROR }, values: null };
  const fieldErrors: Record<string, string> = {};
  const full_name = str(fd, "full_name");
  const email = str(fd, "email");
  const phone = str(fd, "phone");
  const message = str(fd, "message");
  if (!full_name) fieldErrors.full_name = MESSAGES.required;
  else if (tooLong(full_name, MAX.name)) fieldErrors.full_name = `Keep this under ${MAX.name} characters.`;
  if (!email) fieldErrors.email = MESSAGES.required;
  else if (tooLong(email, MAX.email) || !isValidEmail(email)) fieldErrors.email = MESSAGES.email;
  if (phone && !isPlausiblePhone(phone)) fieldErrors.phone = MESSAGES.phone;
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
  const rows: Array<[string, string]> = [["Booking", BOOKING_TYPE_LABEL[v.booking_type]], ["Service", serviceKindInfo(v.service_kind).title]];
  const service = v.service_id ? services.find((s) => s.id === v.service_id) : null;
  if (service) rows.push(["Package", service.name]);
  const d = v.details;
  if (v.booking_type === "club") {
    rows.push(["Club", v.club_name ?? "Not given"]);
    if (d.athlete_count) rows.push(["Athletes", String(d.athlete_count)]);
    rows.push(["Needs", [d.wants_photographer && "Photographer", d.wants_videographer && "Videographer"].filter(Boolean).join(" + ") || "Not given"]);
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
  if (d.location) rows.push(["Venue", d.location]);
  if (d.location_preference) rows.push(["Where", d.location_preference]);
  if (d.request) rows.push(["Request", d.request]);
  rows.push(["Booked by", CLIENT_TYPE_LABEL[v.client_type]], ["Use", USAGE_TYPE_LABEL[v.usage_type]]);
  if (v.subject_is_minor) rows.push(["Under 18", v.guardian ? `Yes, guardian ${v.guardian.name}` : "Yes"]);
  rows.push(["Name", v.full_name], ["Phone", v.phone], ["E-mail", v.email]);
  if (v.instagram) rows.push(["Instagram", `@${v.instagram}`]);
  if (d.notes) rows.push(["Notes", d.notes]);
  return rows;
}
