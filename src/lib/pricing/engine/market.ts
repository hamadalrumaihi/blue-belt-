/**
 * Market comparison: which observed prices are genuinely comparable to this
 * job, normalised ONLY within one comparable scope (per hour, per athlete,
 * per edited image, per session) and never across product types. Reports a
 * range, a count and a confidence per group; every exclusion carries its
 * reason; evidence that needs re-verification is listed but never priced.
 * Pure and deterministic (`now` injected).
 */
import type { MediaScope } from "@/lib/catalog";
import type { PhotoPriceReferenceRow, PriceConfidence, PriceRegion, PriceSourceType } from "@/lib/supabase/database.types";
import { priceReferenceIncludes } from "../form";
import { COMPARABLE_SCOPE_LABEL, isComparableScope, median, round2, type ComparableScope, type ExcludedReference, type MarketComparison, type MarketGroup, type MarketItem, type MarketUnit, type PricingRequest } from "./types";

/** Evidence older than this (from observed_on) must be re-checked before it prices anything. */
export const STALE_AFTER_DAYS = 365;
const DAY_MS = 86_400_000;

export type ReferenceRow = Pick<PhotoPriceReferenceRow, "id" | "provider" | "service_type" | "price_from" | "price_to" | "currency" | "includes" | "observed_on" | "checked_on" | "source_type" | "confidence" | "region" | "media_type" | "duration_hours" | "athlete_count" | "promotion_expires_on" | "excluded" | "excluded_reason" | "comparable_scope" | "superseded_by">;

/** The scope a reference prices, from its explicit label or, failing that, its service type. */
export function referenceScope(ref: Pick<ReferenceRow, "comparable_scope" | "service_type" | "media_type">): { scope: ComparableScope; inferred: boolean } {
  if (isComparableScope(ref.comparable_scope)) return { scope: ref.comparable_scope, inferred: false };
  switch (ref.service_type) {
    case "tournament_athlete":
      return { scope: "sports_event_athlete", inferred: true };
    case "club":
    case "custom":
      return { scope: "event_coverage_hourly", inferred: true };
    case "private_session":
      return { scope: "portrait_session", inferred: true };
    case "training_session":
      return { scope: ref.media_type === "video" ? "video_production" : "content_package_images", inferred: true };
  }
}

/** The scopes a request is compared against, and the role each plays. */
export function wantedScopes(req: PricingRequest): MarketComparison["wanted"] {
  const w: MarketComparison["wanted"] = [];
  const add = (scope: ComparableScope, media: MediaScope, role: MarketGroup["role"]) => w.push({ scope, media, role });
  switch (req.service) {
    case "tournament_athlete":
      add("sports_event_athlete", req.media, "primary");
      add("event_coverage_hourly", req.media, "secondary");
      break;
    case "team_tournament":
      add("event_coverage_hourly", req.media, "primary");
      add("sports_event_athlete", req.media, "secondary");
      break;
    case "organizer_custom":
      add("event_coverage_hourly", req.media, "primary");
      if (req.media !== "photo") add("video_production", "video", "secondary");
      break;
    case "training_content":
      add(req.media === "video" ? "video_production" : "content_package_images", req.media, "primary");
      if (req.media === "photo_video") add("video_production", "video", "secondary");
      break;
    case "athlete_portrait":
      add("portrait_session", req.media, "primary");
      add("content_package_images", req.media, "secondary");
      break;
  }
  // A photo+video job also learns from each component on its own.
  if (req.media === "photo_video") {
    for (const { scope } of [...w]) {
      add(scope, "photo", "component");
      add(scope, "video", "component");
    }
  }
  return w;
}

function unitFor(scope: ComparableScope): MarketUnit {
  switch (scope) {
    case "sports_event_athlete":
      return "per_athlete";
    case "event_coverage_hourly":
    case "video_production":
      return "per_hour";
    case "portrait_session":
      return "per_session";
    case "content_package_images":
      return "per_image";
    default:
      return "flat";
  }
}

function daysOld(ymd: string | null, now: Date): number | null {
  if (!ymd) return null;
  const t = Date.parse(`${ymd}T00:00:00Z`);
  return Number.isFinite(t) ? Math.floor((now.getTime() - t) / DAY_MS) : null;
}

function refMedia(ref: ReferenceRow): MediaScope | "unknown" {
  if (ref.media_type === "photo" || ref.media_type === "video" || ref.media_type === "photo_video") return ref.media_type;
  const inc = priceReferenceIncludes(ref);
  if (inc.video === true) return "photo_video";
  if (inc.video === false) return "photo";
  return "unknown";
}

function groupConfidence(items: MarketItem[]): MarketGroup["confidence"] {
  const strong = items.filter((i) => i.confidence === "verified" && !i.stale).length;
  const ok = items.filter((i) => (i.confidence === "verified" || i.confidence === "likely") && !i.stale).length;
  if (strong >= 2 && ok >= 3) return "high";
  if (ok >= 2) return "medium";
  return "low";
}

/** Requires a QAR advertised price with the scope's unit, scaled to the job. */
function normalise(ref: ReferenceRow, scope: ComparableScope, req: PricingRequest, notes: string[]): { unit: MarketUnit; unitFrom: number | null; unitTo: number | null; scaledFrom: number; scaledTo: number } {
  const inc = priceReferenceIncludes(ref);
  const from = round2(Number(ref.price_from) || 0);
  const to = ref.price_to === null || ref.price_to === undefined ? from : round2(Number(ref.price_to));
  const flat = { unit: "flat" as MarketUnit, unitFrom: null, unitTo: null, scaledFrom: from, scaledTo: to };
  const unit = unitFor(scope);
  if (unit === "per_hour") {
    const h = ref.duration_hours ?? inc.hours ?? null;
    const jobHours = req.hoursOnSite !== null ? req.hoursOnSite * req.days : null;
    if (!h || h <= 0) {
      notes.push("Duration not stated; taken as a flat price.");
      return flat;
    }
    if (jobHours === null) {
      notes.push("Job hours unknown; shown per hour only.");
      return { unit, unitFrom: round2(from / h), unitTo: round2(to / h), scaledFrom: from, scaledTo: to };
    }
    return { unit, unitFrom: round2(from / h), unitTo: round2(to / h), scaledFrom: round2((from / h) * jobHours), scaledTo: round2((to / h) * jobHours) };
  }
  if (unit === "per_athlete") {
    const a = ref.athlete_count ?? inc.athletes ?? null;
    if (!a || a <= 0) {
      notes.push("Athlete count not stated; taken as a flat per-booking price.");
      return flat;
    }
    if (!req.athleteCount) {
      notes.push("Job athlete count unknown; shown per athlete only.");
      return { unit, unitFrom: round2(from / a), unitTo: round2(to / a), scaledFrom: from, scaledTo: to };
    }
    return { unit, unitFrom: round2(from / a), unitTo: round2(to / a), scaledFrom: round2((from / a) * req.athleteCount), scaledTo: round2((to / a) * req.athleteCount) };
  }
  if (unit === "per_image") {
    const n = inc.photos ?? null;
    if (!n || n <= 0) {
      notes.push("Image count not stated; taken as a flat package price.");
      return flat;
    }
    if (!req.expectedImages) {
      notes.push("Expected image count unknown; shown per edited image only.");
      return { unit, unitFrom: round2(from / n), unitTo: round2(to / n), scaledFrom: from, scaledTo: to };
    }
    return { unit, unitFrom: round2(from / n), unitTo: round2(to / n), scaledFrom: round2((from / n) * req.expectedImages), scaledTo: round2((to / n) * req.expectedImages) };
  }
  if (unit === "per_session") {
    const h = ref.duration_hours ?? inc.hours ?? null;
    if (h && req.hoursOnSite && Math.abs(h - req.hoursOnSite) > 0.5) notes.push(`Session length ${h} h vs ${req.hoursOnSite} h requested; session prices are not scaled by the minute.`);
    return { ...flat, unit };
  }
  return flat;
}

export function compareMarket(refs: ReferenceRow[], req: PricingRequest, now: Date = new Date()): MarketComparison {
  const wanted = wantedScopes(req);
  const primaryScope = wanted[0].scope;
  const excluded: ExcludedReference[] = [];
  const needsReverification: ExcludedReference[] = [];
  const notes: string[] = [];
  const buckets = new Map<string, MarketGroup>();

  for (const ref of refs) {
    const ex = (reason: string) => excluded.push({ id: ref.id, provider: ref.provider, reason });
    if (ref.superseded_by) {
      ex("Superseded by a newer observation.");
      continue;
    }
    if (ref.excluded) {
      ex(ref.excluded_reason || "Excluded by the owner.");
      continue;
    }
    if ((ref.currency || "QAR").toUpperCase() !== "QAR") {
      ex(`Priced in ${ref.currency}, not QAR.`);
      continue;
    }
    const region: PriceRegion = ref.region ?? "qatar";
    if (region === "other") {
      ex("Outside Qatar and the GCC.");
      continue;
    }
    const { scope, inferred } = referenceScope(ref);
    if (scope === "retainer_monthly" || scope === "managed_social") {
      ex(`Different product (${COMPARABLE_SCOPE_LABEL[scope].toLowerCase()}); not a shoot comparable.`);
      continue;
    }
    const media = refMedia(ref);
    const match = wanted.find((w) => w.scope === scope && (media === "unknown" || media === w.media));
    if (!match) {
      const scopeWanted = wanted.some((w) => w.scope === scope);
      ex(scopeWanted ? `${media === "photo" ? "Photo only" : media === "video" ? "Video only" : "Photo and video"}; this job is ${req.media.replace("_", " and ")}.` : `Different scope: ${COMPARABLE_SCOPE_LABEL[scope].toLowerCase()}.`);
      continue;
    }
    const observedOn = ref.observed_on ?? ref.checked_on;
    const age = daysOld(observedOn, now);
    const stale = age !== null && age > STALE_AFTER_DAYS;
    const confidence: PriceConfidence = ref.confidence ?? "unverified";
    const sourceType: PriceSourceType = ref.source_type ?? "other";
    const expired = ref.promotion_expires_on !== null && ref.promotion_expires_on !== undefined && ref.promotion_expires_on < now.toISOString().slice(0, 10);
    const reverify = (reason: string) => needsReverification.push({ id: ref.id, provider: ref.provider, reason });
    if (confidence === "unverified") {
      reverify("Unverified evidence; re-check the source before it prices anything.");
      continue;
    }
    if (sourceType === "search_index") {
      reverify("Search-index evidence (page not retrieved directly); re-verify on the provider's own page.");
      continue;
    }
    if (stale) {
      reverify(`Observed ${age} days ago; re-check the price.`);
      continue;
    }
    if (expired) {
      reverify(`Promotion expired on ${ref.promotion_expires_on}; re-check the current price.`);
      continue;
    }

    const itemNotes: string[] = [];
    if (inferred) itemNotes.push("Scope inferred from the service type; label it to be sure.");
    if (media === "unknown") itemNotes.push("Media not stated.");
    const n = normalise(ref, scope, req, itemNotes);
    const item: MarketItem = { id: ref.id, provider: ref.provider, region, confidence, sourceType, observedOn, media: media === "unknown" ? null : media, priceFrom: round2(Number(ref.price_from) || 0), priceTo: ref.price_to === null ? round2(Number(ref.price_from) || 0) : round2(Number(ref.price_to)), unit: n.unit, unitFrom: n.unitFrom, unitTo: n.unitTo, scaledFrom: n.scaledFrom, scaledTo: n.scaledTo, stale, notes: itemNotes };
    const key = `${scope}:${match.media}:${region}:${match.role}`;
    const group = buckets.get(key) ?? { scope, media: match.media, region, role: match.role, unit: unitFor(scope), count: 0, low: 0, high: 0, median: 0, confidence: "low", items: [] };
    group.items.push(item);
    buckets.set(key, group);
  }

  const groups: MarketGroup[] = [];
  for (const g of buckets.values()) {
    const lows = g.items.map((i) => i.scaledFrom);
    const highs = g.items.map((i) => i.scaledTo);
    g.count = g.items.length;
    g.low = Math.min(...lows);
    g.high = Math.max(...highs);
    g.median = median([...lows, ...highs]);
    g.confidence = groupConfidence(g.items);
    // Scaled only when every item in the group could be scaled; otherwise the unit is the honest one.
    if (g.items.some((i) => i.unit === "flat") && g.unit !== "flat") {
      g.unit = "flat";
      g.items.forEach((i) => (i.unit = "flat"));
    }
    groups.push(g);
  }
  const roleOrder = { primary: 0, secondary: 1, component: 2 };
  groups.sort((a, b) => roleOrder[a.role] - roleOrder[b.role] || (a.region === "qatar" ? -1 : 1) - (b.region === "qatar" ? -1 : 1));

  const primary = groups.find((g) => g.role === "primary" && g.region === "qatar");
  const range = primary ? { scope: primary.scope, unit: primary.unit, low: primary.low, high: primary.high, median: primary.median, count: primary.count } : null;
  if (!primary) notes.push(`No active Qatar evidence for ${COMPARABLE_SCOPE_LABEL[primaryScope].toLowerCase()}. The recommendation rests on the cost floor; secondary scopes are shown for orientation only.`);
  if (groups.some((g) => g.region === "gcc")) notes.push("GCC evidence is shown separately and never merged into the Qatar range.");
  if (needsReverification.length) notes.push(`${needsReverification.length} observation${needsReverification.length === 1 ? "" : "s"} need re-verification before they can be used.`);
  if (req.service === "tournament_athlete" && !primary) notes.push("No defensible public Qatar BJJ per-athlete price is on file; do not infer one from adjacent scopes.");

  const confidence: MarketComparison["confidence"] = primary ? primary.confidence : "low";
  return { primaryScope, wanted, groups, range, excluded, needsReverification, confidence, notes };
}
