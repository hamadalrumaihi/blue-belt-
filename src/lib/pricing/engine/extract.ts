/**
 * Booking / lead → PricingRequest. Reads ONLY public-scope keys off the
 * details JSON (coverage, counts, dates, a location keyword) and never
 * copies a name, e-mail, phone, venue string, note or free-text request.
 * Deterministic: `now` is injected. Everything the engine had to assume is
 * listed in `assumptions`; everything it could not read is in
 * `missingInputs`, with `criticalMissing` for the inputs without which a
 * price is indefensible (the assessment is then "needs_detail").
 */
import { isMediaScope, isServiceKey, isVideoDeliverable, LEGACY_SERVICE_KIND, SERVICE_DEFINITIONS, serviceForBookingType, type MediaScope, type ServiceKey, type VideoDeliverable } from "@/lib/catalog";
import type { BookingType, UsageType } from "@/lib/supabase/database.types";
import { isPlainObject, isValidCalendarDate } from "@/lib/validation";
import type { Assumption, LocationKind, PricingRequest } from "./types";

export type ExtractSource = {
  bookingType: BookingType | null;
  /** photo_bookings.details or photo_leads.details (any JSON). */
  details: unknown;
  sessionAt?: string | null;
  sessionEndAt?: string | null;
  /** The package picked, when any. */
  service?: { includes_video: boolean | null; duration_minutes: number | null } | null;
  usageType?: UsageType | null;
  /** photo_events.event_date for a linked event. */
  eventDate?: string | null;
};

/** Default shooting hours per day when the request does not say. */
export const DEFAULT_HOURS_ON_SITE: Record<ServiceKey, number> = { tournament_athlete: 4, team_tournament: 8, training_content: 2, athlete_portrait: 1.5, organizer_custom: 8 };
/** Default simultaneous mats for a sports event. */
export const DEFAULT_MATS: Record<ServiceKey, number | null> = { tournament_athlete: 1, team_tournament: 2, training_content: null, athlete_portrait: null, organizer_custom: 2 };

const USAGE: readonly UsageType[] = ["personal", "club_team", "commercial"];

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function int(v: unknown, max: number): number | null {
  const n = num(v);
  return n !== null && Number.isInteger(n) && n <= max ? n : null;
}

/** A location KIND from a free-text preference: keywords only; the string itself is never kept. */
export function locationKindFrom(text: unknown): LocationKind {
  if (typeof text !== "string") return "unknown";
  const t = text.toLowerCase();
  if (/studio/.test(t)) return "studio";
  if (/academy|gym|club|dojo|mat room|training/.test(t)) return "academy";
  if (/outdoor|beach|park|corniche|desert|outside/.test(t)) return "outdoor";
  if (/hall|arena|venue|sports complex|stadium|centre|center/.test(t)) return "venue";
  return "unknown";
}

function hoursBetween(a: string | null | undefined, b: string | null | undefined): number | null {
  if (!a || !b) return null;
  const ms = Date.parse(b) - Date.parse(a);
  return Number.isFinite(ms) && ms > 0 ? Math.round((ms / 3_600_000) * 10) / 10 : null;
}

function daysBetween(from: string, to: string): number | null {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

export function extractPricingRequest(src: ExtractSource, now: Date = new Date()): PricingRequest {
  const d = isPlainObject(src.details) ? src.details : {};
  const assumptions: Assumption[] = [];
  const missing: string[] = [];
  const critical: string[] = [];
  const assume = (key: string, label: string, value: Assumption["value"], source: Assumption["source"] = "default") => assumptions.push({ key, label, value, source });

  // Service ------------------------------------------------------------------
  let service: ServiceKey;
  let mediaHint: MediaScope | null = null;
  if (isServiceKey(d.service)) service = d.service;
  else if (typeof d.service_kind === "string" && LEGACY_SERVICE_KIND[d.service_kind]) {
    service = LEGACY_SERVICE_KIND[d.service_kind].service;
    mediaHint = LEGACY_SERVICE_KIND[d.service_kind].media;
  } else if (src.bookingType) service = serviceForBookingType(src.bookingType).key;
  else {
    service = "organizer_custom";
    missing.push("service");
    critical.push("service");
    assume("service", "Service", "organizer_custom");
  }
  const def = SERVICE_DEFINITIONS[service];
  const bookingType = src.bookingType ?? def.bookingType;

  // Media ---------------------------------------------------------------------
  let media: MediaScope | null = null;
  if (isMediaScope(d.media)) media = d.media;
  else if (d.coverage === "photo" || d.coverage === "video" || d.coverage === "both") media = d.coverage === "both" ? "photo_video" : d.coverage;
  else if (d.wants_photographer === true || d.wants_videographer === true) media = d.wants_photographer && d.wants_videographer ? "photo_video" : d.wants_videographer ? "video" : "photo";
  else if (mediaHint) media = mediaHint;
  else if (src.service?.includes_video === true) media = "photo_video";
  else if (src.service?.includes_video === false) media = "photo";
  if (!media) {
    media = "photo";
    missing.push("media");
    if (service === "organizer_custom" || service === "team_tournament") critical.push("media");
    assume("media", "Media", "photo");
  }

  // Video deliverables ----------------------------------------------------------
  let deliverables: VideoDeliverable[] = [];
  if (media !== "photo") {
    const raw = Array.isArray(d.video_deliverables) ? d.video_deliverables.filter(isVideoDeliverable) : [];
    deliverables = raw.filter((v) => def.videoDeliverables.includes(v));
    if (deliverables.length === 0) {
      deliverables = [def.videoDeliverables.includes("edited_highlights") ? "edited_highlights" : def.videoDeliverables[0]];
      missing.push("video_deliverables");
      assume("video_deliverables", "Video deliverables", deliverables.join(", "));
    }
  }

  // Hours / days ------------------------------------------------------------------
  const days = int(d.days, 30) ?? 1;
  let hours = num(d.hours_on_site) ?? hoursBetween(src.sessionAt, src.sessionEndAt);
  if (hours === null && src.service?.duration_minutes) hours = Math.round((src.service.duration_minutes / 60) * 10) / 10;
  if (hours === null) {
    missing.push("hours_on_site");
    if (service === "team_tournament" || service === "organizer_custom") critical.push("hours_on_site");
    hours = DEFAULT_HOURS_ON_SITE[service];
    assume("hours_on_site", "Hours on site per day", hours);
  }

  // Counts --------------------------------------------------------------------------
  let athletes = int(d.athlete_count, 500);
  if (athletes === null) {
    if (service === "tournament_athlete" || service === "athlete_portrait") {
      athletes = 1;
      assume("athlete_count", "Athletes", 1);
    } else if (service === "team_tournament") {
      missing.push("athlete_count");
      critical.push("athlete_count");
    }
  }
  let mats = int(d.simultaneous_mats ?? d.mats, 50);
  if (mats === null && DEFAULT_MATS[service] !== null) {
    mats = DEFAULT_MATS[service];
    missing.push("simultaneous_mats");
    assume("simultaneous_mats", "Mats running at once", mats);
  }
  const expectedImages = int(d.expected_images ?? d.images_expected, 100_000);

  // Location, usage, dates ------------------------------------------------------------
  const locationKind: LocationKind = typeof d.location_kind === "string" && ["venue", "academy", "studio", "outdoor"].includes(d.location_kind) ? (d.location_kind as LocationKind) : locationKindFrom(d.location_preference ?? d.location);
  if (locationKind === "unknown") missing.push("location_kind");
  const usageRaw = src.usageType ?? d.usage_type;
  const usage = USAGE.includes(usageRaw as UsageType) ? (usageRaw as UsageType) : null;
  if (!usage) missing.push("usage");

  const dateRaw = [src.eventDate, d.competition_date, d.requested_date].find((v) => isValidCalendarDate(v));
  const eventDate = typeof dateRaw === "string" ? dateRaw : null;
  if (!eventDate) missing.push("event_date");
  let deadlineDays = int(d.deadline_days, 365);
  if (deadlineDays === null && isValidCalendarDate(d.deadline_date) && eventDate) deadlineDays = daysBetween(eventDate, d.deadline_date);
  if (deadlineDays !== null && deadlineDays < 0) deadlineDays = 0;
  void now;

  return {
    service,
    bookingType,
    media,
    videoDeliverables: deliverables,
    hoursOnSite: hours,
    days,
    athleteCount: athletes,
    simultaneousMats: mats,
    expectedImages,
    locationKind,
    usage,
    eventDate,
    deadlineDays,
    missingInputs: missing,
    criticalMissing: critical,
    assumptions,
  };
}

const PUBLIC_KEYS: Array<keyof PricingRequest> = ["service", "bookingType", "media", "videoDeliverables", "hoursOnSite", "days", "athleteCount", "simultaneousMats", "expectedImages", "locationKind", "usage", "eventDate", "deadlineDays"];

/**
 * Reads a stored request snapshot back. Only the public-scope keys are
 * accepted; anything else in the JSON is dropped so a hand-edited row can
 * never smuggle identifiers into the engine.
 */
export function pricingRequestFromJson(value: unknown): PricingRequest | null {
  if (!isPlainObject(value)) return null;
  if (!isServiceKey(value.service) || !isMediaScope(value.media)) return null;
  const def = SERVICE_DEFINITIONS[value.service];
  const req: PricingRequest = {
    service: value.service,
    bookingType: typeof value.bookingType === "string" ? (value.bookingType as BookingType) : def.bookingType,
    media: value.media,
    videoDeliverables: Array.isArray(value.videoDeliverables) ? value.videoDeliverables.filter(isVideoDeliverable) : [],
    hoursOnSite: num(value.hoursOnSite),
    days: int(value.days, 30) ?? 1,
    athleteCount: int(value.athleteCount, 500),
    simultaneousMats: int(value.simultaneousMats, 50),
    expectedImages: int(value.expectedImages, 100_000),
    locationKind: typeof value.locationKind === "string" && ["venue", "academy", "studio", "outdoor", "unknown"].includes(value.locationKind) ? (value.locationKind as LocationKind) : "unknown",
    usage: USAGE.includes(value.usage as UsageType) ? (value.usage as UsageType) : null,
    eventDate: isValidCalendarDate(value.eventDate) ? value.eventDate : null,
    deadlineDays: int(value.deadlineDays, 365),
    missingInputs: Array.isArray(value.missingInputs) ? value.missingInputs.filter((v): v is string => typeof v === "string") : [],
    criticalMissing: Array.isArray(value.criticalMissing) ? value.criticalMissing.filter((v): v is string => typeof v === "string") : [],
    assumptions: Array.isArray(value.assumptions) ? value.assumptions.filter((a): a is Assumption => isPlainObject(a) && typeof a.key === "string" && typeof a.label === "string") : [],
  };
  void PUBLIC_KEYS;
  return req;
}

/** The owner's edits to a request (new version): only public-scope fields can change. */
export type RequestOverrides = Partial<Pick<PricingRequest, "media" | "videoDeliverables" | "hoursOnSite" | "days" | "athleteCount" | "simultaneousMats" | "expectedImages" | "locationKind" | "deadlineDays">>;

export function applyRequestOverrides(base: PricingRequest, overrides: RequestOverrides): PricingRequest {
  const next: PricingRequest = { ...base, assumptions: [...base.assumptions], missingInputs: [...base.missingInputs], criticalMissing: [...base.criticalMissing] };
  for (const [key, value] of Object.entries(overrides) as Array<[keyof RequestOverrides, unknown]>) {
    if (value === undefined) continue;
    (next as unknown as Record<string, unknown>)[key] = value;
    const snake = key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
    next.missingInputs = next.missingInputs.filter((m) => m !== snake);
    next.criticalMissing = next.criticalMissing.filter((m) => m !== snake);
    next.assumptions = next.assumptions.filter((a) => a.key !== snake);
    next.assumptions.push({ key: snake, label: key, value: Array.isArray(value) ? value.join(", ") : (value as Assumption["value"]), source: "owner" });
  }
  return next;
}

export const PUBLIC_REQUEST_KEYS = PUBLIC_KEYS;
