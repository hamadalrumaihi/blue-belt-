/**
 * Shared shapes of the pricing engine. Pure types: no I/O, no server-only
 * imports, safe in tests and in the owner's pages.
 *
 * Three separate outputs are kept apart on purpose (issue 8/9 in the
 * overhaul register): a MARKET comparison (what comparable providers
 * advertise), a COST FLOOR (what the job costs the studio) and a
 * RECOMMENDATION (a price band derived from the floor with a real margin,
 * reconciled against the market). Nothing here is ever shown to a client.
 */
import type { MediaScope, ServiceKey, VideoDeliverable } from "@/lib/catalog";
import type { BookingType, PriceConfidence, PriceRegion, PriceSourceType, UsageType } from "@/lib/supabase/database.types";

export type LocationKind = "venue" | "academy" | "studio" | "outdoor" | "unknown";

/** A default the engine had to assume because the request did not say. Always visible. */
export type Assumption = { key: string; label: string; value: string | number | boolean | null; source: "default" | "request" | "owner" };

/**
 * The PUBLIC-scope description of a job. This is what a research job or an
 * assessment snapshot may contain: service, media, hours, counts, a location
 * kind and dates. Never a name, e-mail, phone, venue string or free text.
 */
export type PricingRequest = {
  service: ServiceKey;
  bookingType: BookingType;
  media: MediaScope;
  videoDeliverables: VideoDeliverable[];
  /** Shooting hours per day on site. */
  hoursOnSite: number | null;
  days: number;
  athleteCount: number | null;
  /** Mats running at the same time (sports events); drives staffing. */
  simultaneousMats: number | null;
  /** Delivered, edited images expected in total. */
  expectedImages: number | null;
  locationKind: LocationKind;
  usage: UsageType | null;
  /** Event or session date (YYYY-MM-DD), used for capacity checks only. */
  eventDate: string | null;
  /** Days between the shoot and the expected delivery; null = not stated. */
  deadlineDays: number | null;
  /** Inputs the engine could not read; `criticalMissing` are the ones that make a price indefensible. */
  missingInputs: string[];
  criticalMissing: string[];
  assumptions: Assumption[];
};

// ---------------------------------------------------------------------------
// Market comparison
// ---------------------------------------------------------------------------

/**
 * Comparable scopes: a price is only ever normalised within one of these.
 * A studio portrait session is never averaged with event coverage per hour,
 * and a retainer or a managed social package is never a shoot comparable.
 */
export const COMPARABLE_SCOPES = ["sports_event_athlete", "event_coverage_hourly", "portrait_session", "content_package_images", "video_production", "retainer_monthly", "managed_social", "other"] as const;
export type ComparableScope = (typeof COMPARABLE_SCOPES)[number];

export const COMPARABLE_SCOPE_LABEL: Record<ComparableScope, string> = {
  sports_event_athlete: "Sports event, per athlete",
  event_coverage_hourly: "Event coverage, by the hour",
  portrait_session: "Portrait / studio session",
  content_package_images: "Content package, per edited image",
  video_production: "Video production",
  retainer_monthly: "Monthly retainer",
  managed_social: "Managed social media",
  other: "Other",
};

export function isComparableScope(v: unknown): v is ComparableScope {
  return typeof v === "string" && (COMPARABLE_SCOPES as readonly string[]).includes(v);
}

export type MarketUnit = "per_hour" | "per_athlete" | "per_session" | "per_image" | "flat";

export type MarketItem = {
  id: string;
  provider: string;
  region: PriceRegion;
  confidence: PriceConfidence;
  sourceType: PriceSourceType;
  observedOn: string;
  media: string | null;
  /** The advertised price (QAR) as observed. */
  priceFrom: number;
  priceTo: number;
  unit: MarketUnit;
  /** Unit price when the scope allows normalisation (null for flat / per session). */
  unitFrom: number | null;
  unitTo: number | null;
  /** Scaled to this job's size within the scope (same as price when flat). */
  scaledFrom: number;
  scaledTo: number;
  stale: boolean;
  notes: string[];
};

export type MarketGroup = {
  scope: ComparableScope;
  media: MediaScope | "unknown";
  region: PriceRegion;
  role: "primary" | "secondary" | "component";
  unit: MarketUnit;
  count: number;
  low: number;
  high: number;
  median: number;
  confidence: "low" | "medium" | "high";
  items: MarketItem[];
};

export type ExcludedReference = { id: string; provider: string; reason: string };

export type MarketComparison = {
  primaryScope: ComparableScope;
  wanted: Array<{ scope: ComparableScope; media: MediaScope; role: "primary" | "secondary" | "component" }>;
  groups: MarketGroup[];
  /** The Qatar primary-scope range, scaled to the job; null when no active evidence exists. */
  range: { scope: ComparableScope; unit: MarketUnit; low: number; high: number; median: number; count: number } | null;
  excluded: ExcludedReference[];
  /** Evidence that exists but must be re-verified before it may price anything. */
  needsReverification: ExcludedReference[];
  confidence: "low" | "medium" | "high";
  notes: string[];
};

// ---------------------------------------------------------------------------
// Cost floor
// ---------------------------------------------------------------------------

export type CostAssumptions = {
  /** The owner's own labour, QAR per hour (shooting, prep, travel time, culling, editing, admin). */
  ownerHourlyQr: number;
  /** What a videographer partner charges the studio per shoot day. */
  partnerVideographerDayQr: number;
  /** A second photographer per shoot day. */
  secondShooterDayQr: number;
  prepHoursPerDay: number;
  travelHoursPerDay: number;
  travelCostPerDayQr: number;
  /** Selecting from the raw take, per 100 delivered images. */
  cullingHoursPer100Images: number;
  editingMinutesPerImage: number;
  imagesPerShootHour: number;
  imagesPerAthlete: number;
  imagesPerPortraitSession: number;
  /** Trimming / export per hour of full-match footage. */
  fullMatchEditHoursPerFootageHour: number;
  highlightEditHours: number;
  reelEditHours: number;
  rawFootageHandlingHoursPerFootageHour: number;
  adminHours: number;
  overheadPerShootDayQr: number;
  equipmentPerShootDayQr: number;
  /** Card / gateway fee as a share of the PRICE (applied in the price formula, never as a cost line). */
  paymentFeePercent: number;
  contingencyPercent: number;
  /** How many simultaneous mats one photographer can cover. */
  matsPerShooter: number;
  /** Expected matches per athlete on an event day. Never 2 by default. */
  matchesPerAthlete: number;
  minutesPerMatch: number;
  /** The share of a shooter's on-site minutes that can be matches. */
  shooterUtilisation: number;
  /** Reels assumed for a content session when the request does not say. */
  reelsPerContentDay: number;
};

export type CostLine = {
  key: string;
  label: string;
  hours: number | null;
  rate: number | null;
  amount: number;
  /** How the amount was built, in plain words. */
  basis: string;
};

export type CostFloor = {
  lines: CostLine[];
  subtotal: number;
  contingency: number;
  /** Everything above, once. Payment fees are NOT in here (see Recommendation.feePercent). */
  total: number;
  staffing: { shooters: number; videographers: number; crew: number; basis: string };
  workload: {
    shootHours: number;
    ownerHours: number;
    editingHours: number;
    expectedImages: number;
    video: { fullMatchFootageHours: number; highlights: number; reels: number; rawFootageHours: number };
  };
  assumptions: Assumption[];
  warnings: string[];
};

// ---------------------------------------------------------------------------
// Recommendation
// ---------------------------------------------------------------------------

export type PriceBand = { low: number; target: number; high: number };

export type Flag = { code: string; severity: "info" | "warning" | "blocker"; message: string };

export type CapacityConflict = { bookingId: string; publicRef: string | null; status: string; sessionAt: string | null };
export type CapacityCheck = { date: string | null; conflicts: CapacityConflict[]; tentative: CapacityConflict[] };

export type Alternative = {
  key: string;
  label: string;
  changes: string[];
  costTotal: number;
  band: PriceBand;
};

export type Recommendation = {
  /** price = cost / (1 − margin − fee) at the three margins. */
  costBased: PriceBand;
  marginPercent: PriceBand;
  feePercent: number;
  /** After market reconciliation; what the owner is shown first. */
  recommended: PriceBand;
  profitAtTarget: number;
  marginAtTarget: number;
  marketReconciliation: { status: "no_market" | "within" | "below_market" | "above_market"; note: string };
  flags: Flag[];
  team: { athletes: number; total: number; perAthlete: number; basis: string } | null;
  alternatives: Alternative[];
  capacity: CapacityCheck;
  steps: string[];
};

export type Assessment = {
  engineVersion: number;
  computedAt: string;
  request: PricingRequest;
  references: string[];
  costAssumptions: CostAssumptions;
  market: MarketComparison;
  costFloor: CostFloor;
  recommendation: Recommendation;
  missingInputs: string[];
  confidence: "low" | "medium" | "high";
};

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : round2((sorted[mid - 1] + sorted[mid]) / 2);
}
