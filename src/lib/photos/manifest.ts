import manifestJson from "../../../public/photos/manifest.json";

/**
 * The curated photo set produced by scripts/photos (see photos/README.md),
 * read at build time from public/photos/manifest.json. This module only
 * describes what the pipeline proposed; what is shown on the website is
 * decided by the owner's approvals (src/lib/photos/featured.ts) and combined
 * in src/lib/photos/site.ts. Every accessor tolerates an empty manifest.
 */
export type PhotoCategory = "tournament_action" | "athlete_portrait" | "training_session" | "team_club" | "coaching_moment" | "victory_podium" | "behind_the_scenes" | "brand_general";

/** Service photo slots: the five booking types plus the photo-and-video variant of a tournament booking. */
export const SERVICE_SLOTS = ["tournament_athlete", "tournament_photo_video", "club", "training_session", "private_session", "custom"] as const;
export type ServiceSlot = (typeof SERVICE_SLOTS)[number];
export const SERVICE_SLOT_LABEL: Record<ServiceSlot, string> = {
  tournament_athlete: "Tournament photography",
  tournament_photo_video: "Tournament photo and video",
  club: "Team and club coverage",
  training_session: "Training sessions",
  private_session: "Athlete portraits and private sessions",
  custom: "Other coverage",
};

export type SitePhoto = {
  id: string;
  src: string;
  width: number;
  height: number;
  alt: string;
  category: PhotoCategory;
  /** Where the subject sits (0..1 from the top-left), used as the CSS object-position for crops. */
  focal: { x: number; y: number };
  textSpace: "left" | "right" | "top" | "bottom" | "none";
  blurDataURL?: string;
  /** Flagged by the pipeline for the owner's confirmation (minors, private sessions, third-party branding). */
  needsReview: boolean;
  score: number;
  takenAt: string | null;
  folder: string | null;
};

export type ManifestPlacements = {
  hero: string | null;
  heroAlternates: string[];
  featured: string[];
  services: Partial<Record<ServiceSlot, string[]>>;
  shortlist: string[];
};

type ManifestPhoto = Partial<Omit<SitePhoto, "id">> & { source?: string };
export type Manifest = { generatedAt: string | null; placements: Partial<ManifestPlacements> & { showcase?: string[] }; photos: Record<string, ManifestPhoto> };

const manifest = manifestJson as unknown as Manifest;

export function isServiceSlot(v: unknown): v is ServiceSlot {
  return typeof v === "string" && (SERVICE_SLOTS as readonly string[]).includes(v);
}

/** One photo by id, or null when the manifest does not know it or the entry is incomplete. */
export function manifestPhoto(id: string | null | undefined, source: Manifest = manifest): SitePhoto | null {
  if (!id) return null;
  const p = source.photos?.[id];
  if (!p || !p.src || !p.width || !p.height || !p.category) return null;
  return {
    id,
    src: p.src,
    width: p.width,
    height: p.height,
    alt: p.alt ?? "",
    category: p.category,
    focal: p.focal ?? { x: 0.5, y: 0.5 },
    textSpace: p.textSpace ?? "none",
    blurDataURL: p.blurDataURL,
    needsReview: Boolean(p.needsReview),
    score: typeof p.score === "number" ? p.score : 0,
    takenAt: p.takenAt ?? null,
    folder: p.folder ?? null,
  };
}

export function manifestPlacements(source: Manifest = manifest): ManifestPlacements {
  const p = source.placements ?? {};
  const services: Partial<Record<ServiceSlot, string[]>> = {};
  for (const slot of SERVICE_SLOTS) services[slot] = [...(p.services?.[slot] ?? [])];
  return { hero: p.hero ?? null, heroAlternates: [...(p.heroAlternates ?? [])], featured: [...(p.featured ?? p.showcase ?? [])], services, shortlist: [...(p.shortlist ?? [])] };
}

/** Every photo the manifest carries, strongest first. */
export function manifestPhotos(source: Manifest = manifest): SitePhoto[] {
  return Object.keys(source.photos ?? {})
    .map((id) => manifestPhoto(id, source))
    .filter((p): p is SitePhoto => p !== null)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

export function manifestGeneratedAt(source: Manifest = manifest): string | null {
  return source.generatedAt ?? null;
}

/** `object-position` for a cover crop that keeps the subject in frame. */
export function focalPosition(p: Pick<SitePhoto, "focal">): string {
  const pct = (n: number) => `${Math.round(Math.min(1, Math.max(0, n)) * 100)}%`;
  return `${pct(p.focal.x)} ${pct(p.focal.y)}`;
}
