import { SERVICE_SLOTS, isServiceSlot, type ServiceSlot } from "@/lib/photos/manifest";
import type { MediaPlacement } from "./types";

/**
 * Placement vocabulary and ordering. Pure, so the rules that decide what the
 * home page, the services page and the Work page show are unit-tested.
 *
 *   hero             one photograph behind the home headline
 *   featured         the home-page showcase, ordered
 *   work             the public Work page, ordered
 *   service:<slot>   per-service images (slot = SERVICE_SLOTS of the manifest)
 *
 * The catalog's service keys (src/lib/catalog) map onto the same slots so the
 * public pages can ask by either name.
 */
export const FIXED_PLACEMENTS = ["hero", "featured", "work"] as const;
export const SERVICE_PLACEMENTS: readonly MediaPlacement[] = SERVICE_SLOTS.map((s) => `service:${s}` as const);
export const ALL_PLACEMENTS: readonly MediaPlacement[] = [...FIXED_PLACEMENTS, ...SERVICE_PLACEMENTS];

const CATALOG_TO_SLOT: Record<string, ServiceSlot> = {
  tournament_athlete: "tournament_athlete",
  team_tournament: "club",
  training_content: "training_session",
  athlete_portrait: "private_session",
  organizer_custom: "custom",
};

export const PLACEMENT_LABEL: Record<string, string> = {
  hero: "Home page hero",
  featured: "Featured work (home page)",
  work: "Work page",
  "service:tournament_athlete": "Tournament photography",
  "service:tournament_photo_video": "Tournament photo and video",
  "service:club": "Team and club coverage",
  "service:training_session": "Training sessions",
  "service:private_session": "Athlete portraits and private sessions",
  "service:custom": "Other coverage",
};

/** How many assets a placement holds at most (hero is single). */
export const PLACEMENT_LIMIT: Record<string, number> = { hero: 1, featured: 12, work: 60 };
export function placementLimit(p: MediaPlacement): number {
  return PLACEMENT_LIMIT[p] ?? 6;
}

/** Normalises any accepted spelling to a canonical placement, or null when unknown. */
export function parsePlacement(value: unknown): MediaPlacement | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if ((FIXED_PLACEMENTS as readonly string[]).includes(v)) return v as MediaPlacement;
  if (!v.startsWith("service:")) return null;
  const key = v.slice("service:".length);
  if (isServiceSlot(key)) return `service:${key}`;
  const mapped = CATALOG_TO_SLOT[key];
  return mapped ? `service:${mapped}` : null;
}

export function isPlacement(value: unknown): value is MediaPlacement {
  return parsePlacement(value) === value;
}

export function serviceSlotOf(p: MediaPlacement): ServiceSlot | null {
  if (!p.startsWith("service:")) return null;
  const key = p.slice("service:".length);
  return isServiceSlot(key) ? key : null;
}

export type PlacementEntry = { asset_id: string; placement: string; position: number };

/** Asset ids of one placement in display order (position, then stable by id). Unknown placements are ignored. */
export function orderedIds(rows: readonly PlacementEntry[], placement: MediaPlacement): string[] {
  const canonical = parsePlacement(placement);
  if (!canonical) return [];
  const seen = new Set<string>();
  return rows
    .filter((r) => parsePlacement(r.placement) === canonical)
    .sort((a, b) => a.position - b.position || a.asset_id.localeCompare(b.asset_id))
    .map((r) => r.asset_id)
    .filter((id) => (seen.has(id) ? false : (seen.add(id), true)));
}

/** Every placement grouped: { hero: [...], featured: [...], ... } with canonical keys. */
export function groupPlacements(rows: readonly PlacementEntry[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const p of ALL_PLACEMENTS) out[p] = orderedIds(rows, p);
  return out;
}

/**
 * Rows to write for a placement from an ordered id list: duplicates removed,
 * the hero reduced to one, the list capped at the placement's limit.
 */
export function placementRows(placement: MediaPlacement, orderedAssetIds: readonly string[]): Array<{ placement: MediaPlacement; asset_id: string; position: number }> {
  const canonical = parsePlacement(placement);
  if (!canonical) return [];
  const ids = [...new Set(orderedAssetIds)].slice(0, placementLimit(canonical));
  return ids.map((asset_id, position) => ({ placement: canonical, asset_id, position }));
}
