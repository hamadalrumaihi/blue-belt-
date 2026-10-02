import "server-only";
import { createLogger, type Logger } from "@/lib/log";
import { DEFAULT_TIMEZONE } from "@/lib/time";
import { ajpAdapter } from "./ajp";
import { browserFetchHtml, isBrowserWorkerConfigured, preferBrowserWorker, type BrowserFetchCode } from "./browser-fetch";
import { safeFetchHtml, type SafeFetchResult } from "./safe-fetch";
import { smoothcompAdapter } from "./smoothcomp";
import type { WatchCode, WatchContext, WatchDiagnostics, WatchResult, WatchStatus, WatcherAdapter } from "./types";
import { validateSourceUrl } from "./url-policy";

const ADAPTERS: WatcherAdapter[] = [ajpAdapter, smoothcompAdapter];

export type WatchOptions = {
  athleteName?: string | null;
  timezone?: string | null;
  eventDate?: string | null;
  now?: Date;
  /** Request-scoped logger (carries the correlation id). */
  log?: Logger;
};

/**
 * Validates, fetches and parses a source URL. Never throws: every failure
 * mode is expressed as a WatchResult status + code so one bad athlete cannot
 * take down a batch refresh.
 *
 * Fetch strategy:
 *   1. plain HTTPS fetch (fast, cheap) unless WATCHER_PREFER_BROWSER=1
 *   2. if the page is a bot challenge / JS shell and the Playwright worker is
 *      configured, render it there and parse the rendered HTML instead
 */
export async function watchUrl(rawUrl: string | null | undefined, options: WatchOptions = {}): Promise<WatchResult> {
  const started = Date.now();
  const result = await watchUrlInner(rawUrl, options, started);
  const log = options.log ?? createLogger();
  const { hostname, pathname } = hostOf(result.sourceUrl);
  // One structured line per attempt (Vercel runtime logs). `tag` keeps the
  // historical "[watch]" search working; no HTML or identities are logged.
  log.info(`[watch] ${result.status}`, {
    tag: "[watch]",
    status: result.status,
    code: result.code,
    strategy: result.diagnostics?.strategy ?? result.strategy ?? "-",
    matches: result.matches.length,
    host: hostname,
    path: pathname,
    sourceStatus: result.diagnostics?.sourceStatus ?? null,
    elapsedMs: result.diagnostics?.elapsedMs ?? Date.now() - started,
    attempts: result.diagnostics?.attempts,
    workerCode: result.diagnostics?.workerCode,
    detail: result.message,
  });
  return result;
}

export type ImportParseOptions = Omit<WatchOptions, "log"> & { log?: Logger };

/**
 * Parses HTML the photographer's own browser already rendered (page import).
 * Same URL policy and adapters as a live watch, no network. A pasted
 * challenge page is reported as BROWSER_CHALLENGE so the UI can say the
 * check was not passed before the page was handed over.
 */
export function parseImportedHtml(rawUrl: string, html: string, options: ImportParseOptions = {}): WatchResult {
  const started = Date.now();
  const now = options.now ?? new Date();
  const fetchedAt = now.toISOString();
  const athlete = options.athleteName ?? null;
  const diag = (strategy: string): WatchDiagnostics => ({ strategy, sourceStatus: null, finalUrl: null, elapsedMs: Date.now() - started, attempts: 1 });

  let result: WatchResult;
  const policy = validateSourceUrl(rawUrl);
  if (!policy.ok) {
    result = { platform: "OTHER", status: policy.code, code: policy.code, athlete, matches: [], sourceUrl: rawUrl, fetchedAt, message: policy.message, strategy: "import", diagnostics: diag("import") };
  } else {
    const adapter = ADAPTERS.find((a) => a.canHandle(policy.url));
    if (!adapter) {
      result = { platform: policy.platform, status: "UNSUPPORTED_HOST", code: "UNSUPPORTED_HOST", athlete, matches: [], sourceUrl: policy.url.toString(), fetchedAt, message: "No adapter for this host.", strategy: "import", diagnostics: diag("import") };
    } else {
      const parsed = adapter.parse(html, { url: policy.url, athleteName: athlete, timezone: options.timezone || DEFAULT_TIMEZONE, eventDate: options.eventDate ?? null, now });
      const strategy = `import:${parsed.strategy ?? "none"}`;
      result = { ...parsed, strategy, diagnostics: { ...diag(strategy), finalUrl: policy.url.toString() } };
      if (parsed.status === "REQUIRES_BROWSER_WATCHER") {
        result.message = "The handed-over page is still the bot-challenge page. Pass the check in your browser, wait for the bracket to load, then import again.";
      }
    }
  }

  const log = options.log ?? createLogger();
  const { hostname, pathname } = hostOf(result.sourceUrl);
  log.info(`[watch] ${result.status}`, {
    tag: "[watch]",
    status: result.status,
    code: result.code,
    strategy: result.diagnostics?.strategy ?? "import",
    matches: result.matches.length,
    host: hostname,
    path: pathname,
    sourceStatus: null,
    elapsedMs: result.diagnostics?.elapsedMs ?? Date.now() - started,
    htmlBytes: html.length,
    detail: result.message,
  });
  return result;
}

function hostOf(url: string): { hostname: string; pathname: string } {
  try {
    const u = new URL(url);
    return { hostname: u.hostname, pathname: u.pathname };
  } catch {
    return { hostname: "-", pathname: "-" };
  }
}

async function watchUrlInner(rawUrl: string | null | undefined, options: WatchOptions, started: number): Promise<WatchResult> {
  const now = options.now ?? new Date();
  const fetchedAt = now.toISOString();
  const athlete = options.athleteName ?? null;
  const diag = (partial: Partial<WatchDiagnostics> & { strategy: string }): WatchDiagnostics => ({
    sourceStatus: null,
    finalUrl: null,
    elapsedMs: Date.now() - started,
    ...partial,
  });

  const policy = validateSourceUrl(rawUrl);
  if (!policy.ok) {
    return { platform: "OTHER", status: policy.code, code: policy.code, athlete, matches: [], sourceUrl: rawUrl ?? "", fetchedAt, message: policy.message, strategy: "none", diagnostics: diag({ strategy: "none" }) };
  }

  const adapter = ADAPTERS.find((a) => a.canHandle(policy.url));
  if (!adapter) {
    return { platform: policy.platform, status: "UNSUPPORTED_HOST", code: "UNSUPPORTED_HOST", athlete, matches: [], sourceUrl: policy.url.toString(), fetchedAt, message: "No adapter for this host.", strategy: "none", diagnostics: diag({ strategy: "none" }) };
  }

  const ctx = (finalUrl: string): WatchContext => ({
    url: new URL(finalUrl),
    athleteName: athlete,
    timezone: options.timezone || DEFAULT_TIMEZONE,
    eventDate: options.eventDate ?? null,
    now,
  });
  const base: Pick<WatchResult, "platform" | "athlete" | "matches" | "sourceUrl" | "fetchedAt"> = {
    platform: adapter.platform,
    athlete,
    matches: [],
    sourceUrl: policy.url.toString(),
    fetchedAt,
  };

  let plain: WatchResult | null = null;
  if (!preferBrowserWorker()) {
    const fetched = await safeFetchHtml(policy.url);
    let attempt: WatchResult;
    if (!fetched.ok) {
      attempt = {
        ...base,
        status: "FETCH_ERROR",
        code: fetchCode(fetched),
        message: fetched.message,
        strategy: "http",
        diagnostics: diag({ strategy: "http", sourceStatus: fetched.status ?? null, attempts: fetched.attempts }),
      };
    } else {
      const parsed = adapter.parse(fetched.html, ctx(fetched.finalUrl));
      const strategy = parsed.strategy ? `http:${parsed.strategy}` : "http";
      attempt = { ...parsed, strategy, diagnostics: diag({ strategy, sourceStatus: fetched.status, finalUrl: fetched.finalUrl, attempts: fetched.attempts }) };
    }
    if (attempt.status !== "REQUIRES_BROWSER_WATCHER") return attempt;
    if (!isBrowserWorkerConfigured()) {
      return { ...attempt, code: "BROWSER_WORKER_NOT_CONFIGURED", message: `${attempt.message ?? "The source needs a browser."} The browser worker is not configured.` };
    }
    plain = attempt;
  }

  // Browser path.
  const rendered = await browserFetchHtml(policy.url);
  if (!rendered.ok) {
    const mapped = browserFailure(rendered.code);
    const fallback = plain ?? { ...base };
    return {
      ...fallback,
      status: mapped.status,
      code: mapped.code,
      message: mapped.message(rendered.message),
      strategy: "browser",
      diagnostics: diag({ strategy: "browser", sourceStatus: rendered.status ?? null, elapsedMs: rendered.elapsedMs ?? Date.now() - started, workerCode: rendered.challengeKind ? `${rendered.workerCode ?? rendered.code}:${rendered.challengeKind}` : rendered.workerCode ?? rendered.code, attempts: rendered.attempts }),
    };
  }
  const result = adapter.parse(rendered.html, ctx(rendered.finalUrl));
  const strategy = `browser:${result.strategy ?? "none"}`;
  return {
    ...result,
    strategy,
    diagnostics: diag({ strategy, sourceStatus: rendered.status, finalUrl: rendered.finalUrl, elapsedMs: rendered.elapsedMs, attempts: rendered.attempts }),
  };
}

function fetchCode(r: Extract<SafeFetchResult, { ok: false }>): WatchCode {
  switch (r.code) {
    case "TIMEOUT":
      return "SOURCE_TIMEOUT";
    case "HTTP_ERROR":
      return "SOURCE_HTTP_ERROR";
    case "TOO_LARGE":
      return "SOURCE_TOO_LARGE";
    case "REDIRECT_BLOCKED":
      return "REDIRECT_BLOCKED";
    default:
      return "SOURCE_NETWORK";
  }
}

function browserFailure(code: BrowserFetchCode): { status: WatchStatus; code: WatchCode; message: (worker: string) => string } {
  switch (code) {
    case "CHALLENGE_NOT_CLEARED":
      return {
        status: "REQUIRES_BROWSER_WATCHER",
        code: "BROWSER_CHALLENGE",
        message: (w) => (/interactive|turnstile/i.test(w) ? `Browser worker hit an interactive CAPTCHA (CHALLENGE_NOT_CLEARED). ${w}` : "Browser worker could not clear the site's bot challenge (CHALLENGE_NOT_CLEARED)."),
      };
    case "NOT_CONFIGURED":
      return { status: "REQUIRES_BROWSER_WATCHER", code: "BROWSER_WORKER_NOT_CONFIGURED", message: () => "The source needs a browser and the browser worker is not configured." };
    case "TIMEOUT":
      return { status: "FETCH_ERROR", code: "BROWSER_WORKER_TIMEOUT", message: () => "Browser worker timed out while rendering the page." };
    case "WORKER_UNREACHABLE":
      return { status: "FETCH_ERROR", code: "BROWSER_WORKER_UNREACHABLE", message: (w) => `Browser worker unreachable: ${w}` };
    case "WORKER_RESTARTING":
      return { status: "FETCH_ERROR", code: "BROWSER_WORKER_RESTARTING", message: () => "Browser worker was restarting; try again in a moment." };
    case "PROXY_ERROR":
      return { status: "FETCH_ERROR", code: "BROWSER_PROXY_ERROR", message: (w) => `Browser worker proxy problem: ${w}` };
    case "REDIRECT_BLOCKED":
      return { status: "FETCH_ERROR", code: "REDIRECT_BLOCKED", message: (w) => w };
    default:
      return { status: "FETCH_ERROR", code: "BROWSER_WORKER_ERROR", message: (w) => `Browser worker error: ${w}` };
  }
}

export { validateSourceUrl } from "./url-policy";
export type { NormalizedMatch, WatchResult, WatchStatus, WatchCode } from "./types";
