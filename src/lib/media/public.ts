import "server-only";
import { cache } from "react";
import { isStudioRole, resolveViewer } from "@/lib/roles";
import { loadPublicStudio } from "@/lib/studio/queries";
import { createServiceClient, isServiceClientConfigured } from "@/lib/supabase/service";
import type { PhotoMediaPlacementRow } from "@/lib/supabase/database.types";
import { ALL_PLACEMENTS, orderedIds, parsePlacement } from "./placements";
import { toPublicMediaItem, type PublicProjectionInput } from "./projection";
import { supabasePublicBase } from "./queries";
import type { MediaPlacement } from "./types";

/**
 * CONTRACT between the media library (workstream C) and the public pages
 * (workstream B). Public reads return only published, safe fields: no
 * storage paths of drafts, no owner ids, no original filenames, no EXIF.
 *
 * Implementation: rows are read with the service role (the public site has
 * no session) for the single public owner (loadPublicStudio), then pushed
 * through the explicit projection in projection.ts. Only `published` assets
 * are returned to visitors. A studio user (owner/staff) who asks with
 * `preview: true` (the Work page's `?preview=1`) also sees `ready` assets,
 * so a selection can be checked before it goes live. Cached per request.
 */
export type { MediaPlacement } from "./types";

export type PublicMediaItem = {
  id: string;
  /** Public, immutable URL of the largest web derivative (never the original). */
  src: string;
  /** srcset candidates, ascending width. */
  sources: Array<{ src: string; width: number; height: number }>;
  width: number;
  height: number;
  alt: string;
  caption: string | null;
  category: string;
  tags: string[];
  focal: { x: number; y: number };
  blurDataURL?: string;
  takenOn: string | null;
};

export type PublicMediaQuery = {
  placement?: MediaPlacement;
  category?: string;
  limit?: number;
  /** Studio users only: include `ready` (unpublished) assets. Ignored for visitors. */
  preview?: boolean;
};

type Loaded = { rows: PublicProjectionInput[]; placements: Array<Pick<PhotoMediaPlacementRow, "asset_id" | "placement" | "position">>; base: string } | null;

/** Published + ready rows of the public owner, with their placements. One read per request. */
const loadRows = cache(async (): Promise<Loaded> => {
  if (!isServiceClientConfigured()) return null;
  const pub = await loadPublicStudio();
  if (!pub) return null;
  const owner = pub.studio.owner_id;
  const service = createServiceClient();
  const [{ data: rows }, { data: placements }] = await Promise.all([
    service
      .from("photo_media_assets")
      .select("id, status, derivatives, blur_data_url, alt, caption, category, tags, focal_x, focal_y, taken_on, sort_order, published_at")
      .eq("owner_id", owner)
      .in("status", ["published", "ready"])
      .order("sort_order", { ascending: true })
      .order("published_at", { ascending: false, nullsFirst: false }),
    service.from("photo_media_placements").select("asset_id, placement, position").eq("owner_id", owner),
  ]);
  return { rows: rows ?? [], placements: placements ?? [], base: supabasePublicBase() };
});

/** Whether the current request may see unpublished (`ready`) assets. Visitors never can. */
const canPreview = cache(async (): Promise<boolean> => {
  const viewer = await resolveViewer();
  return Boolean(viewer && isStudioRole(viewer.role));
});

export async function loadPublicMedia(query: PublicMediaQuery = {}): Promise<PublicMediaItem[]> {
  const loaded = await loadRows();
  if (!loaded) return [];
  const includeReady = query.preview === true && (await canPreview());
  const byId = new Map<string, PublicMediaItem>();
  for (const row of loaded.rows) {
    const item = toPublicMediaItem(row, loaded.base, { includeReady });
    if (item) byId.set(item.id, item);
  }
  let items: PublicMediaItem[];
  if (query.placement !== undefined) {
    const placement = parsePlacement(query.placement);
    if (!placement) return [];
    items = orderedIds(loaded.placements, placement)
      .map((id) => byId.get(id))
      .filter((i): i is PublicMediaItem => Boolean(i));
  } else {
    items = [...byId.values()];
  }
  if (query.category) items = items.filter((i) => i.category === query.category);
  if (query.limit !== undefined && Number.isFinite(query.limit)) items = items.slice(0, Math.max(0, Math.floor(query.limit)));
  return items;
}

export type PlacedMedia = { byPlacement: Record<string, PublicMediaItem[]>; /** True when a placed asset is ready but not yet published (and preview is off). */ pending: boolean; /** True when the library holds at least one published asset with a placement. */ published: boolean };

/** Every placement at once, for the home/services gallery. Same visibility rules as loadPublicMedia. */
export async function loadPlacedMedia({ preview = false }: { preview?: boolean } = {}): Promise<PlacedMedia | null> {
  const loaded = await loadRows();
  if (!loaded) return null;
  const includeReady = preview && (await canPreview());
  const visible = new Map<string, PublicMediaItem>();
  const readyIds = new Set<string>();
  for (const row of loaded.rows) {
    if (row.status === "ready") readyIds.add(row.id);
    const item = toPublicMediaItem(row, loaded.base, { includeReady });
    if (item) visible.set(item.id, item);
  }
  const byPlacement: Record<string, PublicMediaItem[]> = {};
  let pending = false;
  let published = false;
  for (const p of ALL_PLACEMENTS) {
    const ids = orderedIds(loaded.placements, p);
    byPlacement[p] = ids.map((id) => visible.get(id)).filter((i): i is PublicMediaItem => Boolean(i));
    for (const id of ids) {
      if (readyIds.has(id)) pending = true;
      else if (visible.has(id)) published = true;
    }
  }
  if (includeReady) pending = false;
  return { byPlacement, pending, published };
}
