import { validateSourceUrl } from "@/lib/watchers/url-policy";

/**
 * Source identity: the key under which captures of "the same page" are
 * grouped. One athlete's bracket and the next athlete's bracket often share a
 * path and differ only in a query parameter (Smoothcomp `?category=`,
 * `?bracketId=`), so a path-only key would merge distinct brackets and
 * attribute one bracket's mats and times to clients on another. Identity
 * therefore keeps the query parameters that select a bracket / category /
 * division and drops the ones that only change presentation (tab, page,
 * sort, locale, tracking).
 *
 * The key is owner-neutral on purpose: captures are stored and matched per
 * owner elsewhere (owner_id + source_key), never shared across owners.
 */

/** Query parameters that select WHICH schedule is shown (kept, sorted). */
const IDENTITY_PARAM_RE = /^(bracket|category|categor(y|ie)s?|division|class|group|pool|stage|round|day|mat|weight|belt|age)(_?id)?s?$/i;
/** Leading locale path segment used by both platforms (`/en/`, `/ar/`, `/pt-br/`). */
const LOCALE_SEGMENT_RE = /^\/([a-z]{2}(-[a-z]{2})?)(?=\/|$)/i;

export function sourceKey(raw: string | null | undefined): string | null {
  const policy = validateSourceUrl(raw);
  if (!policy.ok) return null;
  const url = policy.url;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const path = (url.pathname.replace(LOCALE_SEGMENT_RE, "").replace(/\/+$/, "") || "/");
  const params: string[] = [];
  for (const [name, value] of url.searchParams) {
    if (!IDENTITY_PARAM_RE.test(name)) continue;
    const v = value.trim();
    if (!v) continue;
    params.push(`${name.toLowerCase()}=${v}`);
  }
  params.sort();
  return params.length ? `${host}|${path}|${params.join("&")}` : `${host}|${path}`;
}

export function sameSource(a: string | null | undefined, b: string | null | undefined): boolean {
  const ka = sourceKey(a);
  return ka !== null && ka === sourceKey(b);
}
