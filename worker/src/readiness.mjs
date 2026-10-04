/**
 * Page readiness: decides, from a rendered page's HTML, final URL and HTTP
 * status, whether what the browser shows is a real schedule page worth
 * capturing. Pure (no Playwright), so it is unit-tested directly and reused by
 * the render loop, which polls it until the page is ready or a bound is hit.
 *
 * Verdicts:
 *   ready + hasSchedule      a schedule structure is present
 *   ready + !hasSchedule     a real page that says the schedule is not out yet
 *   !ready, terminal         waiting cannot help (HTTP error, login, error page, challenge)
 *   !ready, !terminal        the app has not hydrated yet; keep waiting (bounded)
 * `redirected` is set when the browser landed on a different path than it was
 * asked for (same allow-listed host, already checked by the HTTP layer). It is
 * reported, not failed: canonical-URL redirects are normal, and the app checks
 * the landed URL against the client's source identity itself.
 */

const CHALLENGE_RE = /just a moment|attention required|cf-chl|challenge-platform|_cf_chl_opt|enable javascript and cookies to continue/i;
const LOGIN_RE = /type=["']?password["']?/i;
const ERROR_TITLE_RE = /<title>[^<]*(server error|something went wrong|whoops|service unavailable|page not found|not found|error \d{3}|\b5\d\d\b)[^<]*<\/title>/i;
const ERROR_BODY_RE = /whoops, something went wrong|an error occurred|service unavailable|temporarily unavailable|page not found/i;
const NOT_PUBLISHED_RE = /not (yet )?(been )?published|schedule (is )?not (yet )?available|coming soon|will be (published|announced)|check back later|no matches? (scheduled|found|yet)/i;
const SCHEDULE_HINT_RE = /\b(mat|tatami|area)\s*\d|\bmat\b|\bbracket|\bmatch(es)?\b|\bfight|\bbout|\bvs\.?\b|\bred\b.*\bblue\b/i;
const LOCALE_SEGMENT_RE = /^\/([a-z]{2}(-[a-z]{2})?)(?=\/|$)/i;

export function assessReadiness({ html, status, finalUrl, requestedUrl }) {
  const text = typeof html === "string" ? html : "";
  if (typeof status === "number" && status >= 400) return verdict(false, "HTTP_ERROR", false, true);
  if (CHALLENGE_RE.test(text.slice(0, 30_000))) return verdict(false, "CHALLENGE", false, true);
  const redirected = Boolean(requestedUrl && finalUrl && !samePage(requestedUrl, finalUrl));

  const hasSchedule = hasScheduleStructure(text);
  if (hasSchedule) return verdict(true, "SCHEDULE_FOUND", true, true, redirected);

  if (LOGIN_RE.test(text)) return verdict(false, "LOGIN_PAGE", false, true, redirected);
  if (ERROR_TITLE_RE.test(text) || ERROR_BODY_RE.test(text)) return verdict(false, "ERROR_PAGE", false, true, redirected);

  const visible = visibleText(text);
  if (NOT_PUBLISHED_RE.test(visible)) return verdict(true, "NO_SCHEDULE_YET", false, true, redirected);
  if (visible.length < 300 && /<script/i.test(text)) return verdict(false, "UNHYDRATED", false, false, redirected);
  // Real content, but nothing that looks like a schedule: let the app's parser decide.
  return verdict(true, "NO_SCHEDULE_STRUCTURE", false, true, redirected);
}

function verdict(ready, reason, hasSchedule, terminal, redirected = false) {
  return { ready, reason, hasSchedule, terminal, redirected };
}

/** Tables with several data rows, repeated card-like blocks or embedded schedule JSON. */
export function hasScheduleStructure(html) {
  const rows = (html.match(/<tr\b[^>]*>(?:(?!<\/tr>)[\s\S]){0,4000}?<td/gi) ?? []).length;
  if (rows >= 1 && SCHEDULE_HINT_RE.test(html)) return true;
  const cards = (html.match(/class=["'][^"']*\b(match|bout|fight|bracket-?(match|item)|schedule-?(item|row))\b[^"']*["']/gi) ?? []).length;
  if (cards >= 1) return true;
  if (/"(mat|mat_?name|match_?number|scheduled_?at|start_?time)"\s*:/i.test(html) && /"(opponent|red|blue|competitor|athlete|participant)/i.test(html)) return true;
  return false;
}

/** Null when the page shows no further pages, else what kind of control it shows. */
export function findPaginationHint(html) {
  if (/<a\b[^>]*rel=["']?next["']?/i.test(html)) return "next-link";
  if (/<(button|a)\b[^>]*(load-?more|show-?more|see-?more)[^>]*>/i.test(html) || /<(button|a)\b[^>]*>\s*(load|show|see) more/i.test(html)) return "load-more";
  if (/class=["'][^"']*\bpagination\b[^"']*["']/i.test(html) && /<a\b[^>]*href=["'][^"']*[?&]page=\d+/i.test(html)) return "pagination";
  return null;
}

function visibleText(html) {
  return html
    .replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Same host + path ignoring locale prefix, trailing slash and presentation params. */
function samePage(a, b) {
  const ka = pageKey(a);
  return ka !== null && ka === pageKey(b);
}

function pageKey(raw) {
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const path = u.pathname.replace(LOCALE_SEGMENT_RE, "").replace(/\/+$/, "") || "/";
    return `${host}${path}`;
  } catch {
    return null;
  }
}
