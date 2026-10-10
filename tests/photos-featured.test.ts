import { describe, expect, it } from "vitest";
import { buildSiteGallery, EMPTY_FEATURED_WORK, normalizeFeaturedWork, readFeaturedWork } from "@/lib/photos/featured";
import { focalPosition, manifestPhoto, manifestPlacements, type Manifest } from "@/lib/photos/manifest";

/** What visitors see is the pipeline's proposal filtered by the owner's approvals, and nothing until it is published. */
type ManifestPhoto = Manifest["photos"][string];
const photo = (id: string, over: Partial<ManifestPhoto> = {}): ManifestPhoto => ({ src: `/photos/bbm-x-${id}.jpg`, width: 2560, height: 1707, alt: `Alt ${id}`, category: "tournament_action", focal: { x: 0.4, y: 0.3 }, textSpace: "left", needsReview: false, score: 80, takenAt: null, folder: "e", ...over });
const A = "aaaaaaaaaaaa";
const B = "bbbbbbbbbbbb";
const C = "cccccccccccc";
const D = "dddddddddddd";
const manifest: Manifest = {
  generatedAt: "2026-10-10T00:00:00.000Z",
  placements: { hero: A, heroAlternates: [B], featured: [B, C, D], services: { tournament_athlete: [A, C], club: [D] }, shortlist: [A, B, C, D] },
  photos: { [A]: photo(A), [B]: photo(B), [C]: photo(C, { needsReview: true }), [D]: photo(D, { category: "team_club" }) },
};

describe("readFeaturedWork", () => {
  it("validates the settings blob and drops anything malformed", () => {
    expect(readFeaturedWork(null)).toEqual(EMPTY_FEATURED_WORK);
    expect(readFeaturedWork({ featuredWork: "nope" })).toEqual(EMPTY_FEATURED_WORK);
    const w = readFeaturedWork({ featuredWork: { published: true, approved: [A, "bad id", 3], rejected: [], hero: A, featured: [B], services: { club: [D], wedding: [A] }, alt: { [A]: " Two athletes ", zzz: "x" } } });
    expect(w).toEqual({ published: true, approved: [A], rejected: [], hero: A, featured: [B], services: { club: [D] }, alt: { [A]: "Two athletes" } });
  });
});

describe("normalizeFeaturedWork", () => {
  it("keeps only manifest ids, never approves a rejected photo, and clears a hero that is not approved", () => {
    const w = normalizeFeaturedWork({ published: true, approved: [A, B, "ffffffffffff"], rejected: [B], hero: B, featured: [B, A], services: { club: [D] }, alt: {} }, manifest);
    expect(w.approved).toEqual([A]);
    expect(w.rejected).toEqual([B]);
    expect(w.hero).toBeNull();
    expect(w.featured).toEqual([A]);
    expect(w.services.club).toEqual([]);
  });
});

describe("buildSiteGallery", () => {
  it("shows nothing to visitors until published, and the approved set to a studio preview", () => {
    const work = normalizeFeaturedWork({ ...EMPTY_FEATURED_WORK, approved: [A, B, D] }, manifest);
    const visitor = buildSiteGallery(work, manifest);
    expect(visitor.hero).toBeNull();
    expect(visitor.featured).toEqual([]);
    expect(visitor.pending).toBe(true);
    const preview = buildSiteGallery(work, manifest, { preview: true });
    expect(preview.hero?.id).toBe(A);
    expect(preview.featured.map((p) => p.id)).toEqual([B, D]);
    expect(preview.services.tournament_athlete.map((p) => p.id)).toEqual([A]);
    expect(preview.services.club.map((p) => p.id)).toEqual([D]);
  });

  it("never renders an unapproved or rejected photo, falls back to a hero alternate, and clears the review flag on approval", () => {
    const work = normalizeFeaturedWork({ ...EMPTY_FEATURED_WORK, published: true, approved: [B, C], rejected: [A] }, manifest);
    const g = buildSiteGallery(work, manifest);
    expect(g.published).toBe(true);
    expect(g.hero?.id).toBe(B);
    expect(g.featured.map((p) => p.id)).toEqual([C]);
    expect(g.featured[0].needsReview).toBe(false);
    expect(g.services.tournament_athlete.map((p) => p.id)).toEqual([C]);
    expect(g.services.club).toEqual([]);
  });

  it("honours the owner's hero, order and alt text", () => {
    const work = normalizeFeaturedWork({ published: true, approved: [A, B, C, D], rejected: [], hero: D, featured: [C, B], services: { club: [A] }, alt: { [B]: "A throw during a final" } }, manifest);
    const g = buildSiteGallery(work, manifest);
    expect(g.hero?.id).toBe(D);
    expect(g.featured.map((p) => p.id)).toEqual([C, B]);
    expect(g.featured[1].alt).toBe("A throw during a final");
    expect(g.services.club.map((p) => p.id)).toEqual([A]);
  });

  it("copes with an empty manifest", () => {
    const empty: Manifest = { generatedAt: null, placements: {}, photos: {} };
    expect(manifestPlacements(empty)).toEqual({ hero: null, heroAlternates: [], featured: [], services: { tournament_athlete: [], tournament_photo_video: [], club: [], training_session: [], private_session: [], custom: [] }, shortlist: [] });
    expect(manifestPhoto("zz", empty)).toBeNull();
    const g = buildSiteGallery({ ...EMPTY_FEATURED_WORK, published: true }, empty);
    expect(g).toMatchObject({ hero: null, featured: [], pending: false });
    expect(focalPosition({ focal: { x: 0.25, y: 1.4 } })).toBe("25% 100%");
  });
});
