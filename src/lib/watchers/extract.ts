import * as cheerio from "cheerio";
import type { MatchStatus } from "@/lib/types";
import { wallClockToIso } from "@/lib/time";
import type { NormalizedMatch, WatchContext } from "./types";

/**
 * Platform-agnostic extraction helpers. AJP and Smoothcomp both run on a
 * Laravel stack behind Cloudflare and ship schedule data either as server
 * rendered tables/cards or as embedded JSON. Neither markup is guaranteed to
 * stay stable, so every strategy here is defensive and best-effort.
 */

export type CheerioRoot = ReturnType<typeof cheerio.load>;

export function load(html: string): CheerioRoot {
  return cheerio.load(html);
}

/** Cloudflare / bot challenge pages that plain fetch can never pass. */
export function isBotChallenge(html: string): boolean {
  const head = html.slice(0, 20_000);
  return (
    /<title>\s*just a moment/i.test(head) ||
    /cf-chl|challenge-platform|_cf_chl_opt|cf_chl_/i.test(head) ||
    /<title>\s*attention required/i.test(head) ||
    /enable javascript and cookies to continue/i.test(head)
  );
}

/** Pages that are only a JS bootstrap shell with no server-rendered content. */
export function looksLikeJsShell($: CheerioRoot): boolean {
  const scripts = $("script").length;
  const text = visibleText($("body")).replace(/\s+/g, " ").trim();
  return scripts > 0 && text.length < 300;
}

export function visibleText(el: ReturnType<CheerioRoot>): string {
  const clone = el.clone();
  clone.find("script, style, noscript, template, svg").remove();
  return clone.text();
}

export function pageTitle($: CheerioRoot): string {
  return $("title").first().text().replace(/\s+/g, " ").trim();
}

export function normalizeName(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** True when `text` mentions the athlete (full name, or all name tokens). */
export function mentionsAthlete(text: string, athleteName: string | null | undefined): boolean {
  if (!athleteName) return false;
  const hay = normalizeName(text);
  const needle = normalizeName(athleteName);
  if (!needle) return false;
  if (hay.includes(needle)) return true;
  const tokens = needle.split(" ").filter((t) => t.length > 2);
  return tokens.length >= 2 && tokens.every((t) => hay.includes(t));
}

// "Mat 3", "Tatami 12", "Mat A". Letters only A–F to avoid matching prose.
const MAT_RE = /\b(?:mat|tatami)\s*#?\s*(\d{1,2}|[A-F])\b/i;
const TIME_RE = /\b(\d{1,2}:\d{2})(?:\s*(am|pm))?\b/i;
const DATE_RE = /\b(\d{4})-(\d{2})-(\d{2})\b|\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/;
const MATCH_NO_RE = /\b(?:match|fight|bout)\s*(?:no\.?|#|number)?\s*(\d{1,4})\b|#\s?(\d{1,4})\b/i;
const VS_RE = /(.{2,80}?)\s+(?:vs\.?|v\.|x|versus)\s+(.{2,80})/i;

export function extractMat(text: string): string | null {
  const m = MAT_RE.exec(text);
  return m ? `Mat ${m[1].toUpperCase()}` : null;
}

export function extractTime(text: string): string | null {
  const m = TIME_RE.exec(text);
  if (!m) return null;
  return m[2] ? `${m[1]} ${m[2]}` : m[1];
}

export function extractDate(text: string): string | null {
  const m = DATE_RE.exec(text);
  if (!m) return null;
  if (m[1]) return `${m[1]}-${m[2]}-${m[3]}`;
  return `${m[6]}-${m[5].padStart(2, "0")}-${m[4].padStart(2, "0")}`;
}

export function extractMatchNumber(text: string): string | null {
  const m = MATCH_NO_RE.exec(text);
  return m ? (m[1] ?? m[2]) : null;
}

export function extractStatus(text: string): MatchStatus {
  const t = text.toLowerCase();
  if (/\b(in progress|live now|on mat|now fighting|fighting now|ongoing|started)\b/.test(t)) return "on_mat";
  if (/\b(finished|completed|complete|result|winner|won by|lost by|submission|decision|walkover|w\.o\.)\b/.test(t)) return "complete";
  if (/\b(delayed|postponed|running late)\b/.test(t)) return "delayed";
  return "scheduled";
}

/** Splits "A vs B" and returns the opponent of `athleteName` (or both names). */
export function extractOpponent(text: string, athleteName: string | null | undefined): { athlete: string | null; opponent: string | null } {
  const m = VS_RE.exec(text.replace(/\s+/g, " "));
  if (!m) return { athlete: null, opponent: null };
  const a = cleanName(m[1]);
  const b = cleanName(m[2]);
  if (athleteName) {
    if (mentionsAthlete(a, athleteName)) return { athlete: a, opponent: b };
    if (mentionsAthlete(b, athleteName)) return { athlete: b, opponent: a };
  }
  return { athlete: a, opponent: b };
}

function cleanName(value: string): string {
  return value
    .replace(MAT_RE, " ")
    .replace(TIME_RE, " ")
    .replace(MATCH_NO_RE, " ")
    .replace(/\b(scheduled|estimated|eta|time|mat|tatami)\b:?/gi, " ")
    .replace(/(^|\s)[|•·\-–—]+(?=\s|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function toIso(time: string | null, date: string | null, ctx: WatchContext): string | null {
  if (!time) return null;
  return wallClockToIso(time, ctx.timezone, date ?? ctx.eventDate ?? null, ctx.now);
}

/**
 * Builds a NormalizedMatch from a blob of row text. Returns null if the row
 * has neither a mat nor a time (i.e. not a schedule row).
 */
export function matchFromText(text: string, ctx: WatchContext, extra: Partial<NormalizedMatch> = {}): NormalizedMatch | null {
  const clean = text.replace(/\s+/g, " ").trim();
  const mat = extra.mat ?? extractMat(clean);
  const time = extractTime(clean);
  const date = extractDate(clean);
  const names = extractOpponent(clean, ctx.athleteName);
  const hasTime = Boolean(time || extra.scheduledAt);
  const hasPeople = Boolean(names.opponent || extra.opponent);
  // A schedule row needs at least two independent signals (mat + time, or
  // a pairing plus one of them); a lone "Mat 1" in prose is not a match.
  const signals = Number(Boolean(mat)) + Number(hasTime) + Number(hasPeople);
  if (signals < 2) return null;
  const scheduledAt = extra.scheduledAt ?? toIso(time, date, ctx);
  return {
    athlete: extra.athlete ?? names.athlete ?? ctx.athleteName ?? null,
    opponent: extra.opponent ?? names.opponent,
    mat,
    scheduledAt,
    estimatedAt: extra.estimatedAt ?? null,
    matchNumber: extra.matchNumber ?? extractMatchNumber(clean),
    matchOrder: extra.matchOrder ?? null,
    status: extra.status ?? extractStatus(clean),
    sourceUrl: ctx.url.toString(),
    externalMatchId: extra.externalMatchId ?? null,
    raw: { text: clean.slice(0, 500), ...(extra.raw ?? {}) },
  };
}

/** Strategy 1: HTML tables whose header mentions mat/time/opponent. */
export function matchesFromTables($: CheerioRoot, ctx: WatchContext): NormalizedMatch[] {
  const out: NormalizedMatch[] = [];
  $("table").each((_, table) => {
    const header = $(table).find("th").text().toLowerCase();
    const headerLooksRight = /mat|tatami|time|opponent|fight|match/.test(header);
    $(table)
      .find("tr")
      .each((_, tr) => {
        const cells = $(tr)
          .find("td")
          .map((_, td) => $(td).text().replace(/\s+/g, " ").trim())
          .get();
        if (!cells.length) return;
        const text = cells.join(" | ");
        if (!headerLooksRight && !MAT_RE.test(text)) return;
        const match = matchFromText(text, ctx, { raw: { cells } });
        if (match) out.push(match);
      });
  });
  return out;
}

/** Strategy 2: card/list markup with class names hinting at matches. */
export function matchesFromCards($: CheerioRoot, ctx: WatchContext): NormalizedMatch[] {
  const out: NormalizedMatch[] = [];
  const selector = [
    "[class*='match']",
    "[class*='fight']",
    "[class*='bout']",
    "[class*='schedule']",
    "[class*='bracket']",
    "li",
  ].join(",");
  $(selector).each((_, el) => {
    // Skip containers that themselves hold many candidate rows.
    if ($(el).find(selector).length > 3) return;
    const text = visibleText($(el)).replace(/\s+/g, " ").trim();
    if (text.length < 8 || text.length > 600) return;
    if (!MAT_RE.test(text) && !TIME_RE.test(text)) return;
    const match = matchFromText(text, ctx);
    if (match) out.push(match);
  });
  return dedupe(out);
}

/** Strategy 3: embedded JSON (Next data, Inertia data-page, inline state). */
export function matchesFromEmbeddedJson($: CheerioRoot, html: string, ctx: WatchContext): NormalizedMatch[] {
  const blobs: unknown[] = [];
  $("script#__NEXT_DATA__, script[type='application/json'], script[type='application/ld+json']").each((_, s) => {
    const parsed = tryJson($(s).text());
    if (parsed !== undefined) blobs.push(parsed);
  });
  $("[data-page]").each((_, el) => {
    const parsed = tryJson($(el).attr("data-page") ?? "");
    if (parsed !== undefined) blobs.push(parsed);
  });
  for (const re of [
    /window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\});/g,
    /window\.__DATA__\s*=\s*(\{[\s\S]*?\});/g,
    /window\.__NUXT__\s*=\s*(\{[\s\S]*?\});/g,
  ]) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(html))) {
      const parsed = tryJson(m[1]);
      if (parsed !== undefined) blobs.push(parsed);
    }
  }

  const out: NormalizedMatch[] = [];
  for (const blob of blobs) walk(blob, 0, (obj) => {
    const match = matchFromObject(obj, ctx);
    if (match) out.push(match);
  });
  return dedupe(out);
}

function tryJson(text: string): unknown {
  const t = text.trim();
  if (!t || (t[0] !== "{" && t[0] !== "[")) return undefined;
  try {
    return JSON.parse(t);
  } catch {
    return undefined;
  }
}

function walk(node: unknown, depth: number, visit: (obj: Record<string, unknown>) => void) {
  if (depth > 12 || node === null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) walk(item, depth + 1, visit);
    return;
  }
  const obj = node as Record<string, unknown>;
  visit(obj);
  for (const value of Object.values(obj)) walk(value, depth + 1, visit);
}

const KEY = {
  mat: ["mat", "mat_number", "matNumber", "mat_name", "tatami", "area", "ring"],
  time: ["scheduled_at", "scheduledAt", "start_time", "startTime", "scheduled_time", "time", "starts_at", "startsAt"],
  eta: ["estimated_at", "estimatedAt", "estimated_time", "eta", "estimated_start"],
  number: ["match_number", "matchNumber", "fight_number", "number", "bout_number"],
  order: ["order", "match_order", "sequence", "position"],
  status: ["status", "state"],
  id: ["id", "match_id", "matchId", "uuid"],
  opponent: ["opponent", "opponent_name", "opponentName"],
  competitors: ["competitors", "athletes", "participants", "fighters", "players"],
  red: ["red", "athlete1", "competitor1", "fighter1", "player1", "athlete_a", "home"],
  blue: ["blue", "athlete2", "competitor2", "fighter2", "player2", "athlete_b", "away"],
};

function pick(obj: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) if (k in obj && obj[k] !== null && obj[k] !== undefined && obj[k] !== "") return obj[k];
  return undefined;
}

function asString(v: unknown): string | null {
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number") return String(v);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return asString(o.name ?? o.full_name ?? o.fullName ?? o.title ?? o.label ?? o.number ?? o.value);
  }
  return null;
}

function toIsoLoose(v: unknown, ctx: WatchContext): string | null {
  const s = asString(v);
  if (!s) return null;
  if (/^\d{1,2}:\d{2}/.test(s)) return toIso(extractTime(s), null, ctx);
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString();
  const t = extractTime(s);
  return t ? toIso(t, extractDate(s), ctx) : null;
}

function matchFromObject(obj: Record<string, unknown>, ctx: WatchContext): NormalizedMatch | null {
  const mat = asString(pick(obj, KEY.mat));
  const time = pick(obj, KEY.time);
  const competitors = pick(obj, KEY.competitors);
  const red = pick(obj, KEY.red);
  const blue = pick(obj, KEY.blue);
  const opponentDirect = asString(pick(obj, KEY.opponent));
  const hasPeople = Boolean(competitors || red || blue || opponentDirect);
  if (!mat && !time) return null;
  if (!hasPeople && !mat) return null;

  let athlete: string | null = null;
  let opponent: string | null = opponentDirect;
  const names: string[] = [];
  if (Array.isArray(competitors)) for (const c of competitors) { const n = asString(c); if (n) names.push(n); }
  const rn = asString(red); const bn = asString(blue);
  if (rn) names.push(rn);
  if (bn) names.push(bn);
  if (!opponent && names.length) {
    const mine = names.find((n) => mentionsAthlete(n, ctx.athleteName));
    athlete = mine ?? null;
    opponent = names.find((n) => n !== mine) ?? null;
  }

  const rawStatus = asString(pick(obj, KEY.status)) ?? "";
  const status: MatchStatus = rawStatus ? extractStatus(rawStatus) : "scheduled";
  const number = asString(pick(obj, KEY.number));
  const orderRaw = pick(obj, KEY.order);
  const matchOrder = typeof orderRaw === "number" ? orderRaw : Number.isFinite(Number(orderRaw)) && orderRaw !== undefined ? Number(orderRaw) : null;

  return {
    athlete: athlete ?? ctx.athleteName ?? null,
    opponent,
    mat: mat ? (MAT_RE.test(mat) ? extractMat(mat) : `Mat ${mat}`) : null,
    scheduledAt: toIsoLoose(time, ctx),
    estimatedAt: toIsoLoose(pick(obj, KEY.eta), ctx),
    matchNumber: number,
    matchOrder,
    status,
    sourceUrl: ctx.url.toString(),
    externalMatchId: asString(pick(obj, KEY.id)),
    raw: shallow(obj),
  };
}

function shallow(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || ["string", "number", "boolean"].includes(typeof v)) out[k] = v;
    else if (v && typeof v === "object") { const s = asString(v); if (s) out[k] = s; }
    if (Object.keys(out).length >= 24) break;
  }
  return out;
}

export function dedupe(matches: NormalizedMatch[]): NormalizedMatch[] {
  const seen = new Set<string>();
  const out: NormalizedMatch[] = [];
  for (const m of matches) {
    const key = m.externalMatchId ?? `${m.matchNumber ?? ""}|${m.mat ?? ""}|${m.scheduledAt ?? ""}|${normalizeName(m.opponent)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out;
}

/** Keeps only rows about the athlete when the page lists many competitors. */
export function filterForAthlete(matches: NormalizedMatch[], ctx: WatchContext): { matches: NormalizedMatch[]; filtered: boolean } {
  if (!ctx.athleteName) return { matches, filtered: false };
  const mine = matches.filter((m) => {
    const text = typeof m.raw.text === "string" ? m.raw.text : "";
    return (
      mentionsAthlete(m.athlete ?? "", ctx.athleteName) ||
      mentionsAthlete(text, ctx.athleteName) ||
      mentionsAthlete(JSON.stringify(m.raw), ctx.athleteName)
    );
  });
  return mine.length ? { matches: mine, filtered: true } : { matches, filtered: false };
}

/** Text hints that the organizer has not published the schedule yet. */
export function scheduleNotPublished($: CheerioRoot): boolean {
  const text = visibleText($("body")).toLowerCase();
  return /schedule (is )?(not|will be) (yet )?(available|published|released)|coming soon|to be announced|tba\b|no matches (yet|scheduled)|not yet scheduled/.test(text);
}

/** Sort by explicit order, then match number, then time. */
export function sortMatches(matches: NormalizedMatch[]): NormalizedMatch[] {
  return [...matches].sort((a, b) => {
    const ao = a.matchOrder ?? Number.MAX_SAFE_INTEGER;
    const bo = b.matchOrder ?? Number.MAX_SAFE_INTEGER;
    if (ao !== bo) return ao - bo;
    const an = Number(a.matchNumber ?? Number.MAX_SAFE_INTEGER);
    const bn = Number(b.matchNumber ?? Number.MAX_SAFE_INTEGER);
    if (an !== bn) return an - bn;
    return (a.scheduledAt ?? "").localeCompare(b.scheduledAt ?? "");
  });
}
