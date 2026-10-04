import os from "node:os";
import { backoffMs, classifyUpload, retryAfterMs } from "./schedule.mjs";

/**
 * HTTP client for the app's machine-intake endpoints. Only the capture
 * credential is ever sent (as a bearer token); the body never names an owner.
 */
export function createUploader({ appUrl, token, version, fetchImpl = fetch, log, timeoutMs = 60_000 }) {
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json", "user-agent": `bbm-capture-agent/${version} (${os.platform()})` };

  async function call(method, path, body) {
    try {
      const res = await fetchImpl(`${appUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
      const json = await res.json().catch(() => null);
      return { status: res.status, body: json, retryAfter: retryAfterMs(res.headers.get("retry-after")) };
    } catch (err) {
      return { status: 0, body: { code: "NETWORK", message: err instanceof Error ? err.message : String(err) }, retryAfter: 0 };
    }
  }

  return {
    /** GET /api/capture/jobs → { jobs, intervalSeconds } or null on failure (keeps the previous list). */
    async jobs() {
      const r = await call("GET", "/api/capture/jobs");
      if (r.status === 200 && r.body && Array.isArray(r.body.jobs)) return { jobs: r.body.jobs, intervalSeconds: Number(r.body.intervalSeconds) || 60 };
      const verdict = classifyUpload(r.status, r.body);
      log.warn("jobs.failed", { status: r.status, code: r.body?.code ?? null });
      return verdict.kind === "stop" ? { stop: verdict.code } : null;
    },

    /**
     * POST /api/capture for one spooled capture. Returns the verdict and the
     * delay before the next attempt when retryable.
     */
    async upload(capture) {
      const attempt = (capture.attempts ?? 0) + 1;
      const r = await call("POST", "/api/capture", {
        url: capture.url,
        html: capture.html,
        capture: { captureId: capture.captureId, capturedAt: capture.capturedAt, finalUrl: capture.finalUrl, completeness: capture.completeness },
      });
      const verdict = classifyUpload(r.status, r.body);
      const out = { ...verdict, attempt, status: r.status, body: r.body };
      if (verdict.kind === "retry") out.delayMs = backoffMs(attempt, { retryAfterMs: r.retryAfter });
      return out;
    },

    async heartbeat(status) {
      const r = await call("POST", "/api/capture/heartbeat", { agentVersion: version, status });
      return r.status === 200;
    },
  };
}
