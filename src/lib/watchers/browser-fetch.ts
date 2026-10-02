import "server-only";
import { validateSourceUrl } from "./url-policy";

/**
 * Client for the Playwright render worker (see /worker). The worker opens the
 * page in a real Chromium, waits for any Cloudflare challenge to clear and
 * returns the rendered HTML, which then goes through the same adapters as a
 * plain fetch. Configured with two server-only env vars:
 *
 *   WATCHER_WORKER_URL    e.g. https://bbm-worker.up.railway.app
 *   WATCHER_WORKER_TOKEN  shared secret (WORKER_TOKEN on the worker)
 *
 * WATCHER_PREFER_BROWSER=1 skips the plain fetch and always uses the worker.
 */

const WORKER_TIMEOUT_MS = 75_000;
const RETRY_DELAY_MS = 1_000;

export type BrowserFetchCode =
  | "NOT_CONFIGURED"
  | "CHALLENGE_NOT_CLEARED"
  | "WORKER_UNREACHABLE"
  | "WORKER_RESTARTING"
  | "WORKER_ERROR"
  | "PROXY_ERROR"
  | "TIMEOUT"
  | "REDIRECT_BLOCKED";

type RenderOnce =
  | { ok: true; html: string; finalUrl: string; status: number | null; elapsedMs: number }
  | { ok: false; code: BrowserFetchCode; message: string; workerCode?: string; status?: number | null; elapsedMs?: number };

export type BrowserFetchResult = RenderOnce & { attempts: number };

export type BrowserFetchOptions = { fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> };

export function isBrowserWorkerConfigured(): boolean {
  return Boolean(process.env.WATCHER_WORKER_URL && process.env.WATCHER_WORKER_TOKEN);
}

export function preferBrowserWorker(): boolean {
  return isBrowserWorkerConfigured() && process.env.WATCHER_PREFER_BROWSER === "1";
}

/** Maps the worker's error codes to the app's. Unknown codes become WORKER_ERROR. */
export function mapWorkerCode(code: string | undefined): BrowserFetchCode {
  switch (code) {
    case "CHALLENGE_NOT_CLEARED":
      return "CHALLENGE_NOT_CLEARED";
    case "TIMEOUT":
      return "TIMEOUT";
    case "WORKER_RESTARTING":
    case "BROWSER_CLOSED":
      return "WORKER_RESTARTING";
    case "PROXY_AUTH_FAILED":
    case "PROXY_ERROR":
      return "PROXY_ERROR";
    default:
      return "WORKER_ERROR";
  }
}

/** A worker outcome worth one immediate retry (the worker was restarting or unreachable). */
function retryable(code: BrowserFetchCode): boolean {
  return code === "WORKER_UNREACHABLE" || code === "WORKER_RESTARTING";
}

export async function browserFetchHtml(url: URL, options: BrowserFetchOptions = {}): Promise<BrowserFetchResult> {
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const first = await renderOnce(url, options.fetchImpl ?? fetch);
  if (first.ok || !retryable(first.code)) return { ...first, attempts: 1 };
  await sleep(RETRY_DELAY_MS);
  const second = await renderOnce(url, options.fetchImpl ?? fetch);
  return { ...second, attempts: 2 };
}

async function renderOnce(url: URL, fetchImpl: typeof fetch): Promise<RenderOnce> {
  const base = process.env.WATCHER_WORKER_URL?.replace(/\/$/, "");
  const token = process.env.WATCHER_WORKER_TOKEN;
  if (!base || !token) return { ok: false, code: "NOT_CONFIGURED", message: "Browser worker is not configured." };

  let response: Response;
  try {
    response = await fetchImpl(`${base}/render`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ url: url.toString() }),
      cache: "no-store",
      signal: AbortSignal.timeout(WORKER_TIMEOUT_MS),
    });
  } catch (err) {
    const timeout = err instanceof Error && err.name === "TimeoutError";
    return timeout
      ? { ok: false, code: "TIMEOUT", message: "Browser worker timed out." }
      : { ok: false, code: "WORKER_UNREACHABLE", message: "Browser worker unreachable." };
  }

  let body: { ok?: boolean; html?: string; finalUrl?: string; status?: number | null; elapsedMs?: number; code?: string; message?: string };
  try {
    body = (await response.json()) as typeof body;
  } catch {
    return { ok: false, code: response.status >= 500 ? "WORKER_UNREACHABLE" : "WORKER_ERROR", message: `Browser worker returned HTTP ${response.status} without JSON.`, status: response.status };
  }

  if (!response.ok || !body.ok || typeof body.html !== "string") {
    const workerCode = typeof body.code === "string" ? body.code : undefined;
    const code = response.status === 502 || response.status === 503 || response.status === 504
      ? (workerCode ? mapWorkerCode(workerCode) : "WORKER_UNREACHABLE")
      : mapWorkerCode(workerCode);
    return {
      ok: false,
      code,
      workerCode,
      message: typeof body.message === "string" ? body.message.slice(0, 200) : `Browser worker error (HTTP ${response.status}).`,
      status: typeof body.status === "number" ? body.status : null,
      elapsedMs: typeof body.elapsedMs === "number" ? body.elapsedMs : undefined,
    };
  }

  // The worker enforces its own allow-list, but never trust a redirect target blindly:
  // the final URL must pass the exact policy the input URL passed.
  let finalUrl = url.toString();
  if (body.finalUrl) {
    const policy = validateSourceUrl(body.finalUrl);
    if (!policy.ok) return { ok: false, code: "REDIRECT_BLOCKED", message: "Browser worker landed on a non-allow-listed page." };
    finalUrl = policy.url.toString();
  }

  return { ok: true, html: body.html, finalUrl, status: body.status ?? null, elapsedMs: body.elapsedMs ?? 0 };
}
