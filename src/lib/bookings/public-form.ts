/**
 * Public request wizard: ONE definition of the steps and fields per catalog
 * service, shared by the UI (which renders the steps) and the server action
 * (which parses the submitted FormData). Driven by `src/lib/catalog`
 * (service × media scope × video deliverables); every choice still maps onto
 * the existing `booking_type` enum and the legacy `service_kind` value so
 * dashboards, pricing and old links keep working.
 *
 * Pure: no I/O, no server-only imports, so it is unit-tested directly and
 * safe to import from a client component.
 */
import {
  AUDIENCE_SERVICES,
  LEGACY_SERVICE_KIND,
  SERVICES,
  SERVICE_DEFINITIONS,
  isAudienceKey,
  isMediaScope,
  isServiceKey,
  isVideoDeliverable,
  resolveEntryService,
  serviceForBookingType,
  type AudienceKey,
  type MediaScope,
  type ServiceDefinition,
  type ServiceKey,
  type VideoDeliverable,
} from "@/lib/catalog";
import { BOOKING_TYPE_LABEL, isBookingType, type BookingDetails } from "@/lib/bookings/state";
import { normalizeInstagram, phoneKey } from "@/lib/people/match";
import { bookableAmount, publicPrice } from "@/lib/services/pricing";
import { publicServiceDescription } from "@/lib/services/public";
import type { BookingType, ClientType, PhotoServiceRow, UsageType } from "@/lib/supabase/database.types";
import { isValidEmail, isValidHttpUrl, trimOrNull } from "@/lib/utils";
import { isUuid, isValidCalendarDate } from "@/lib/validation";

export const MAX = { name: 120, short: 200, url: 2048, notes: 2000, request: 3000, phone: 30, email: 254, athleteCount: 500, hours: 48, budgetQr: 1_000_000 } as const;

export type FieldKind = "text" | "email" | "tel" | "date" | "time" | "number" | "url" | "textarea" | "select" | "radio" | "checkbox" | "consent" | "event" | "service" | "catalog" | "budget";

export type PublicField = {
  name: string;
  label: string;
  kind: FieldKind;
  required?: boolean;
  options?: Array<{ value: string; label: string; hint?: string }>;
  hint?: string;
  placeholder?: string;
  max?: number;
  /** For "number": the accepted whole-number range (defaults to 1..MAX.athleteCount). */
  numeric?: { min: number; max: number };
  inputMode?: "text" | "tel" | "email" | "numeric" | "url";
  autoComplete?: string;
  /** Rendered and validated only while another field holds one of these values. */
  showWhen?: { field: string; value: string | readonly string[] };
  /** For "consent": the sentence next to the checkbox. `label` stays the short name used in error summaries. */
  text?: string;
};

export type StepKey = "what" | "details" | "contact" | "legal";
export type PublicStep = { key: StepKey; title: string; intro: string; fields: PublicField[] };

export type PublicEventOption = { id: string; name: string; event_date: string | null };
/**
 * A package as the public wizard sees it: no raw price. `price_label` is
 * what the website shows ("from 350 QAR", "Quote on request") and `quote`
 * is the booking decision (`bookableAmount`), so a quote-mode package never
 * leaks its number to the browser or into a booking row.
 */
export type PublicServiceOption = { id: string; name: string; booking_type: BookingType; price_label: string; quote: boolean; description?: string | null };

/** Projects a photo_services row for the wizard: price through publicPrice / bookableAmount, description through the placeholder guard. */
export function toPublicServiceOption(row: Pick<PhotoServiceRow, "id" | "name" | "booking_type" | "price_qr" | "price_mode" | "description">): PublicServiceOption {
  const quote = bookableAmount(row, { quoteFirst: serviceForBookingType(row.booking_type).quoteFirst }).quoteOnly;
  return { id: row.id, name: row.name, booking_type: row.booking_type, price_label: quote ? "Quote on request" : publicPrice(row).label, quote, description: publicServiceDescription(row.description) };
}

/** What the home and services pages show per booking type, in display order (kept for pages that still key off the enum). */
export const PUBLIC_BOOKING_TYPES: Array<{ value: BookingType; title: string; body: string }> = [
  { value: "tournament_athlete", title: BOOKING_TYPE_LABEL.tournament_athlete, body: "Your matches photographed or filmed at a competition. Book for yourself, your child or an athlete you coach." },
  { value: "club", title: BOOKING_TYPE_LABEL.club, body: "Coverage for a whole academy or team at an event. We send a quote for the day." },
  { value: "training_session", title: BOOKING_TYPE_LABEL.training_session, body: "Photos or video at your academy during a regular class or open mat." },
  { value: "private_session", title: BOOKING_TYPE_LABEL.private_session, body: "A dedicated session for one athlete: portraits, technique, sponsorship material." },
  { value: "custom", title: BOOKING_TYPE_LABEL.custom, body: "Seminars, grading days, promotions or anything else. Tell us what you have in mind." },
];

/**
 * Legacy wizard choices (`details.service_kind`, `/book?kind=`). Still
 * accepted on input and still written to `details.service_kind` so older
 * records, dashboards and links keep their meaning. New submissions choose a
 * catalog service + media scope instead; see `legacyServiceKind()`.
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

/** The first legacy choice offered for a booking type (used by `/book?type=` links). */
export function defaultServiceKind(type: BookingType): ServiceKind {
  return SERVICE_KINDS.find((k) => k.booking_type === type)!.value;
}

/**
 * The closest legacy `service_kind` for a catalog choice. A legacy kind the
 * visitor arrived with (`?kind=`) is kept verbatim when it still names the
 * same service, so old links round-trip exactly.
 */
export function legacyServiceKind(service: ServiceKey, media: MediaScope | null, hint?: string | null): ServiceKind {
  if (isServiceKind(hint) && LEGACY_SERVICE_KIND[hint]?.service === service) return hint;
  switch (service) {
    case "tournament_athlete":
      return media === "video" || media === "photo_video" ? "tournament_athlete_photo_video" : "tournament_athlete_photo";
    case "team_tournament":
      return "club_team_coverage";
    case "training_content":
      return "training_coverage";
    case "athlete_portrait":
      return "athlete_portrait";
    case "organizer_custom":
      return "event_coverage";
  }
}

/** Wizard wording per catalog service (English; the public pages carry their own copy). */
export const SERVICE_LABEL: Record<ServiceKey, { title: string; body: string; detailsTitle: string; detailsIntro: string }> = {
  tournament_athlete: {
    title: "Tournament athlete coverage",
    body: "One athlete's matches at a competition: yourself, your child or an athlete you coach.",
    detailsTitle: "The competition",
    detailsIntro: "Tell us who is competing and where. Bracket, mat and times can come later; we match the athlete on the day from the organiser's bracket.",
  },
  team_tournament: {
    title: "Team or club at a tournament",
    body: "Coverage for a whole academy or team on a competition day. Quoted per day.",
    detailsTitle: "Your team",
    detailsIntro: "Team days are quoted individually: tell us the event and roughly how many athletes compete.",
  },
  training_content: {
    title: "Training and gym content",
    body: "Photos or video at your academy during a class, open mat or sparring round.",
    detailsTitle: "The session",
    detailsIntro: "When and where, and what the material is for.",
  },
  athlete_portrait: {
    title: "Athlete portraits and private sessions",
    body: "A dedicated session for one athlete: portraits, technique, sponsor or media material.",
    detailsTitle: "Your session",
    detailsIntro: "A dedicated shoot planned around one athlete.",
  },
  organizer_custom: {
    title: "Event and organiser coverage",
    body: "A whole competition, seminar, grading or promotion for the organiser. Quoted per event.",
    detailsTitle: "What do you have in mind?",
    detailsIntro: "Describe the coverage you need and we come back with a plan and a quote.",
  },
};

export const MEDIA_SCOPE_LABEL: Record<MediaScope, string> = { photo: "Photos", video: "Video", photo_video: "Photos and video" };
export const MEDIA_NOT_SURE = "not_sure";
export type MediaChoice = MediaScope | typeof MEDIA_NOT_SURE;

/** Labels for every deliverable a stored booking may carry; only the public ones are ever offered (raw footage was retired on 19 Oct 2026). */
export const VIDEO_DELIVERABLE_LABEL: Record<VideoDeliverable, { label: string; hint: string }> = {
  full_match: { label: "Full matches", hint: "Each match filmed start to finish, delivered as an edited file." },
  edited_highlights: { label: "Edited highlights", hint: "A cut of the best moments." },
  reels: { label: "Short clips for social media", hint: "Vertical clips ready to post." },
  raw_footage: { label: "Raw footage (no longer offered)", hint: "Retired: edited deliverables only." },
};
/** Input name of a video deliverable checkbox. */
export const videoFieldName = (d: VideoDeliverable | "not_sure"): string => `video_${d}`;

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
const SERVICE: PublicField = { name: "service_id", label: "Package", kind: "service", hint: "Optional. Prices are confirmed with you before you sign and pay the deposit." };
const COVERAGE_HOURS: PublicField = { name: "coverage_hours", label: "Coverage duration, if known (hours)", kind: "number", inputMode: "numeric", numeric: { min: 1, max: MAX.hours }, placeholder: "4", hint: "Leave empty if you are not sure." };
const DEADLINE: PublicField = { name: "deadline", label: "Do you need the files by a date?", kind: "date", hint: "Optional. We tell you what is realistic before you confirm." };
const ACCESS_NOTES: PublicField = { name: "access_notes", label: "Special access or privacy needs", kind: "textarea", max: MAX.notes, placeholder: "Accreditation, restricted areas, athletes who must not be published, female-only sessions", hint: "Optional." };
const BUDGET: PublicField = { name: "budget", label: "Budget (QAR)", kind: "budget", numeric: { min: 1, max: MAX.budgetQr }, hint: "Optional. A rough figure helps us propose the right coverage; tick \"Not sure\" if you would rather hear a quote first." };
const ATHLETE_COUNT_OPTIONAL: PublicField = { name: "athlete_count", label: "How many athletes or people?", kind: "number", inputMode: "numeric", numeric: { min: 1, max: MAX.athleteCount }, placeholder: "6", hint: "Optional. A rough number is fine." };

function whatStep(def: ServiceDefinition): PublicStep {
  return {
    key: "what",
    title: "What do you need?",
    intro: "Pick the service, then photos, video or both.",
    fields: [
      { name: "service_key", label: "Service", kind: "catalog", required: true, options: SERVICES.map((k) => ({ value: k, label: SERVICE_LABEL[k].title, hint: SERVICE_LABEL[k].body })) },
      {
        name: "media_scope",
        label: "Photos, video or both?",
        kind: "radio",
        required: true,
        options: [...def.mediaScopes.map((m) => ({ value: m, label: MEDIA_SCOPE_LABEL[m] })), { value: MEDIA_NOT_SURE, label: "Not sure yet" }],
      },
      {
        name: "video_deliverables",
        label: "What should the video be?",
        kind: "checkbox",
        showWhen: { field: "media_scope", value: ["video", "photo_video"] },
        options: [...def.videoDeliverables.map((d) => ({ value: videoFieldName(d), label: VIDEO_DELIVERABLE_LABEL[d].label, hint: VIDEO_DELIVERABLE_LABEL[d].hint })), { value: videoFieldName("not_sure"), label: "Not sure, advise me" }],
        hint: "Tick everything you want. Each is priced and delivered separately; nothing is implied.",
      },
      SERVICE,
    ],
  };
}

function contactStep(def: ServiceDefinition): PublicStep {
  const club = def.bookingType === "club";
  return {
    key: "contact",
    title: club ? "Who should we talk to?" : "About you",
    intro: club ? "The coach or team manager who will receive the quote and sign the agreement." : "How to reach you, and who the booking is for.",
    fields: [
      CLIENT_TYPE_FIELD,
      ...(club ? [{ ...CONTACT_BASE[0], label: "Contact name" }, CONTACT_BASE[1], CONTACT_BASE[2], { ...CONTACT_BASE[3], label: "Club Instagram", hint: "Optional." }] : CONTACT_BASE),
      ...(club ? [] : MINOR_FIELDS),
    ],
  };
}

const LEGAL_STEP: PublicStep = { key: "legal", title: "Agree and send", intro: "Read and tick each box. Nothing is pre-selected.", fields: LEGAL_FIELDS };

function detailFields(service: ServiceKey): PublicField[] {
  switch (service) {
    case "tournament_athlete":
      return [
        { name: "athlete_name", label: "Athlete's full name", kind: "text", max: MAX.name, hint: "As registered with the organiser. Leave empty if it is you.", autoComplete: "off" },
        ACADEMY,
        { name: "event", label: "Competition", kind: "event", required: true, hint: "Pick an event we are covering, or type the name if it is not listed." },
        { name: "competition_date", label: "Competition date", kind: "date", hint: "If you know it. Leave empty when you picked a listed event." },
        VENUE,
        { name: "age_division", label: "Age division", kind: "text", max: 60, placeholder: "Adult, Master 1, Juvenile", hint: "Leave empty if the bracket is not out yet." },
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
        { name: "source_url", label: "AJP / Smoothcomp profile or bracket link", kind: "url", max: MAX.url, inputMode: "url", placeholder: "https://", hint: "Optional, but it helps us find the right mat and time." },
        DEADLINE,
        USAGE_FIELD,
        ACCESS_NOTES,
        BUDGET,
        NOTES,
      ];
    case "team_tournament":
      return [
        { name: "club_name", label: "Club / academy name", kind: "text", required: true, max: MAX.short, autoComplete: "organization" },
        { name: "event", label: "Tournament / event", kind: "event", required: true, hint: "Pick an event we are covering, or type the name." },
        { name: "competition_date", label: "Event date", kind: "date", hint: "If known." },
        VENUE,
        { name: "athlete_count", label: "How many athletes compete?", kind: "number", required: true, inputMode: "numeric", numeric: { min: 1, max: MAX.athleteCount }, placeholder: "12", hint: "A rough number is fine." },
        COVERAGE_HOURS,
        DEADLINE,
        USAGE_FIELD,
        ACCESS_NOTES,
        BUDGET,
        NOTES,
      ];
    case "training_content":
      return [
        { name: "event_name", label: "Session name or purpose", kind: "text", max: MAX.short, placeholder: "Competition prep, sponsor content, belt promotion", hint: "Optional." },
        { name: "requested_date", label: "Preferred date", kind: "date", required: true },
        { name: "requested_time", label: "Preferred time", kind: "time", hint: "Optional. We confirm the exact slot with you." },
        { name: "location_preference", label: "Where?", kind: "text", max: MAX.short, placeholder: "Your academy, outdoor, our studio", hint: "Academy name or area in Doha." },
        ACADEMY,
        ATHLETE_COUNT_OPTIONAL,
        COVERAGE_HOURS,
        DEADLINE,
        USAGE_FIELD,
        ACCESS_NOTES,
        BUDGET,
        NOTES,
      ];
    case "athlete_portrait":
      return [
        { name: "event_name", label: "Session purpose", kind: "text", max: MAX.short, placeholder: "Sponsor profile, competition portraits, technique", hint: "Optional." },
        { name: "requested_date", label: "Preferred date", kind: "date", required: true },
        { name: "requested_time", label: "Preferred time", kind: "time", hint: "Optional. We confirm the exact slot with you." },
        { name: "location_preference", label: "Where?", kind: "text", max: MAX.short, placeholder: "Your academy, outdoor, our studio", hint: "Academy name or area in Doha." },
        ACADEMY,
        { name: "athlete_name", label: "Athlete's name (if not you)", kind: "text", max: MAX.name, autoComplete: "off" },
        COVERAGE_HOURS,
        DEADLINE,
        USAGE_FIELD,
        ACCESS_NOTES,
        BUDGET,
        NOTES,
      ];
    case "organizer_custom":
      return [
        { name: "request", label: "Describe the coverage you need", kind: "textarea", required: true, max: MAX.request, placeholder: "What, where, when, and for whom." },
        { name: "event_name", label: "Event or session name", kind: "text", max: MAX.short, hint: "If it has one." },
        { name: "requested_date", label: "Date (if known)", kind: "date" },
        { name: "requested_time", label: "Start time (if known)", kind: "time" },
        { name: "location_preference", label: "Venue / location (if known)", kind: "text", max: MAX.short },
        { ...ACADEMY, label: "Club / organisation" },
        { ...ATHLETE_COUNT_OPTIONAL, label: "Expected athletes or participants" },
        COVERAGE_HOURS,
        DEADLINE,
        USAGE_FIELD,
        ACCESS_NOTES,
        BUDGET,
      ];
  }
}

/** The wizard's what, details, contact and legal steps for one catalog service. */
export function publicBookingFields(service: ServiceKey): PublicStep[] {
  const def = SERVICE_DEFINITIONS[service];
  const label = SERVICE_LABEL[service];
  return [whatStep(def), { key: "details", title: label.detailsTitle, intro: label.detailsIntro, fields: detailFields(service) }, contactStep(def), LEGAL_STEP];
}

/** Every field name the wizard may submit, for the review step and tests. */
export function publicBookingFieldNames(service: ServiceKey): string[] {
  return publicBookingFields(service).flatMap((s) => s.fields.flatMap(fieldInputNames));
}

/** Which wizard step (0 = what, 1 = details, 2 = contact, 3 = review/legal) holds a field, for jumping to errors. */
export function stepIndexForField(service: ServiceKey, name: string): number | null {
  const steps = publicBookingFields(service);
  const idx = steps.findIndex((s) => s.fields.some((f) => fieldInputNames(f).includes(name)));
  return idx >= 0 ? idx : null;
}

export function fieldInputNames(f: PublicField): string[] {
  if (f.kind === "event") return ["event_id", "event_name"];
  if (f.kind === "checkbox") return [...(f.options ?? []).map((o) => o.value)];
  if (f.kind === "budget") return ["budget_qr", "budget_unknown"];
  return [f.name];
}

/** True when a conditional field is currently shown for these values. */
export function fieldVisible(f: PublicField, values: Record<string, string | null | undefined>): boolean {
  if (!f.showWhen) return true;
  const v = values[f.showWhen.field];
  const wanted = f.showWhen.value;
  return typeof wanted === "string" ? v === wanted : typeof v === "string" && wanted.includes(v);
}

/** photo_bookings.details for a website booking: the shared shape plus the public-only keys. */
export type PublicBookingDetails = BookingDetails & {
  /** Legacy choice, kept for every record (dashboards, old links). */
  service_kind?: ServiceKind;
  /** Catalog choice (new records). */
  service_key?: ServiceKey;
  media_scope?: MediaChoice;
  video_deliverables?: VideoDeliverable[];
  video_deliverables_unknown?: true;
  budget_qr?: number;
  budget_unknown?: true;
  /** YYYY-MM-DD the files are wanted by (a request, not a promise). */
  deadline?: string;
  coverage_hours?: number;
  access_notes?: string;
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
  service_key: ServiceKey;
  /** Closest legacy kind (stored in details.service_kind). */
  service_kind: ServiceKind;
  media_scope: MediaChoice;
  video_deliverables: VideoDeliverable[];
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
  media: "Tell us whether you want photos, video or both, or pick \"Not sure yet\".",
  reload: "Please reload the page and try again.",
} as const;

function wholeNumber(v: string, range: { min: number; max: number }): string | null {
  const n = Number(v.replace(/,/g, ""));
  return Number.isInteger(n) && n >= range.min && n <= range.max ? null : `Enter a whole number between ${range.min.toLocaleString("en-QA")} and ${range.max.toLocaleString("en-QA")}.`;
}

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
    case "number":
      return wholeNumber(v, field.numeric ?? { min: 1, max: MAX.athleteCount });
    case "budget":
      return wholeNumber(v, field.numeric ?? { min: 1, max: MAX.budgetQr });
    case "url":
      return isValidHttpUrl(v) ? null : MESSAGES.url;
    case "select":
    case "radio":
      return (field.options ?? []).some((o) => o.value === v) ? null : MESSAGES.pickOne;
    default:
      return null;
  }
}

/** Resolves the submitted service: the catalog key, else a legacy kind, else a bare booking type. */
function resolveSubmittedService(fd: FormData): { def: ServiceDefinition; legacyKind: string | null; legacyMedia: MediaScope | null } | null {
  const key = str(fd, "service_key");
  const kind = str(fd, "service_kind");
  if (isServiceKey(key)) {
    const legacy = isServiceKind(kind) && LEGACY_SERVICE_KIND[kind]?.service === key ? kind : null;
    return { def: SERVICE_DEFINITIONS[key], legacyKind: legacy, legacyMedia: legacy ? LEGACY_SERVICE_KIND[legacy].media : null };
  }
  if (isServiceKind(kind)) {
    const m = LEGACY_SERVICE_KIND[kind];
    return { def: SERVICE_DEFINITIONS[m.service], legacyKind: kind, legacyMedia: m.media };
  }
  return null;
}

/** Legacy `coverage` radio values (photo / video / both) as a media scope. */
function mediaFromCoverage(v: string | null): MediaScope | null {
  return v === "photo" ? "photo" : v === "video" ? "video" : v === "both" ? "photo_video" : null;
}

function coverageFromMedia(m: MediaChoice): BookingDetails["coverage"] | undefined {
  return m === "photo" ? "photo" : m === "video" ? "video" : m === "photo_video" ? "both" : undefined;
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

  const resolved = resolveSubmittedService(fd);
  if (!resolved) return { fieldErrors: { service_key: MESSAGES.service }, values: null };
  const { def, legacyKind, legacyMedia } = resolved;
  const typeRaw = str(fd, "booking_type");
  // The booking type travels too (older links, tests); it must agree with the service.
  if (typeRaw && (!isBookingType(typeRaw) || typeRaw !== def.bookingType)) return { fieldErrors: { booking_type: MESSAGES.service }, values: null };
  const type = def.bookingType;

  const idempotencyKey = str(fd, "idempotency_key");
  if (!isUuid(idempotencyKey)) fieldErrors.idempotency_key = MESSAGES.reload;

  const steps = publicBookingFields(def.key);
  const raw: Record<string, string | null> = {};

  // Media scope: the catalog choice, else what a legacy kind / coverage radio implied.
  const mediaRaw = str(fd, "media_scope") ?? legacyMedia ?? mediaFromCoverage(str(fd, "coverage"));
  const media: MediaChoice | null = mediaRaw === MEDIA_NOT_SURE ? MEDIA_NOT_SURE : isMediaScope(mediaRaw) && def.mediaScopes.includes(mediaRaw) ? mediaRaw : null;
  if (!media) fieldErrors.media_scope = MESSAGES.media;
  raw.media_scope = media;
  raw.service_key = def.key;

  for (const field of steps.flatMap((s) => s.fields)) {
    if (field.kind === "catalog" || field.name === "media_scope") continue;
    if (!fieldVisible(field, raw)) {
      for (const n of fieldInputNames(field)) raw[n] = null;
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
    if (field.kind === "budget") {
      const unknown = fd.get("budget_unknown") === "1";
      const amount = unknown ? null : str(fd, "budget_qr");
      raw.budget_unknown = unknown ? "1" : null;
      raw.budget_qr = amount;
      if (amount) {
        const problem = validateFieldValue(field, amount, today);
        if (problem) fieldErrors.budget_qr = problem;
      }
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

  if (Object.keys(fieldErrors).length || !media) return { fieldErrors, values: null };

  const fullName = raw.full_name!;
  const clientType = raw.client_type as ClientType;
  const usageType = raw.usage_type as UsageType;
  const isMinor = raw.subject_is_minor === "yes";
  const athleteName = type === "club" ? fullName : raw.athlete_name ?? fullName;
  const videoWanted = media === "video" || media === "photo_video";
  const videoDeliverables: VideoDeliverable[] = videoWanted ? def.videoDeliverables.filter((d) => raw[videoFieldName(d)] === "1") : [];
  const videoUnknown = videoWanted && raw[videoFieldName("not_sure")] === "1";
  const serviceKind = legacyServiceKind(def.key, media === MEDIA_NOT_SURE ? null : media, legacyKind);

  const details: PublicBookingDetails = { service_kind: serviceKind, service_key: def.key, media_scope: media };
  const coverage = coverageFromMedia(media);
  if (coverage) details.coverage = coverage;
  if (videoDeliverables.length) details.video_deliverables = videoDeliverables;
  if (videoUnknown) details.video_deliverables_unknown = true;
  if (instagram) details.instagram = instagram;
  if (type === "tournament_athlete") {
    details.booked_for = clientType === "individual" ? "self" : clientType === "parent_guardian" ? "child" : "athlete";
    details.athlete_name = athleteName;
    if (raw.academy) details.academy = raw.academy;
    if (raw.age_division) details.age_division = raw.age_division;
    if (raw.belt) details.belt = raw.belt;
    if (raw.weight_division) details.weight_division = raw.weight_division;
    if (raw.gi) details.gi = raw.gi as PublicBookingDetails["gi"];
    if (raw.source_url) details.source_url = raw.source_url;
    if (raw.competition_date) details.competition_date = raw.competition_date;
  }
  if (type === "club") {
    details.booked_for = "club";
    details.club_name = raw.club_name!;
    if (media !== MEDIA_NOT_SURE) {
      details.wants_photographer = media === "photo" || media === "photo_video";
      details.wants_videographer = media === "video" || media === "photo_video";
    }
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
  if (raw.athlete_count) details.athlete_count = Number(raw.athlete_count);
  if (raw.coverage_hours) details.coverage_hours = Number(raw.coverage_hours);
  if (raw.deadline) details.deadline = raw.deadline;
  if (raw.access_notes) details.access_notes = raw.access_notes;
  if (raw.budget_unknown === "1") details.budget_unknown = true;
  else if (raw.budget_qr) details.budget_qr = Number(raw.budget_qr.replace(/,/g, ""));
  if (raw.location) details.location = raw.location;
  if (raw.event_name) details.event_name = raw.event_name;
  if (raw.notes) details.notes = raw.notes;

  return {
    fieldErrors,
    values: {
      booking_type: type,
      service_key: def.key,
      service_kind: serviceKind,
      media_scope: media,
      video_deliverables: videoDeliverables,
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

export const PUBLIC_REF_RE = /^BB-[A-HJ-NP-Z2-9]{6}$/;

export function isPublicRef(v: unknown): v is string {
  return typeof v === "string" && PUBLIC_REF_RE.test(v);
}

/** "Photos and video" / "Not sure yet" for a media choice. */
export function mediaChoiceLabel(m: MediaChoice): string {
  return m === MEDIA_NOT_SURE ? "Not sure yet" : MEDIA_SCOPE_LABEL[m];
}

/** "Edited highlights + Raw footage", or "Not sure, advise me". */
export function videoDeliverablesLabel(d: PublicBookingDetails): string | null {
  const parts = (d.video_deliverables ?? []).map((v) => VIDEO_DELIVERABLE_LABEL[v]?.label ?? v);
  if (d.video_deliverables_unknown) parts.push("Not sure, advise me");
  return parts.length ? parts.join(" + ") : null;
}

/** Human summary lines for the review step and the owner's Telegram notice. */
export function summarizePublicBooking(v: PublicBookingValues, services: PublicServiceOption[]): Array<[string, string]> {
  const rows: Array<[string, string]> = [["Booking", BOOKING_TYPE_LABEL[v.booking_type]], ["Service", SERVICE_LABEL[v.service_key].title], ["Media", mediaChoiceLabel(v.media_scope)]];
  const d = v.details;
  const video = videoDeliverablesLabel(d);
  if (video) rows.push(["Video", video]);
  const service = v.service_id ? services.find((s) => s.id === v.service_id) : null;
  if (service) rows.push(["Package", `${service.name} (${service.price_label})`]);
  if (v.booking_type === "club") {
    rows.push(["Club", v.club_name ?? "Not given"]);
    if (d.athlete_count) rows.push(["Athletes", String(d.athlete_count)]);
  } else {
    if (v.athlete_name !== v.full_name) rows.push(["Athlete", v.athlete_name]);
    if (d.athlete_count) rows.push(["People", String(d.athlete_count)]);
  }
  if (d.event_name) rows.push(["Event", d.event_name]);
  if (d.competition_date) rows.push(["Date", d.competition_date]);
  if (d.academy) rows.push(["Academy", d.academy]);
  const division = composeDivision(d.age_division ?? null, d.weight_division ?? null);
  if (division) rows.push(["Division", division]);
  if (d.belt) rows.push(["Belt", d.belt]);
  if (d.gi) rows.push(["Style", d.gi === "both" ? "Gi and No-Gi" : d.gi === "gi" ? "Gi" : "No-Gi"]);
  if (d.requested_date) rows.push(["Preferred date", d.requested_time ? `${d.requested_date} ${d.requested_time}` : d.requested_date]);
  if (d.location) rows.push(["Venue", d.location]);
  if (d.location_preference) rows.push(["Where", d.location_preference]);
  if (d.coverage_hours) rows.push(["Duration", `${d.coverage_hours} h`]);
  if (d.deadline) rows.push(["Files wanted by", d.deadline]);
  if (d.request) rows.push(["Request", d.request]);
  rows.push(["Booked by", CLIENT_TYPE_LABEL[v.client_type]], ["Use", USAGE_TYPE_LABEL[v.usage_type]]);
  if (d.budget_unknown) rows.push(["Budget", "Not sure"]);
  else if (d.budget_qr) rows.push(["Budget", `${d.budget_qr.toLocaleString("en-QA")} QAR`]);
  if (d.access_notes) rows.push(["Access / privacy", d.access_notes]);
  if (v.subject_is_minor) rows.push(["Under 18", v.guardian ? `Yes, guardian ${v.guardian.name}` : "Yes"]);
  rows.push(["Name", v.full_name], ["Phone", v.phone], ["E-mail", v.email]);
  if (v.instagram) rows.push(["Instagram", `@${v.instagram}`]);
  if (d.notes) rows.push(["Notes", d.notes]);
  return rows;
}

// ---------------------------------------------------------------------------
// Entry points: which service and package the wizard opens on
// ---------------------------------------------------------------------------

export type WizardEntry = {
  service: ServiceKey | null;
  media: MediaScope | null;
  audience: AudienceKey | null;
  /** A legacy `?kind=` that named the service; kept so details.service_kind round-trips. */
  legacyKind: ServiceKind | null;
  /** Package preselected by `?service=<uuid>` (the services page) when it belongs to the entry service. */
  serviceId: string | null;
  eventId: string | null;
};

export type WizardEntryParams = { service?: string | null; audience?: string | null; type?: string | null; kind?: string | null; event?: string | null; media?: string | null };

/**
 * `/book?service=<catalog key>&media=<scope>`, `?audience=`, legacy
 * `?type=<booking type>` and `?kind=<legacy kind>` all keep working;
 * `?service=<package uuid>` (the services page) preselects that package and
 * its service. A media scope the service does not offer is ignored.
 */
export function resolveWizardEntry(params: WizardEntryParams, ctx: { events: PublicEventOption[]; services: PublicServiceOption[] }): WizardEntry {
  const pkg = isUuid(params.service) ? ctx.services.find((s) => s.id === params.service) ?? null : null;
  const resolved = resolveEntryService({ service: pkg ? null : params.service, type: params.type ?? (pkg ? pkg.booking_type : null), kind: params.kind, audience: params.audience });
  const service = resolved?.service ?? (pkg ? serviceForBookingType(pkg.booking_type) : null);
  const serviceId = pkg && service && pkg.booking_type === service.bookingType ? pkg.id : null;
  const legacyKind = isServiceKind(params.kind) && service && LEGACY_SERVICE_KIND[params.kind]?.service === service.key ? params.kind : null;
  const media = isMediaScope(params.media) && service && service.mediaScopes.includes(params.media) ? params.media : resolved?.media ?? null;
  return {
    service: service?.key ?? null,
    media,
    audience: isAudienceKey(params.audience) ? params.audience : null,
    legacyKind,
    serviceId,
    eventId: params.event && ctx.events.some((e) => e.id === params.event) ? params.event : null,
  };
}

/** Services in the order the wizard offers them: the audience's own first, then the rest. */
export function orderedServices(audience: AudienceKey | null): ServiceKey[] {
  if (!audience) return [...SERVICES];
  const own = AUDIENCE_SERVICES[audience];
  return [...own, ...SERVICES.filter((s) => !own.includes(s))];
}

export { isMediaScope, isServiceKey, isVideoDeliverable };
