import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { browserFetchHtml, isBrowserWorkerConfigured, mapWorkerCode, preferBrowserWorker } from "@/lib/watchers/browser-fetch";

const WORKER = "https://worker.test";
const TOKEN = "worker-token-0123456789abcdef";
const TARGET = new URL("https://ajptour.com/events/4471/brackets/88");
const noSleep = async () => {};

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

beforeEach(() => {
  process.env.WATCHER_WORKER_URL = `${WORKER}/`; // trailing slash must be tolerated
  process.env.WATCHER_WORKER_TOKEN = TOKEN;
  delete process.env.WATCHER_PREFER_BROWSER;
});

describe("configuration", () => {
  it("is configured only when both url and token are set; prefer-browser needs the flag too", () => {
    expect(isBrowserWorkerConfigured()).toBe(true);
    expect(preferBrowserWorker()).toBe(false);
    process.env.WATCHER_PREFER_BROWSER = "1";
    expect(preferBrowserWorker()).toBe(true);
    delete process.env.WATCHER_WORKER_TOKEN;
    expect(isBrowserWorkerConfigured()).toBe(false);
    expect(preferBrowserWorker()).toBe(false);
  });

  it("returns NOT_CONFIGURED without a network call when unset", async () => {
    delete process.env.WATCHER_WORKER_URL;
    const result = await browserFetchHtml(TARGET, { sleep: noSleep });
    expect(result).toEqual({ ok: false, code: "NOT_CONFIGURED", message: "Browser worker is not configured.", attempts: 1 });
  });

  it("maps worker codes", () => {
    expect(mapWorkerCode("CHALLENGE_NOT_CLEARED")).toBe("CHALLENGE_NOT_CLEARED");
    expect(mapWorkerCode("TIMEOUT")).toBe("TIMEOUT");
    expect(mapWorkerCode("WORKER_RESTARTING")).toBe("WORKER_RESTARTING");
    expect(mapWorkerCode("BROWSER_CLOSED")).toBe("WORKER_RESTARTING");
    expect(mapWorkerCode("PROXY_AUTH_FAILED")).toBe("PROXY_ERROR");
    expect(mapWorkerCode("PROXY_ERROR")).toBe("PROXY_ERROR");
    expect(mapWorkerCode("NAVIGATION_ERROR")).toBe("WORKER_ERROR");
    expect(mapWorkerCode(undefined)).toBe("WORKER_ERROR");
  });
});

describe("browserFetchHtml against the worker (MSW)", () => {
  it("returns the rendered HTML on success and sends the bearer token", async () => {
    const seen: Array<{ auth: string | null; body: unknown }> = [];
    server.use(
      http.post(`${WORKER}/render`, async ({ request }) => {
        seen.push({ auth: request.headers.get("authorization"), body: await request.json() });
        return HttpResponse.json({ ok: true, html: "<html><body>rendered</body></html>", finalUrl: "https://ajptour.com/events/4471/brackets/88?tab=matches#top", status: 200, elapsedMs: 1234, strategy: "browser" });
      }),
    );
    const result = await browserFetchHtml(TARGET, { sleep: noSleep });
    expect(result).toEqual({ ok: true, html: "<html><body>rendered</body></html>", finalUrl: "https://ajptour.com/events/4471/brackets/88?tab=matches", status: 200, elapsedMs: 1234, attempts: 1 });
    expect(seen).toEqual([{ auth: `Bearer ${TOKEN}`, body: { url: TARGET.toString() } }]);
  });

  it("CHALLENGE_NOT_CLEARED from the worker is not retried", async () => {
    let calls = 0;
    server.use(
      http.post(`${WORKER}/render`, () => {
        calls += 1;
        return HttpResponse.json({ ok: false, code: "CHALLENGE_NOT_CLEARED", message: "The site's bot challenge did not clear in time.", status: 403, elapsedMs: 35_000 }, { status: 502 });
      }),
    );
    const result = await browserFetchHtml(TARGET, { sleep: noSleep });
    expect(result).toEqual({ ok: false, code: "CHALLENGE_NOT_CLEARED", workerCode: "CHALLENGE_NOT_CLEARED", message: "The site's bot challenge did not clear in time.", status: 403, elapsedMs: 35_000, attempts: 1 });
    expect(calls).toBe(1);
  });

  it("503 WORKER_RESTARTING is retried once, then reported", async () => {
    let calls = 0;
    const slept: number[] = [];
    server.use(
      http.post(`${WORKER}/render`, () => {
        calls += 1;
        return HttpResponse.json({ ok: false, code: "WORKER_RESTARTING", message: "Restarting." }, { status: 503 });
      }),
    );
    const result = await browserFetchHtml(TARGET, { sleep: async (ms) => { slept.push(ms); } });
    expect(result).toMatchObject({ ok: false, code: "WORKER_RESTARTING", workerCode: "WORKER_RESTARTING", attempts: 2 });
    expect(calls).toBe(2);
    expect(slept).toEqual([1000]);
  });

  it("recovers when the retry succeeds", async () => {
    server.use(
      http.post(`${WORKER}/render`, () => HttpResponse.json({ ok: false, code: "BROWSER_CLOSED", message: "closed" }, { status: 502 }), { once: true }),
      http.post(`${WORKER}/render`, () => HttpResponse.json({ ok: true, html: "<html>late</html>", finalUrl: TARGET.toString(), status: 200, elapsedMs: 5 })),
    );
    const result = await browserFetchHtml(TARGET, { sleep: noSleep });
    expect(result).toMatchObject({ ok: true, html: "<html>late</html>", attempts: 2 });
  });

  it("a network error is WORKER_UNREACHABLE after two attempts", async () => {
    let calls = 0;
    server.use(
      http.post(`${WORKER}/render`, () => {
        calls += 1;
        return HttpResponse.error();
      }),
    );
    const result = await browserFetchHtml(TARGET, { sleep: noSleep });
    expect(result).toEqual({ ok: false, code: "WORKER_UNREACHABLE", message: "Browser worker unreachable.", attempts: 2 });
    expect(calls).toBe(2);
  });

  it("a 5xx without JSON (e.g. a platform error page) is WORKER_UNREACHABLE, retried once", async () => {
    server.use(http.post(`${WORKER}/render`, () => new HttpResponse("<html>Bad gateway</html>", { status: 502, headers: { "content-type": "text/html" } })));
    const result = await browserFetchHtml(TARGET, { sleep: noSleep });
    expect(result).toMatchObject({ ok: false, code: "WORKER_UNREACHABLE", status: 502, attempts: 2 });
    expect(result.ok === false && result.message).toBe("Browser worker returned HTTP 502 without JSON.");
  });

  it("a 4xx without JSON is WORKER_ERROR, not retried", async () => {
    server.use(http.post(`${WORKER}/render`, () => new HttpResponse("nope", { status: 401 })));
    expect(await browserFetchHtml(TARGET, { sleep: noSleep })).toMatchObject({ ok: false, code: "WORKER_ERROR", status: 401, attempts: 1 });
  });

  it("a 5xx with JSON but no code is WORKER_UNREACHABLE; a 200 that is not ok maps the code", async () => {
    server.use(http.post(`${WORKER}/render`, () => HttpResponse.json({ ok: false, message: "x".repeat(300) }, { status: 504 })));
    const first = await browserFetchHtml(TARGET, { sleep: noSleep });
    expect(first).toMatchObject({ ok: false, code: "WORKER_UNREACHABLE", attempts: 2 });
    expect(first.ok === false && first.message.length).toBe(200);

    server.use(http.post(`${WORKER}/render`, () => HttpResponse.json({ ok: false, code: "TIMEOUT", message: "slow" })));
    expect(await browserFetchHtml(TARGET, { sleep: noSleep })).toMatchObject({ ok: false, code: "TIMEOUT", workerCode: "TIMEOUT", attempts: 1 });
  });

  it("a finalUrl outside the allow-list is REDIRECT_BLOCKED even when the worker says ok", async () => {
    server.use(http.post(`${WORKER}/render`, () => HttpResponse.json({ ok: true, html: "<html>phish</html>", finalUrl: "https://evil.example/login", status: 200, elapsedMs: 5 })));
    expect(await browserFetchHtml(TARGET, { sleep: noSleep })).toEqual({ ok: false, code: "REDIRECT_BLOCKED", message: "Browser worker landed on a non-allow-listed page.", attempts: 1 });
  });

  it("PROXY_AUTH_FAILED and PROXY_ERROR map to PROXY_ERROR", async () => {
    server.use(http.post(`${WORKER}/render`, () => HttpResponse.json({ ok: false, code: "PROXY_AUTH_FAILED", message: "The proxy rejected the BROWSER_PROXY credentials (HTTP 407)." }, { status: 502 }), { once: true }));
    expect(await browserFetchHtml(TARGET, { sleep: noSleep })).toMatchObject({ ok: false, code: "PROXY_ERROR", workerCode: "PROXY_AUTH_FAILED", attempts: 1 });
    server.use(http.post(`${WORKER}/render`, () => HttpResponse.json({ ok: false, code: "PROXY_ERROR", message: "ERR_TUNNEL_CONNECTION_FAILED" }, { status: 502 })));
    expect(await browserFetchHtml(TARGET, { sleep: noSleep })).toMatchObject({ ok: false, code: "PROXY_ERROR", workerCode: "PROXY_ERROR", attempts: 1 });
  });

  it("a body without html is treated as a worker error", async () => {
    server.use(http.post(`${WORKER}/render`, () => HttpResponse.json({ ok: true, finalUrl: TARGET.toString() })));
    expect(await browserFetchHtml(TARGET, { sleep: noSleep })).toMatchObject({ ok: false, code: "WORKER_ERROR", message: "Browser worker error (HTTP 200).", attempts: 1 });
  });
});
