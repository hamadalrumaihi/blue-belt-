/**
 * The service catalog: ONE typed definition of what Blue Belt Media sells,
 * shared by the home page, the services pages, the request wizard, the FAQs,
 * structured data and the private workspace.
 *
 * Three independent dimensions (never multiplied into duplicated systems):
 *   audience   who is asking (a way in, not a separate product)
 *   service    what is shot (maps 1:1 onto the existing photo_bookings.booking_type enum)
 *   media      photography, video, or both; video deliverables are explicit
 *
 * Pure: no I/O, no server-only imports, safe in client components and tests.
 * Copy (titles, bodies, FAQs, Arabic) lives in src/lib/catalog/copy.ts so
 * the structure and the words can change independently.
 */
import type { BookingType } from "@/lib/supabase/database.types";

export const AUDIENCES = ["athletes", "parents", "clubs", "organizers"] as const;
export type AudienceKey = (typeof AUDIENCES)[number];

export const SERVICES = ["tournament_athlete", "team_tournament", "training_content", "athlete_portrait", "organizer_custom"] as const;
export type ServiceKey = (typeof SERVICES)[number];

export const MEDIA_SCOPES = ["photo", "video", "photo_video"] as const;
export type MediaScope = (typeof MEDIA_SCOPES)[number];

/** What "video" can mean; each is named explicitly so nothing is implied. */
export const VIDEO_DELIVERABLES = ["full_match", "edited_highlights", "reels", "raw_footage"] as const;
export type VideoDeliverable = (typeof VIDEO_DELIVERABLES)[number];

export type ServiceDefinition = {
  key: ServiceKey;
  /** The database enum this service books as. Existing records keep their enum; nothing is renamed. */
  bookingType: BookingType;
  /** Public URL slug under /services/<slug>. */
  slug: string;
  /** Which audiences this service is offered to (first = primary). */
  audiences: readonly AudienceKey[];
  /** Media scopes the visitor can choose for this service. */
  mediaScopes: readonly MediaScope[];
  /** Video deliverables that can be requested when the scope includes video. */
  videoDeliverables: readonly VideoDeliverable[];
  /** Always quoted (no public price is ever shown even if a package carries one). */
  quoteFirst: boolean;
  /** Where the request wizard starts for this service. */
  wizardType: BookingType;
};

export const SERVICE_DEFINITIONS: Record<ServiceKey, ServiceDefinition> = {
  tournament_athlete: { key: "tournament_athlete", bookingType: "tournament_athlete", slug: "tournament-athlete-coverage", audiences: ["athletes", "parents"], mediaScopes: ["photo", "video", "photo_video"], videoDeliverables: ["full_match", "edited_highlights", "raw_footage"], quoteFirst: false, wizardType: "tournament_athlete" },
  team_tournament: { key: "team_tournament", bookingType: "club", slug: "team-tournament-coverage", audiences: ["clubs"], mediaScopes: ["photo", "video", "photo_video"], videoDeliverables: ["full_match", "edited_highlights", "reels", "raw_footage"], quoteFirst: true, wizardType: "club" },
  training_content: { key: "training_content", bookingType: "training_session", slug: "training-and-gym-content", audiences: ["clubs", "athletes"], mediaScopes: ["photo", "video", "photo_video"], videoDeliverables: ["edited_highlights", "reels", "raw_footage"], quoteFirst: false, wizardType: "training_session" },
  athlete_portrait: { key: "athlete_portrait", bookingType: "private_session", slug: "athlete-portraits-and-private-sessions", audiences: ["athletes", "parents"], mediaScopes: ["photo", "video", "photo_video"], videoDeliverables: ["reels", "raw_footage"], quoteFirst: false, wizardType: "private_session" },
  organizer_custom: { key: "organizer_custom", bookingType: "custom", slug: "event-and-organizer-coverage", audiences: ["organizers", "clubs"], mediaScopes: ["photo", "video", "photo_video"], videoDeliverables: ["full_match", "edited_highlights", "reels", "raw_footage"], quoteFirst: true, wizardType: "custom" },
};

export const AUDIENCE_SERVICES: Record<AudienceKey, readonly ServiceKey[]> = {
  athletes: ["tournament_athlete", "athlete_portrait", "training_content"],
  parents: ["tournament_athlete", "athlete_portrait"],
  clubs: ["team_tournament", "training_content", "organizer_custom"],
  organizers: ["organizer_custom", "team_tournament"],
};

export function isServiceKey(v: unknown): v is ServiceKey {
  return typeof v === "string" && (SERVICES as readonly string[]).includes(v);
}
export function isAudienceKey(v: unknown): v is AudienceKey {
  return typeof v === "string" && (AUDIENCES as readonly string[]).includes(v);
}
export function isMediaScope(v: unknown): v is MediaScope {
  return typeof v === "string" && (MEDIA_SCOPES as readonly string[]).includes(v);
}
export function isVideoDeliverable(v: unknown): v is VideoDeliverable {
  return typeof v === "string" && (VIDEO_DELIVERABLES as readonly string[]).includes(v);
}

export function serviceByKey(key: ServiceKey): ServiceDefinition {
  return SERVICE_DEFINITIONS[key];
}

export function serviceBySlug(slug: string): ServiceDefinition | null {
  return Object.values(SERVICE_DEFINITIONS).find((s) => s.slug === slug) ?? null;
}

/** The catalog service a database booking_type belongs to (1:1 today). */
export function serviceForBookingType(type: BookingType): ServiceDefinition {
  return Object.values(SERVICE_DEFINITIONS).find((s) => s.bookingType === type)!;
}

/**
 * Legacy wizard `service_kind` values (stored verbatim in photo_bookings.details)
 * mapped onto the catalog. Old links `/book?kind=…` and old records keep
 * meaning what they meant.
 */
export const LEGACY_SERVICE_KIND: Record<string, { service: ServiceKey; media: MediaScope }> = {
  tournament_athlete_photo: { service: "tournament_athlete", media: "photo" },
  tournament_athlete_photo_video: { service: "tournament_athlete", media: "photo_video" },
  event_coverage: { service: "organizer_custom", media: "photo_video" },
  club_team_coverage: { service: "team_tournament", media: "photo_video" },
  training_coverage: { service: "training_content", media: "photo" },
  athlete_portrait: { service: "athlete_portrait", media: "photo" },
  private_session: { service: "athlete_portrait", media: "photo" },
  custom: { service: "organizer_custom", media: "photo_video" },
};

/** Resolves any of the entry-point parameters (`service`, legacy `type`, legacy `kind`) to a catalog service. */
export function resolveEntryService(params: { service?: string | null; type?: string | null; kind?: string | null; audience?: string | null }): { service: ServiceDefinition; media: MediaScope | null; audience: AudienceKey | null } | null {
  const audience = isAudienceKey(params.audience) ? params.audience : null;
  if (isServiceKey(params.service)) return { service: SERVICE_DEFINITIONS[params.service], media: null, audience };
  if (params.kind && LEGACY_SERVICE_KIND[params.kind]) {
    const m = LEGACY_SERVICE_KIND[params.kind];
    return { service: SERVICE_DEFINITIONS[m.service], media: m.media, audience };
  }
  const type = params.type;
  if (type) {
    const def = Object.values(SERVICE_DEFINITIONS).find((s) => s.bookingType === type);
    if (def) return { service: def, media: null, audience };
  }
  if (audience) return { service: SERVICE_DEFINITIONS[AUDIENCE_SERVICES[audience][0]], media: null, audience };
  return null;
}
