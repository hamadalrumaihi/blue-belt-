import { describe, expect, it } from "vitest";
import { clusterDuplicates, isNearDuplicate, pickDiverse, plan, scoreRecord, sequenceKey } from "../scripts/photos/select.mjs";
import { colorDistance, hamming, readExif } from "../scripts/photos/lib.mjs";

/**
 * The selection logic of the photo pipeline (scripts/photos). Pure functions
 * over analysis records, so the choices are reproducible and the site's
 * placement rules are pinned here.
 */
type Vision = {
  refused: false;
  category: string;
  description: string;
  scores: { technical: number; composition: number; peak_action: number; emotion: number; subject_clarity: number; brand_fit: number };
  minors_likely: boolean;
  sensitive: boolean;
  visible_third_party_branding: boolean;
  hero_suitable: boolean;
  text_space: string;
  focal_point: { x: number; y: number };
  intentional_motion_blur: boolean;
  issues: string[];
  placements: string[];
};

let n = 0;
function rec(over: Record<string, unknown> = {}, vision: Partial<Vision> = {}) {
  n += 1;
  const v: Vision = {
    refused: false,
    category: "tournament_action",
    description: "Two athletes grappling on a competition mat.",
    scores: { technical: 8, composition: 8, peak_action: 8, emotion: 7, subject_clarity: 8, brand_fit: 8 },
    minors_likely: false,
    sensitive: false,
    visible_third_party_branding: false,
    hero_suitable: true,
    text_space: "left",
    focal_point: { x: 0.5, y: 0.4 },
    intentional_motion_blur: false,
    issues: [],
    placements: [],
    ...vision,
  };
  return {
    id: `id${String(n).padStart(3, "0")}`,
    sha256: `sha${n}`,
    file: `event-a/img${n}.jpg`,
    relative: `event-a/img${n}.jpg`,
    name: `img${n}.jpg`,
    dir: "event-a",
    dhash: ((BigInt(n) * BigInt("0x9e3779b97f4a7c15")) & BigInt("0xffffffffffffffff")).toString(16).padStart(16, "0"),
    colorSig: Buffer.alloc(48, n * 5).toString("hex"),
    longEdge: 4000,
    orientation: "landscape",
    exif: { takenAt: "2026-09-20T10:00:00", make: null, model: null },
    metrics: { sharpness: 300, noise: 2, exposure: { mean: 0.45, shadowsClipped: 0.01, highlightsClipped: 0.005 }, contrast: 0.2 },
    vision: v,
    ...over,
  };
}

const batch = { sharpness: [50, 100, 200, 300, 400, 500] };

describe("scoreRecord", () => {
  it("scores a strong, sharp, well exposed frame highly and explains why", () => {
    const r = rec();
    const s = scoreRecord(r, batch);
    expect(s.exclude).toEqual([]);
    expect(s.score).toBeGreaterThan(70);
    expect(s.reasons[0]).toMatch(/^vision 7\.9\/10|^vision 8\.0\/10/);
    expect(s.needsReview).toBe(false);
  });

  it("excludes sensitive, tiny, blown-out or unassessed frames, but keeps intentional motion blur", () => {
    expect(scoreRecord(rec({}, { sensitive: true }), batch).exclude).toContain("flagged as sensitive");
    expect(scoreRecord(rec({ longEdge: 1000 }), batch).exclude[0]).toMatch(/too small/);
    expect(scoreRecord(rec({ metrics: { ...rec().metrics, exposure: { mean: 0.6, shadowsClipped: 0, highlightsClipped: 0.3 } } }), batch).exclude).toContain("large blown-out area");
    expect(scoreRecord(rec({ vision: null }), batch).exclude).toContain("no vision assessment");
    const soft = { ...rec().metrics, sharpness: 10 };
    expect(scoreRecord(rec({ metrics: soft }, { scores: { technical: 3, composition: 8, peak_action: 9, emotion: 8, subject_clarity: 7, brand_fit: 8 } }), batch).exclude).toContain("soft or blurred without intent");
    expect(scoreRecord(rec({ metrics: soft }, { intentional_motion_blur: true, scores: { technical: 3, composition: 8, peak_action: 9, emotion: 8, subject_clarity: 7, brand_fit: 8 } }), batch).exclude).toEqual([]);
  });

  it("flags minors, third-party branding and private settings for approval without excluding them", () => {
    expect(scoreRecord(rec({}, { minors_likely: true }), batch).needsReview).toBe(true);
    expect(scoreRecord(rec({}, { visible_third_party_branding: true }), batch).needsReview).toBe(true);
    expect(scoreRecord(rec({}, { category: "training_session" }), batch).needsReview).toBe(true);
    expect(scoreRecord(rec({}, { category: "victory_podium" }), batch).needsReview).toBe(false);
  });
});

describe("duplicates", () => {
  it("treats the same bytes, or the same structure and colours, as one picture", () => {
    const a = rec();
    const sameBytes = rec({ sha256: a.sha256 });
    const sameLook = rec({ dhash: a.dhash, colorSig: a.colorSig });
    const sameLayoutDifferentColours = rec({ dhash: a.dhash, colorSig: Buffer.alloc(48, 200).toString("hex") });
    expect(isNearDuplicate(a, sameBytes)).toBe(true);
    expect(isNearDuplicate(a, sameLook)).toBe(true);
    expect(isNearDuplicate(a, sameLayoutDifferentColours)).toBe(false);
    expect(hamming("0000000000000000", "000000000000000f")).toBe(4);
    expect(colorDistance(Buffer.alloc(48, 10).toString("hex"), Buffer.alloc(48, 20).toString("hex"))).toBe(10);
  });

  it("keeps the best-scoring frame of each cluster", () => {
    const a = { ...rec(), score: 60 };
    const b = { ...rec({ dhash: a.dhash, colorSig: a.colorSig }), score: 80 };
    const c = { ...rec(), score: 70 };
    const clusters = clusterDuplicates([a, b, c]);
    expect(clusters).toHaveLength(2);
    expect(clusters[0].best.id).toBe(b.id);
    expect(clusters[0].members.map((m) => m.id)).toEqual([b.id, a.id]);
  });
});

describe("pickDiverse", () => {
  it("spreads picks across events and categories instead of taking one burst", () => {
    const burst = Array.from({ length: 4 }, (_, i) => ({ ...rec({ exif: { takenAt: "2026-09-20T10:00:00" } }), score: 90 - i }));
    const otherDay = { ...rec({ exif: { takenAt: "2026-08-02T10:00:00" } }, { category: "team_club" }), score: 75 };
    const picks = pickDiverse([...burst, otherDay], 3);
    expect(picks.map((p) => p.id)).toContain(otherDay.id);
    expect(sequenceKey(otherDay)).toBe("day:2026-08-02");
    expect(sequenceKey(rec({ exif: { takenAt: null } }))).toBe("dir:event-a");
  });
});

type Placements = { hero: string | null; heroAlternates: string[]; featured: string[]; shortlist: string[]; showcase: string[]; services: Record<string, string[]> };
const planOf = (...args: Parameters<typeof plan>) => plan(...args) as Omit<ReturnType<typeof plan>, "placements"> & { placements: Placements };

describe("plan", () => {
  function scored(over: Record<string, unknown> = {}, vision: Partial<Vision> = {}) {
    const r = rec(over, vision);
    return { ...r, ...scoreRecord(r, batch) };
  }

  it("fills hero, service slots and the showcase from different pictures, honouring overrides", () => {
    const records = [
      scored({ longEdge: 4500 }),
      scored({}, { category: "victory_podium", hero_suitable: false }),
      scored({}, { category: "team_club", hero_suitable: false }),
      scored({}, { category: "training_session", hero_suitable: false }),
      scored({}, { category: "athlete_portrait", hero_suitable: false }),
      scored({}, { category: "coaching_moment", hero_suitable: false }),
      scored({ orientation: "portrait" }, { category: "brand_general" }),
    ];
    const excluded = records[1];
    const pinnedHero = records[2];
    const { placements, excludedByOverride } = planOf(records, { exclude: [excluded.file], pin: { hero: pinnedHero.id } }, { minScore: 0 });
    expect(excludedByOverride).toEqual([excluded.id]);
    expect(placements.hero).toBe(pinnedHero.id);
    expect(placements.heroAlternates).not.toContain(pinnedHero.id);
    expect(placements.heroAlternates.length).toBeLessThanOrEqual(3);
    for (const ids of Object.values(placements.services)) expect(ids).not.toContain(excluded.id);
    expect(placements.services.training_session).toContain(records[3].id);
    expect(placements.services.private_session).toContain(records[4].id);
    expect(placements.services.tournament_photo_video).toContain(records[0].id);
    expect(placements.featured).not.toContain(placements.hero);
    expect(placements.featured).not.toContain(excluded.id);
    expect(placements.featured.length).toBeGreaterThan(0);
    expect(placements.shortlist).toContain(records[0].id);
    expect(placements.shortlist).not.toContain(excluded.id);
  });

  it("never puts a portrait, a small file or a flagged photo in the hero slot", () => {
    const records = [
      scored({ orientation: "portrait", longEdge: 4000 }),
      scored({ longEdge: 1500 }),
      scored({}, { minors_likely: true }),
      scored({}, { text_space: "none" }),
    ];
    expect(plan(records, {}, { minScore: 0 }).placements.hero).toBeNull();
    expect(plan([...records, scored({ longEdge: 3000 })], {}, { minScore: 0 }).placements.hero).toBe(`id${String(n).padStart(3, "0")}`);
  });

  it("copes with an empty set", () => {
    const { placements } = plan([], {});
    expect(placements).toEqual({ hero: null, heroAlternates: [], featured: [], shortlist: [], showcase: [], services: { tournament_athlete: [], club: [], training_session: [], private_session: [], custom: [], tournament_photo_video: [] } });
  });

  it("leaves a slot short rather than filling it with weak frames", () => {
    const weak = Array.from({ length: 6 }, () => ({ ...scored({}, { category: "team_club", hero_suitable: false }), score: 30 }));
    const { placements } = planOf(weak, {});
    expect(placements.services.club).toEqual([]);
    expect(placements.featured).toEqual([]);
  });
});

describe("readExif", () => {
  it("returns nulls for missing or malformed EXIF", () => {
    expect(readExif(undefined)).toEqual({ takenAt: null, make: null, model: null });
    expect(readExif(Buffer.from("Exif\0\0garbage-data-here"))).toEqual({ takenAt: null, make: null, model: null });
  });
});
