import type { Json } from "@/lib/supabase/database.types";
import { isPlainObject } from "@/lib/validation";
import { isServiceSlot, manifestPhoto, manifestPlacements, SERVICE_SLOTS, type Manifest, type ServiceSlot, type SitePhoto } from "./manifest";

/**
 * The owner's decisions about the pipeline's proposal, kept in
 * photo_studio.settings.featuredWork and edited on the Featured work page.
 * Pure: reading and applying never touch the database, so the rules that
 * decide what visitors see are unit-tested.
 */
export type FeaturedWork = {
  /** Visitors see photographs only when this is on. Studio users preview the pending state before that. */
  published: boolean;
  approved: string[];
  rejected: string[];
  /** Explicit hero; null = the pipeline's choice (first approved candidate). */
  hero: string | null;
  /** Explicit featured order; empty = the pipeline's order filtered by approval. */
  featured: string[];
  services: Partial<Record<ServiceSlot, string[]>>;
  alt: Record<string, string>;
};

export const EMPTY_FEATURED_WORK: FeaturedWork = { published: false, approved: [], rejected: [], hero: null, featured: [], services: {}, alt: {} };

const ID_RE = /^[a-f0-9]{12}$/;
const ids = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && ID_RE.test(x)) : []);

/** Validated read: unknown keys and malformed ids are dropped, so a stray setting never breaks the site. */
export function readFeaturedWork(settings: Json | null | undefined): FeaturedWork {
  if (!isPlainObject(settings) || !isPlainObject(settings.featuredWork)) return EMPTY_FEATURED_WORK;
  const fw = settings.featuredWork;
  const services: Partial<Record<ServiceSlot, string[]>> = {};
  if (isPlainObject(fw.services)) for (const [slot, list] of Object.entries(fw.services)) if (isServiceSlot(slot)) services[slot] = ids(list);
  const alt: Record<string, string> = {};
  if (isPlainObject(fw.alt)) for (const [id, text] of Object.entries(fw.alt)) if (ID_RE.test(id) && typeof text === "string" && text.trim()) alt[id] = text.trim().slice(0, 300);
  return {
    published: fw.published === true,
    approved: ids(fw.approved),
    rejected: ids(fw.rejected),
    hero: typeof fw.hero === "string" && ID_RE.test(fw.hero) ? fw.hero : null,
    featured: ids(fw.featured),
    services,
    alt,
  };
}

/** Normalises a submission from the Featured work page against the manifest: only known ids, no id both approved and rejected. */
export function normalizeFeaturedWork(input: FeaturedWork, manifest: Manifest): FeaturedWork {
  const known = (id: string) => manifestPhoto(id, manifest) !== null;
  const rejected = new Set(input.rejected.filter(known));
  const approved = [...new Set(input.approved.filter((id) => known(id) && !rejected.has(id)))];
  const isApproved = (id: string) => approved.includes(id);
  const services: Partial<Record<ServiceSlot, string[]>> = {};
  for (const slot of SERVICE_SLOTS) {
    const list = input.services[slot];
    if (list) services[slot] = [...new Set(list.filter(isApproved))];
  }
  const alt: Record<string, string> = {};
  for (const [id, text] of Object.entries(input.alt)) if (known(id) && text.trim()) alt[id] = text.trim().slice(0, 300);
  return {
    published: Boolean(input.published),
    approved,
    rejected: [...rejected],
    hero: input.hero && isApproved(input.hero) ? input.hero : null,
    featured: [...new Set(input.featured.filter(isApproved))],
    services,
    alt,
  };
}

export type SiteGallery = {
  hero: SitePhoto | null;
  featured: SitePhoto[];
  services: Record<ServiceSlot, SitePhoto[]>;
  /** True when the owner has switched the selection live. */
  published: boolean;
  /** True when there is an approved selection that visitors cannot see yet. */
  pending: boolean;
};

export const EMPTY_GALLERY: SiteGallery = { hero: null, featured: [], services: { tournament_athlete: [], tournament_photo_video: [], club: [], training_session: [], private_session: [], custom: [] }, published: false, pending: false };

/**
 * What a visitor (or, with `preview`, a studio user) sees: the manifest's
 * proposal filtered by the owner's approvals and reordered by their
 * choices. Nothing unapproved ever renders, and nothing renders for
 * visitors until the selection is published.
 */
export function buildSiteGallery(work: FeaturedWork, manifest: Manifest, { preview = false }: { preview?: boolean } = {}): SiteGallery {
  const approvedSet = new Set(work.approved);
  const rejectedSet = new Set(work.rejected);
  const visible = (id: string | null | undefined): SitePhoto | null => {
    if (!id || !approvedSet.has(id) || rejectedSet.has(id)) return null;
    const p = manifestPhoto(id, manifest);
    if (!p) return null;
    // An explicit approval is the owner's confirmation, so the review flag is cleared here.
    return { ...p, needsReview: false, alt: work.alt[id] ?? p.alt };
  };
  const list = (chosen: string[], fallback: string[]): SitePhoto[] => {
    const source = chosen.length ? chosen : fallback;
    const out: SitePhoto[] = [];
    for (const id of source) {
      const p = visible(id);
      if (p && !out.some((o) => o.id === p.id)) out.push(p);
    }
    return out;
  };
  const plan = manifestPlacements(manifest);
  const hero = visible(work.hero) ?? [plan.hero, ...plan.heroAlternates].map(visible).find((p): p is SitePhoto => p !== null) ?? null;
  const featured = list(work.featured, plan.featured).filter((p) => p.id !== hero?.id);
  const services = { ...EMPTY_GALLERY.services };
  for (const slot of SERVICE_SLOTS) services[slot] = list(work.services[slot] ?? [], plan.services[slot] ?? []);
  const anything = Boolean(hero || featured.length || SERVICE_SLOTS.some((s) => services[s].length));
  const show = work.published || preview;
  return {
    hero: show ? hero : null,
    featured: show ? featured : [],
    services: show ? services : { ...EMPTY_GALLERY.services },
    published: work.published,
    pending: anything && !work.published,
  };
}
