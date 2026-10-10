// Scoring, duplicate clustering, diversity-aware selection and placement.
// Pure functions over the analysis records, so the selection is reproducible
// and unit-testable. Scores are decision support; the overrides file wins.
import { colorDistance, hamming, percentile } from "./lib.mjs";

/** Hamming distance (out of 64) at or below which two frames count as the same picture, provided their colours agree too. */
export const NEAR_DUPLICATE_BITS = 6;
/** Mean per-channel colour difference (0..255) above which two frames are different pictures even with matching structure. */
export const NEAR_DUPLICATE_COLOR = 14;

export function isNearDuplicate(a, b) {
  if (a.sha256 === b.sha256) return true;
  if (hamming(a.dhash, b.dhash) > NEAR_DUPLICATE_BITS) return false;
  return !a.colorSig || !b.colorSig || colorDistance(a.colorSig, b.colorSig) <= NEAR_DUPLICATE_COLOR;
}
/** Below this long edge an image is too small for a hero or a wide card. */
export const MIN_LONG_EDGE = 1200;
export const HERO_MIN_LONG_EDGE = 2000;

export const SERVICE_CATEGORIES = {
  tournament_athlete: ["tournament_action", "victory_podium"],
  club: ["team_club", "tournament_action", "coaching_moment"],
  training_session: ["training_session", "coaching_moment"],
  private_session: ["athlete_portrait", "brand_general"],
  custom: ["victory_podium", "behind_the_scenes", "team_club", "brand_general", "coaching_moment"],
};

/** The event or sequence an image belongs to: the EXIF day, else its folder. Used to spread the selection out. */
export function sequenceKey(rec) {
  const day = rec.exif?.takenAt?.slice(0, 10);
  return day ? `day:${day}` : `dir:${rec.dir}`;
}

/**
 * 0..100. Vision judgement carries most of the weight; technical signals
 * adjust it; hard problems remove the image from consideration.
 */
export function scoreRecord(rec, batch) {
  const v = rec.vision;
  const reasons = [];
  const exclude = [];
  if (!v || v.refused) exclude.push("no vision assessment");
  if (rec.longEdge < MIN_LONG_EDGE) exclude.push(`too small for the web (${rec.longEdge}px)`);
  if (v?.sensitive) exclude.push("flagged as sensitive");
  const sharpP = percentile(batch.sharpness, rec.metrics.sharpness);
  const exp = rec.metrics.exposure;
  if (v && !v.intentional_motion_blur && sharpP < 0.08 && v.scores.technical <= 4) exclude.push("soft or blurred without intent");
  if (exp.highlightsClipped > 0.12) exclude.push("large blown-out area");
  if (exp.shadowsClipped > 0.45 && (v?.scores.technical ?? 0) <= 5) exclude.push("mostly crushed shadows");

  let score = 0;
  if (v && !v.refused) {
    const s = v.scores;
    const vision = s.technical * 0.15 + s.composition * 0.2 + s.peak_action * 0.2 + s.emotion * 0.15 + s.subject_clarity * 0.15 + s.brand_fit * 0.15;
    score = vision * 7; // up to 70
    reasons.push(`vision ${vision.toFixed(1)}/10`);
    const tech = sharpP * 12 + (1 - Math.min(1, rec.metrics.noise / 12)) * 6 + (exp.mean > 0.18 && exp.mean < 0.8 ? 6 : 2) + (rec.longEdge >= HERO_MIN_LONG_EDGE ? 6 : rec.longEdge >= 1600 ? 4 : 1);
    score += tech; // up to 30
    reasons.push(`technical ${tech.toFixed(0)}/30`);
    if (v.issues?.length) {
      score -= Math.min(15, v.issues.length * 4);
      reasons.push(`issues: ${v.issues.join("; ")}`);
    }
  }
  const needsReview = Boolean(v && (v.minors_likely || v.visible_third_party_branding || ["training_session", "athlete_portrait", "behind_the_scenes"].includes(v.category)));
  return { score: Math.max(0, Math.round(score * 10) / 10), exclude, reasons, needsReview };
}

/** Groups near-identical frames (burst sequences, re-exports). Returns the best record per cluster plus the cluster members. */
export function clusterDuplicates(records) {
  const clusters = [];
  for (const rec of records) {
    const home = clusters.find((c) => c.some((m) => isNearDuplicate(m, rec)));
    if (home) home.push(rec);
    else clusters.push([rec]);
  }
  return clusters.map((members) => {
    const sorted = [...members].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    return { best: sorted[0], members: sorted };
  });
}

/**
 * Greedy diverse pick: highest score first, with a penalty for repeating the
 * same sequence (event day or folder) or category too often, so the result
 * shows range rather than ten frames of one athlete.
 */
export function pickDiverse(candidates, count, { sequencePenalty = 12, categoryPenalty = 6, categoryCap = Infinity } = {}) {
  const chosen = [];
  const seq = new Map();
  const cat = new Map();
  const pool = [...candidates];
  while (chosen.length < count && pool.length) {
    pool.sort((a, b) => adjusted(b) - adjusted(a) || a.id.localeCompare(b.id));
    const next = pool.shift();
    if ((cat.get(next.vision.category) ?? 0) >= categoryCap) continue;
    chosen.push(next);
    seq.set(sequenceKey(next), (seq.get(sequenceKey(next)) ?? 0) + 1);
    cat.set(next.vision.category, (cat.get(next.vision.category) ?? 0) + 1);
  }
  return chosen;
  function adjusted(r) {
    return r.score - (seq.get(sequenceKey(r)) ?? 0) * sequencePenalty - (cat.get(r.vision.category) ?? 0) * categoryPenalty;
  }
}

/** Below this score a slot is left short rather than filled with a weak picture. */
export const MIN_PLACEMENT_SCORE = 55;

/** Slot sizes: [minimum worth showing, maximum]. A slot never pads with mediocre frames to reach the maximum. */
export const SLOT_SIZES = {
  hero_alternates: [0, 3],
  featured: [8, 12],
  tournament_athlete: [3, 5],
  tournament_photo_video: [2, 3],
  club: [3, 5],
  training_session: [3, 5],
  private_session: [3, 5],
  custom: [2, 3],
};

export const SERVICE_SLOT_CATEGORIES = { ...SERVICE_CATEGORIES, tournament_photo_video: ["tournament_action", "coaching_moment"] };

/**
 * Builds the placement plan from the usable, de-duplicated, scored records:
 * a shortlist of the strongest 30 to 50 frames, one hero plus alternates,
 * the home-page featured set, and a few frames per service. Service slots
 * may reuse excellent frames; the hero is never repeated in the featured set.
 * Overrides (`photos/overrides.json`) can exclude files, pin a file to a slot
 * or replace alt text; they are matched by id or file name.
 */
export function plan(records, overrides, options = {}) {
  const sizes = { ...SLOT_SIZES, ...(options.sizes ?? {}) };
  const minScore = options.minScore ?? MIN_PLACEMENT_SCORE;
  const byRef = (ref) => records.find((r) => r.id === ref || r.file === ref || r.relative === ref || r.name === ref) ?? null;
  const excluded = new Set((overrides.exclude ?? []).map((ref) => byRef(ref)?.id).filter(Boolean));
  const usable = records.filter((r) => r.vision && !r.vision.refused && !r.exclude.length && !excluded.has(r.id));
  const kept = clusterDuplicates(usable).map((c) => c.best);
  const pinned = (ref) => (ref ? byRef(ref) : null);
  const pinsFor = (list) => (list ?? []).map(byRef).filter(Boolean);
  const good = (r) => r.score >= minScore;

  // 1. Shortlist: the strongest 30-50, spread across events and categories.
  const shortlistSize = Math.min(50, Math.max(30, Math.round(kept.length * 0.15)));
  const shortlist = pickDiverse(kept.filter(good), shortlistSize, { sequencePenalty: 10, categoryPenalty: 3, categoryCap: Math.ceil(shortlistSize / 2) });
  const shortIds = new Set(shortlist.map((r) => r.id));
  const fromShortlist = (list) => list.filter((r) => shortIds.has(r.id));

  // 2. Hero and alternates: landscape, big, clean space for the headline, nothing awaiting approval.
  const heroPin = pinned(overrides.pin?.hero);
  const heroPool = fromShortlist(kept.filter((r) => r.vision.hero_suitable && r.vision.text_space !== "none" && r.orientation !== "portrait" && r.longEdge >= HERO_MIN_LONG_EDGE && !r.needsReview));
  const heroPicks = [...(heroPin ? [heroPin] : []), ...pickDiverse(heroPool.filter((r) => r.id !== heroPin?.id), 1 + sizes.hero_alternates[1])];
  const hero = heroPicks[0] ?? null;
  const heroAlternates = heroPicks.slice(1, 1 + sizes.hero_alternates[1]).map((r) => r.id);

  // 3. Featured work: the showcase on the home page; never the hero itself.
  const featuredPins = pinsFor(overrides.pin?.featured ?? overrides.pin?.showcase);
  const featuredPool = fromShortlist(kept.filter((r) => r.id !== hero?.id && !featuredPins.some((p) => p.id === r.id)));
  const featured = [...featuredPins, ...pickDiverse(featuredPool, Math.max(0, sizes.featured[1] - featuredPins.length), { categoryCap: Math.ceil(sizes.featured[1] / 3) })].slice(0, sizes.featured[1]);

  // 4. Services: category-matched; the first category of a slot is preferred; excellent frames may serve more than one slot.
  const services = {};
  for (const [slot, cats] of Object.entries(SERVICE_SLOT_CATEGORIES)) {
    const [, max] = sizes[slot] ?? [0, 3];
    const pins = pinsFor(overrides.pin?.services?.[slot]);
    const pool = kept.filter((r) => good(r) && (cats.includes(r.vision.category) || r.vision.placements?.includes(slot)) && !pins.some((p) => p.id === r.id));
    const ranked = pool.map((r) => ({ ...r, score: r.score + (cats.indexOf(r.vision.category) === 0 ? 4 : 0) + (shortIds.has(r.id) ? 3 : 0) }));
    services[slot] = [...pins, ...pickDiverse(ranked, Math.max(0, max - pins.length), { sequencePenalty: 15 })].slice(0, max).map((r) => r.id);
  }

  const placements = { hero: hero?.id ?? null, heroAlternates, featured: featured.map((r) => r.id), services, shortlist: shortlist.map((r) => r.id) };
  // Backwards-compatible alias used by the first manifest format.
  placements.showcase = placements.featured;
  return { placements, usable: kept, shortlist, excludedByOverride: [...excluded] };
}
