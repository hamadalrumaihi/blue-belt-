import "server-only";
import { platformForHost } from "./url-policy";

export const FETCH_TIMEOUT_MS = 8_000;
export const MAX_HTML_BYTES = 2 * 1024 * 1024; // 2 MB
const MAX_REDIRECTS = 3;
/** Total attempts for transient failures (timeouts, network, 5xx). */
export const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [400, 1_200];

const USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

export type SafeFetchFailureCode = "TIMEOUT" | "HTTP_ERROR" | "TOO_LARGE" | "NETWORK" | "REDIRECT_BLOCKED";

type FetchOnce =
  | { ok: true; html: string; finalUrl: string; status: number }
  | { ok: false; code: SafeFetchFailureCode; status?: number; message: string };

export type SafeFetchResult = FetchOnce & { attempts: number };

export type SafeFetchOptions = {
  /** Override for tests. */
  fetchImpl?: typeof fetch;
  /** Override for tests (defaults to real timers). */
  sleep?: (ms: number) => Promise<void>;
  maxAttempts?: number;
};

const TRANSIENT_HTTP = new Set([408, 425, 429, 500, 502, 503, 504]);

/**
 * Fetches an allow-listed HTML page with a hard timeout, a body size cap and
 * manual redirect following that re-validates the host on every hop.
 * Transient failures (timeout, network error, 5xx) are retried with a short
 * backoff; 4xx, oversized bodies and blocked redirects are not.
 */
export async function safeFetchHtml(url: URL, options: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const maxAttempts = options.maxAttempts ?? MAX_ATTEMPTS;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let attempt = 1;
  for (;;) {
    const result = await fetchOnce(url, options.fetchImpl ?? fetch);
    if (result.ok || !isTransient(result) || attempt >= maxAttempts) return { ...result, attempts: attempt };
    await sleep(BACKOFF_MS[Math.min(attempt - 1, BACKOFF_MS.length - 1)] + Math.floor(Math.random() * 200));
    attempt += 1;
  }
}

function isTransient(r: Extract<FetchOnce, { ok: false }>): boolean {
  if (r.code === "TIMEOUT" || r.code === "NETWORK") return true;
  return r.code === "HTTP_ERROR" && r.status !== undefined && TRANSIENT_HTTP.has(r.status);
}

async function fetchOnce(url: URL, fetchImpl: typeof fetch): Promise<FetchOnce> {
  let current = url;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!platformForHost(current.hostname) || current.protocol !== "https:") {
      return { ok: false, code: "REDIRECT_BLOCKED", message: `Redirect to ${current.hostname} blocked.` };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetchImpl(current, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        cache: "no-store",
        headers: {
          "user-agent": USER_AGENT,
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "accept-language": "en-GB,en;q=0.9",
        },
      });
    } catch (err) {
      clearTimeout(timer);
      const aborted = err instanceof Error && err.name === "AbortError";
      return aborted
        ? { ok: false, code: "TIMEOUT", message: `Source did not respond within ${FETCH_TIMEOUT_MS / 1000}s.` }
        : { ok: false, code: "NETWORK", message: err instanceof Error ? err.message : "Network error." };
    }

    if (response.status >= 300 && response.status < 400) {
      clearTimeout(timer);
      const location = response.headers.get("location");
      if (!location) {
        return { ok: false, code: "HTTP_ERROR", status: response.status, message: "Redirect without location." };
      }
      try {
        current = new URL(location, current);
      } catch {
        return { ok: false, code: "REDIRECT_BLOCKED", message: "Invalid redirect target." };
      }
      continue;
    }

    try {
      const html = await readCapped(response, MAX_HTML_BYTES);
      clearTimeout(timer);
      // 403 responses are still returned: Cloudflare challenges use them and the
      // adapter needs the body to classify REQUIRES_BROWSER_WATCHER.
      if (!response.ok && response.status !== 403) {
        return { ok: false, code: "HTTP_ERROR", status: response.status, message: `Source returned HTTP ${response.status}.` };
      }
      return { ok: true, html, finalUrl: current.toString(), status: response.status };
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof TooLargeError) {
        return { ok: false, code: "TOO_LARGE", message: "Page exceeded the 2 MB limit." };
      }
      const aborted = err instanceof Error && err.name === "AbortError";
      return aborted
        ? { ok: false, code: "TIMEOUT", message: "Timed out while reading the page." }
        : { ok: false, code: "NETWORK", message: err instanceof Error ? err.message : "Read error." };
    }
  }

  return { ok: false, code: "REDIRECT_BLOCKED", message: "Too many redirects." };
}

class TooLargeError extends Error {}

async function readCapped(response: Response, max: number): Promise<string> {
  const body = response.body;
  if (!body) return "";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      throw new TooLargeError();
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder("utf-8").decode(merged);
}
