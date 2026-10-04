import { effectiveMatch } from "./manual-correction";
import type { AthleteWithMatches, MatchRow, MatchStatus } from "./types";
import { isMatchStatus } from "./types";

/** A match row with the owner's active corrections applied and labelled. */
export type EffectiveMatch = MatchRow & { manual?: { mat: boolean; time: boolean } };

/**
 * The visual/priority bucket shown to the photographer.
 * Thresholds follow the spec: >30 UPCOMING, <=30, <=15, <=5, <=2 GO TO MAT.
 */
export type EtaBucket =
  | "ON MAT"
  | "GO TO MAT"
  | "5 MIN"
  | "15 MIN"
  | "30 MIN"
  | "UPCOMING"
  | "DELAYED"
  | "COMPLETE"
  | "UNKNOWN";

export type Eta = {
  bucket: EtaBucket;
  /** Minutes until the target time (negative = already past). Null when no time is known. */
  minutesRemaining: number | null;
  /** ISO of the time we count down to (estimated_at, else scheduled_at). */
  targetAt: string | null;
  /** Whether the target came from estimated_at (true) or scheduled_at (false). */
  usesEstimate: boolean;
  /** Lower is more urgent. */
  priority: number;
};

export type EtaTone = "blue" | "green" | "amber" | "orange" | "red" | "gray";

export function bucketTone(bucket: EtaBucket): EtaTone {
  switch (bucket) {
    case "ON MAT":
    case "GO TO MAT":
      return "red";
    case "5 MIN":
      return "orange";
    case "15 MIN":
    case "30 MIN":
      return "amber";
    case "UPCOMING":
      return "green";
    case "DELAYED":
      return "amber";
    case "COMPLETE":
      return "blue";
    default:
      return "gray";
  }
}

export function matchStatusOf(match: MatchRow | null | undefined): MatchStatus {
  const s = match?.status ?? "unknown";
  return isMatchStatus(s) ? s : "unknown";
}

/** ETA for a single match at `now`. */
export function computeEta(match: MatchRow | null | undefined, now: Date = new Date()): Eta {
  if (!match) {
    return { bucket: "UNKNOWN", minutesRemaining: null, targetAt: null, usesEstimate: false, priority: 9_000_000 };
  }
  const status = matchStatusOf(match);
  const targetAt = match.estimated_at ?? match.scheduled_at ?? null;
  const usesEstimate = Boolean(match.estimated_at);
  let minutesRemaining: number | null = null;
  if (targetAt) {
    const t = new Date(targetAt).getTime();
    if (!Number.isNaN(t)) minutesRemaining = Math.round((t - now.getTime()) / 60_000);
  }

  if (status === "on_mat") {
    return { bucket: "ON MAT", minutesRemaining, targetAt, usesEstimate, priority: 0 };
  }
  if (status === "complete") {
    return { bucket: "COMPLETE", minutesRemaining, targetAt, usesEstimate, priority: 8_000_000 };
  }
  if (status === "delayed" && minutesRemaining === null) {
    return { bucket: "DELAYED", minutesRemaining, targetAt, usesEstimate, priority: 5_000_000 };
  }
  if (minutesRemaining === null) {
    return { bucket: "UNKNOWN", minutesRemaining, targetAt, usesEstimate, priority: 9_000_000 };
  }

  // A match whose time passed more than 45 minutes ago without a status update is stale.
  if (minutesRemaining < -45) {
    return { bucket: "UNKNOWN", minutesRemaining, targetAt, usesEstimate, priority: 8_500_000 + Math.abs(minutesRemaining) };
  }

  let bucket: EtaBucket;
  if (minutesRemaining <= 2) bucket = "GO TO MAT";
  else if (minutesRemaining <= 5) bucket = "5 MIN";
  else if (minutesRemaining <= 15) bucket = "15 MIN";
  else if (minutesRemaining <= 30) bucket = "30 MIN";
  else bucket = "UPCOMING";

  // GO TO MAT sits right under ON MAT; everything else orders by minutes.
  const priority = bucket === "GO TO MAT" ? 1 : 1_000 + Math.max(minutesRemaining, 0);
  return { bucket, minutesRemaining, targetAt, usesEstimate, priority };
}

/**
 * Picks the match that matters right now for an athlete: an on-mat match,
 * else the soonest not-complete match, else the latest completed one.
 */
export function pickCurrentMatch(matches: MatchRow[], now: Date = new Date()): EffectiveMatch | null {
  if (!matches.length) return null;
  // Rank and show the EFFECTIVE values: an owner's manual mat/time correction
  // decides where the photographer goes, labelled as manual.
  const scored = matches.map((m) => effectiveMatch(m, now)).map((m) => ({ m, eta: computeEta(m, now) }));
  scored.sort((a, b) => a.eta.priority - b.eta.priority || tieBreak(a.m, b.m));
  return scored[0].m;
}

function tieBreak(a: MatchRow, b: MatchRow): number {
  const ao = a.match_order ?? Number.MAX_SAFE_INTEGER;
  const bo = b.match_order ?? Number.MAX_SAFE_INTEGER;
  if (ao !== bo) return ao - bo;
  return (a.scheduled_at ?? "").localeCompare(b.scheduled_at ?? "");
}

export type AthleteEta = {
  athlete: AthleteWithMatches;
  match: EffectiveMatch | null;
  eta: Eta;
};

/**
 * Sorts athletes per the spec:
 * 1. ON MAT  2. GO TO MAT  3. nearest ETA  4. later matches  5. unknown/no match.
 * Completed matches sit after later matches and before unknown.
 */
export function rankAthletes(athletes: AthleteWithMatches[], now: Date = new Date()): AthleteEta[] {
  return athletes
    .map((athlete) => {
      const match = pickCurrentMatch(athlete.matches, now);
      return { athlete, match, eta: computeEta(match, now) };
    })
    .sort((a, b) => a.eta.priority - b.eta.priority || a.athlete.name.localeCompare(b.athlete.name));
}

export function formatMinutes(minutes: number | null): string {
  if (minutes === null) return "—";
  if (minutes <= 0) return "now";
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function formatCountdown(minutes: number | null): string {
  if (minutes === null) return "No time yet";
  if (minutes < -45) return "Time passed";
  if (minutes <= 0) return "Now";
  return `in ${formatMinutes(minutes)}`;
}

export const STATUS_LABEL: Record<MatchStatus, string> = {
  scheduled: "Scheduled",
  on_mat: "On mat",
  complete: "Complete",
  delayed: "Delayed",
  unknown: "Unknown",
};
