import { parseCsv } from "./csv";
import { normaliseName } from "./client-form";
import { formatTime, wallClockToIso } from "./time";
import type { ChangeType, MatchRow, MatchStatus } from "./types";
import { isValidCalendarDate } from "./validation";

/**
 * Manual tracking: matches entered by hand for events with no usable public
 * bracket page. Pure helpers shared by the server actions, the CSV import,
 * the screenshot review and the tests. Nothing here talks to a source site,
 * and nothing is ever reported as "found" — the owner typed it.
 */

/** One bracket row as typed, pasted (CSV) or read off a screenshot and reviewed. */
export type BracketRow = {
  athlete: string;
  opponent: string | null;
  round: string | null;
  mat: string | null;
  /** HH:MM in the event's zone, or an ISO instant. */
  time: string | null;
  /** YYYY-MM-DD; defaults to the event date. */
  date: string | null;
  status: MatchStatus;
  result: string | null;
  nextRound: string | null;
  matchNumber: string | null;
  /** Division hints for a client created from this row (local rules). */
  ageGroup: string | null;
  division: string | null;
  team: string | null;
};

export const MANUAL_MATCH_LIMITS = { text: 80, note: 240, rows: 300 } as const;

export const BRACKET_CSV_COLUMNS = ["athlete", "opponent", "round", "mat", "time", "date", "status", "result", "next_round", "match_number", "age_group", "division", "team"] as const;

const ALIASES: Record<string, (typeof BRACKET_CSV_COLUMNS)[number]> = {
  name: "athlete",
  client: "athlete",
  player: "athlete",
  competitor: "athlete",
  vs: "opponent",
  against: "opponent",
  match: "match_number",
  number: "match_number",
  "match #": "match_number",
  "#": "match_number",
  next: "next_round",
  nextround: "next_round",
  "next round": "next_round",
  agegroup: "age_group",
  "age group": "age_group",
  category: "age_group",
  weight: "division",
  "weight division": "division",
  academy: "team",
  club: "team",
  stage: "round",
};

/** Accepts the words people actually type for a status. */
export function normalizeMatchStatus(raw: string | null | undefined): MatchStatus {
  const s = (raw ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!s) return "scheduled";
  if (/^(on_mat|onmat|mat|fighting|live|in_progress|now)$/.test(s)) return "on_mat";
  if (/^(complete|completed|done|finished|final|over|won|lost|win|loss)$/.test(s)) return "complete";
  if (/^(delayed|late|postponed|hold)$/.test(s)) return "delayed";
  if (/^(scheduled|upcoming|pending|next|planned)$/.test(s)) return "scheduled";
  return "unknown";
}

/** "14:30", "9:05", "2:30 pm" with real hours and minutes. */
export function isWallClock(value: string): boolean {
  const m = /^(\d{1,2}):(\d{2})(?:\s*(am|pm))?$/i.exec(value.trim());
  if (!m) return false;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return min <= 59 && (m[3] ? h >= 1 && h <= 12 : h <= 23);
}

const clean = (v: string | null | undefined, max: number): string | null => {
  const t = (v ?? "").trim().replace(/\s+/g, " ");
  return t ? t.slice(0, max) : null;
};

export type RowParse = { ok: true; row: BracketRow } | { ok: false; error: string };

/** Validates one row from any source. Never throws. */
export function parseBracketRow(input: Record<string, unknown>): RowParse {
  const get = (k: string) => (typeof input[k] === "string" ? (input[k] as string) : input[k] == null ? "" : String(input[k]));
  const athlete = clean(get("athlete"), MANUAL_MATCH_LIMITS.text);
  if (!athlete) return { ok: false, error: "Missing athlete name." };
  const time = clean(get("time"), 25);
  if (time && !isWallClock(time) && Number.isNaN(new Date(time).getTime())) return { ok: false, error: `${athlete}: time must be HH:MM.` };
  const date = clean(get("date"), 10);
  if (date && !isValidCalendarDate(date)) return { ok: false, error: `${athlete}: date must be YYYY-MM-DD.` };
  const statusRaw = get("status");
  const status = normalizeMatchStatus(statusRaw);
  let result = clean(get("result"), MANUAL_MATCH_LIMITS.note);
  // "won" / "lost" in the status column is a result, not a status.
  if (/^(won|lost|win|loss)$/i.test(statusRaw.trim()) && !result) result = statusRaw.trim().toLowerCase().startsWith("w") ? "Won" : "Lost";
  return {
    ok: true,
    row: {
      athlete,
      opponent: clean(get("opponent"), MANUAL_MATCH_LIMITS.text),
      round: clean(get("round"), MANUAL_MATCH_LIMITS.text),
      mat: clean(get("mat"), 40),
      time,
      date,
      status,
      result,
      nextRound: clean(get("next_round") || get("nextRound"), MANUAL_MATCH_LIMITS.note),
      matchNumber: clean(get("match_number") || get("matchNumber"), 20),
      ageGroup: clean(get("age_group") || get("ageGroup"), 60),
      division: clean(get("division"), 80),
      team: clean(get("team"), MANUAL_MATCH_LIMITS.text),
    },
  };
}

export type BracketCsvParse = { headers: string[]; rows: Array<{ line: number; parsed: RowParse }> ; error?: string };

/** Parses a bracket CSV: header aliases are mapped, each row validated on its own. */
export function parseBracketCsv(text: string): BracketCsvParse {
  const { headers, rows } = parseCsv(text);
  const mapped = headers.map((h) => {
    const key = h.trim().toLowerCase();
    return (ALIASES[key] ?? key.replace(/\s+/g, "_")) as string;
  });
  if (!mapped.includes("athlete")) return { headers: mapped, rows: [], error: 'The header row must include an "athlete" (or "name") column.' };
  if (rows.length > MANUAL_MATCH_LIMITS.rows) return { headers: mapped, rows: [], error: `Import at most ${MANUAL_MATCH_LIMITS.rows} rows at a time.` };
  const out = rows.map((r, i) => {
    const record: Record<string, unknown> = {};
    headers.forEach((h, k) => {
      record[mapped[k]] = r[h];
    });
    return { line: i + 2, parsed: parseBracketRow(record) };
  });
  return { headers: mapped, rows: out };
}

/** Resolves a row's time to an instant in the event's zone. Null when no time was given. */
export function rowInstant(row: Pick<BracketRow, "time" | "date">, eventDate: string | null, timezone: string, now: Date = new Date()): string | null {
  if (!row.time) return null;
  const t = row.time.trim();
  if (isWallClock(t)) return wallClockToIso(t, timezone, row.date ?? eventDate ?? null, now);
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export type HistoryDraft = { change_type: ChangeType; old_value: { value: string | number | null; label: string } | null; new_value: { value: string | number | null; label: string } | null };

/** History rows for a manual edit, in the same shape the watcher writes, so alerts and the history page read them. */
export function manualChangeHistory(previous: Pick<MatchRow, "mat" | "scheduled_at" | "status" | "opponent"> | null, next: { mat: string | null; scheduled_at: string | null; status: string; opponent: string | null }, timezone: string): HistoryDraft[] {
  if (!previous) return [{ change_type: "MATCH_FOUND", old_value: null, new_value: { value: next.mat, label: next.mat ? `${next.mat} · ${formatTime(next.scheduled_at, timezone)}` : "Entered by hand" } }];
  const out: HistoryDraft[] = [];
  const same = (a: string | null, b: string | null) => (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();
  if (!same(previous.mat, next.mat)) out.push({ change_type: "MAT_CHANGE", old_value: { value: previous.mat, label: previous.mat ?? "—" }, new_value: { value: next.mat, label: next.mat ?? "—" } });
  if ((previous.scheduled_at ?? null) !== (next.scheduled_at ?? null)) {
    out.push({ change_type: "TIME_CHANGE", old_value: { value: previous.scheduled_at, label: formatTime(previous.scheduled_at, timezone) }, new_value: { value: next.scheduled_at, label: formatTime(next.scheduled_at, timezone) } });
  }
  if (previous.status !== next.status) out.push({ change_type: "STATUS_CHANGE", old_value: { value: previous.status, label: previous.status }, new_value: { value: next.status, label: next.status } });
  if (!same(previous.opponent, next.opponent)) out.push({ change_type: "OPPONENT_CHANGE", old_value: { value: previous.opponent, label: previous.opponent ?? "Unknown" }, new_value: { value: next.opponent, label: next.opponent ?? "Unknown" } });
  return out;
}

/** Finds the client a bracket row names (exact normalised name). */
export function matchAthlete<T extends { id: string; name: string }>(athletes: T[], name: string): T | null {
  const key = normaliseName(name);
  return athletes.find((a) => normaliseName(a.name) === key) ?? null;
}
