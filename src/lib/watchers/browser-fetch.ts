import "server-only";
import { platformForHost } from "./url-policy";

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

export type BrowserFetchResult =
  | { ok: true; html: string; finalUrl: string; status: number | null; elapsedMs: number }
  | { ok: false; code: "NOT_CONFIGURED" | "CHALLENGE_NOT_CLEARED" | "WORKER_ERROR" | "TIMEOUT" | "REDIRECT_BLOCKED"; message: string };

export function isBrowserWorkerConfigured(): boolean {
  return Boolean(process.env.WATCHER_WORKER_URL && process.env.WATCHER_WORKER_TOKEN);
}

export function preferBrowserWorker(): boolean {
  return isBrowserWorkerConfigured() && process.env.WATCHER_PREFER_BROWSER === "1";
}

export async function browserFetchHtml(url: URL): Promise<BrowserFetchResult> {
  const base = process.env.WATCHER_WORKER_URL?.replace(/\/$/, "");
  const token = process.env.WATCHER_WORKER_TOKEN;
  if (!base || !token) return { ok: false, code: "NOT_CONFIGURED", message: "Browser worker is not configured." };

  let response: Response;
  try {
    response = await fetch(`${base}/render`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ url: url.toString() }),
      cache: "no-store",
      signal: AbortSignal.timeout(WORKER_TIMEOUT_MS),
    });
  } catch (err) {
    const timeout = err instanceof Error && err.name === "TimeoutError";
    return { ok: false, code: timeout ? "TIMEOUT" : "WORKER_ERROR", message: timeout ? "Browser worker timed out." : `Browser worker unreachable: ${err instanceof Error ? err.message : "error"}` };
  }

  let body: { ok?: boolean; html?: string; finalUrl?: string; status?: number | null; elapsedMs?: number; code?: string; message?: string };
  try {
    body = (await response.json()) as typeof body;
  } catch {
    return { ok: false, code: "WORKER_ERROR", message: `Browser worker returned HTTP ${response.status} without JSON.` };
  }

  if (!response.ok || !body.ok || typeof body.html !== "string") {
    const code = body.code === "CHALLENGE_NOT_CLEARED" ? "CHALLENGE_NOT_CLEARED" : body.code === "TIMEOUT" ? "TIMEOUT" : "WORKER_ERROR";
    return { ok: false, code, message: body.message ?? `Browser worker error (HTTP ${response.status}).` };
  }

  // The worker enforces its own allow-list, but never trust a redirect target blindly.
  let finalUrl = url.toString();
  if (body.finalUrl) {
    try {
      const final = new URL(body.finalUrl);
      if (!platformForHost(final.hostname)) return { ok: false, code: "REDIRECT_BLOCKED", message: `Redirect to ${final.hostname} blocked.` };
      finalUrl = final.toString();
    } catch {
      /* keep original */
    }
  }

  return { ok: true, html: body.html, finalUrl, status: body.status ?? null, elapsedMs: body.elapsedMs ?? 0 };
}
