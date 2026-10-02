import type { IdentityConfidence } from "./supabase/database.types";
import type { MatchRow } from "./types";
import { normalizeName } from "./watchers/extract";
import type { NormalizedMatch } from "./watchers/types";

/**
 * Decides which stored match row a freshly parsed match refers to.
 *
 * Confidence ladder:
 *   exact     – same external id, or same match number
 *   probable  – no ids, but exactly ONE stored row matches on a fallback key
 *               (sole row for a sole parsed match, opponent, or time ±60 s)
 *   ambiguous – a fallback key matches SEVERAL stored rows; the parsed match
 *               is NOT merged into any of them (a new row is created and
 *               flagged) so a wrong merge never rewrites history silently
 */
export type IdentityMatch =
  | { kind: "match"; row: MatchRow; confidence: Exclude<IdentityConfidence, "ambiguous"> }
  | { kind: "ambiguous"; candidates: MatchRow[] }
  | { kind: "none" };

export const TIME_TOLERANCE_MS = 60_000;

export function snapshotNumber(m: Pick<MatchRow, "raw_snapshot">): string | null {
  const snap = m.raw_snapshot;
  if (snap && typeof snap === "object" && !Array.isArray(snap)) {
    const n = (snap as Record<string, unknown>).matchNumber;
    return typeof n === "string" ? n : typeof n === "number" ? String(n) : null;
  }
  return null;
}

/**
 * Finds the stored row for `parsed` inside `pool` and removes it from the
 * pool when found. `pool` is mutated so each stored row is claimed at most once.
 */
export function takeMatching(pool: MatchRow[], parsed: NormalizedMatch, parsedCount: number): IdentityMatch {
  const take = (idx: number): MatchRow => pool.splice(idx, 1)[0];

  if (parsed.externalMatchId) {
    const idx = pool.findIndex((m) => m.external_match_id === parsed.externalMatchId);
    if (idx >= 0) return { kind: "match", row: take(idx), confidence: "exact" };
  }
  if (parsed.matchNumber) {
    const idx = pool.findIndex((m) => snapshotNumber(m) === parsed.matchNumber);
    if (idx >= 0) return { kind: "match", row: take(idx), confidence: "exact" };
  }

  // Rows that still carry an external id or a match number belong to other
  // parsed matches; only id-less rows are fallback candidates.
  const idLess = (m: MatchRow) => !m.external_match_id && !snapshotNumber(m);

  if (pool.length === 1 && parsedCount === 1 && idLess(pool[0])) {
    return { kind: "match", row: take(0), confidence: "probable" };
  }

  if (parsed.opponent) {
    const wanted = normalizeName(parsed.opponent);
    const candidates = pool.filter((m) => idLess(m) && normalizeName(m.opponent) === wanted);
    if (candidates.length === 1) return { kind: "match", row: take(pool.indexOf(candidates[0])), confidence: "probable" };
    if (candidates.length > 1) return { kind: "ambiguous", candidates };
  }

  if (parsed.scheduledAt) {
    const t = new Date(parsed.scheduledAt).getTime();
    if (!Number.isNaN(t)) {
      const candidates = pool.filter((m) => idLess(m) && m.scheduled_at && Math.abs(new Date(m.scheduled_at).getTime() - t) < TIME_TOLERANCE_MS);
      if (candidates.length === 1) return { kind: "match", row: take(pool.indexOf(candidates[0])), confidence: "probable" };
      if (candidates.length > 1) return { kind: "ambiguous", candidates };
    }
  }

  return { kind: "none" };
}
