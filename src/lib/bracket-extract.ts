import { normalizeMatchStatus, type BracketRow } from "./manual-matches";

/**
 * Assisted entry from a bracket screenshot. The model is asked for a strict
 * JSON shape (names, divisions, matches); this file owns that shape and turns
 * it into reviewable bracket rows. Nothing is saved until the owner has
 * checked and corrected the rows on screen, and nothing is ever marked as
 * verified from a source — it is a reading of a picture.
 */

export const BRACKET_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["ageGroup", "division", "matches", "unreadable"],
  properties: {
    ageGroup: { type: ["string", "null"], description: "Age group / category printed on the bracket, exactly as written, else null." },
    division: { type: ["string", "null"], description: "Weight division printed on the bracket, exactly as written, else null." },
    matches: {
      type: "array",
      description: "Every match that can be read from the bracket, one entry per match slot.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["athlete", "opponent", "round", "mat", "time", "matchNumber", "result", "winner"],
        properties: {
          athlete: { type: "string", description: "First competitor's name exactly as printed." },
          opponent: { type: ["string", "null"], description: "Second competitor's name exactly as printed, null for a bye or an empty slot." },
          round: { type: ["string", "null"], description: "Round or stage label, e.g. Quarter-final, Semi-final, Final, else null." },
          mat: { type: ["string", "null"], description: "Mat or area if printed, else null." },
          time: { type: ["string", "null"], description: "Scheduled time as printed (HH:MM), else null." },
          matchNumber: { type: ["string", "null"], description: "Match number if printed, else null." },
          result: { type: ["string", "null"], description: "Result text if the match is decided (e.g. 'Submission', 'Points 4-2'), else null." },
          winner: { type: ["string", "null"], description: "Winner's name exactly as printed when a winner is marked, else null." },
        },
      },
    },
    unreadable: { type: "array", items: { type: "string" }, description: "Short notes on anything that could not be read with confidence." },
  },
} as const;

export type ExtractedBracket = {
  ageGroup: string | null;
  division: string | null;
  matches: Array<{ athlete: string; opponent: string | null; round: string | null; mat: string | null; time: string | null; matchNumber: string | null; result: string | null; winner: string | null }>;
  unreadable: string[];
};

/** Defensive read of the model output (never trusts the shape). */
export function coerceExtracted(input: unknown): ExtractedBracket {
  const o = input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  const str = (v: unknown, max = 120) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
  const matches = Array.isArray(o.matches) ? o.matches : [];
  return {
    ageGroup: str(o.ageGroup, 60),
    division: str(o.division, 80),
    matches: matches
      .filter((m): m is Record<string, unknown> => Boolean(m) && typeof m === "object")
      .map((m) => ({
        athlete: str(m.athlete, 80) ?? "",
        opponent: str(m.opponent, 80),
        round: str(m.round, 80),
        mat: str(m.mat, 40),
        time: str(m.time, 25),
        matchNumber: str(m.matchNumber, 20),
        result: str(m.result, 240),
        winner: str(m.winner, 80),
      }))
      .filter((m) => m.athlete)
      .slice(0, 300),
    unreadable: (Array.isArray(o.unreadable) ? o.unreadable : []).filter((x): x is string => typeof x === "string").map((x) => x.slice(0, 200)).slice(0, 20),
  };
}

/**
 * One review row per competitor the owner follows. A bracket lists both
 * sides of each match; the row is built for the first name and, when the
 * second is also a client (or `everyone`), a mirrored row for them too.
 */
export function extractedToRows(extracted: ExtractedBracket, clientKeys: Set<string>, options: { everyone?: boolean } = {}): BracketRow[] {
  const rows: BracketRow[] = [];
  const key = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  const include = (name: string | null) => Boolean(name) && (options.everyone || clientKeys.has(key(name!)));
  for (const m of extracted.matches) {
    const decided = Boolean(m.winner || m.result);
    const base = { round: m.round, mat: m.mat, time: m.time, date: null, matchNumber: m.matchNumber, nextRound: null, ageGroup: extracted.ageGroup, division: extracted.division, team: null };
    const resultFor = (name: string) => {
      if (!decided) return null;
      const won = m.winner ? key(m.winner) === key(name) : null;
      const outcome = won === null ? "" : won ? "Won" : "Lost";
      return [outcome, m.result].filter(Boolean).join(" · ") || null;
    };
    const status = normalizeMatchStatus(decided ? "complete" : "scheduled");
    if (include(m.athlete)) rows.push({ ...base, athlete: m.athlete, opponent: m.opponent, status, result: resultFor(m.athlete) });
    if (m.opponent && include(m.opponent)) rows.push({ ...base, athlete: m.opponent, opponent: m.athlete, status, result: resultFor(m.opponent) });
  }
  return rows;
}

export const EXTRACT_LIMITS = { maxBase64Bytes: 6 * 1024 * 1024, mediaTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"] as const };

export type ExtractMediaType = (typeof EXTRACT_LIMITS.mediaTypes)[number];

export function isExtractMediaType(v: unknown): v is ExtractMediaType {
  return typeof v === "string" && (EXTRACT_LIMITS.mediaTypes as readonly string[]).includes(v);
}
