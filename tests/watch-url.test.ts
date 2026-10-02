import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { setLogSink, type LogLevel } from "@/lib/log";
import { watchUrl } from "@/lib/watchers";
import { fixture } from "./fixtures";

const WORKER = "https://worker.test";
const TOKEN = "worker-token-0123456789abcdef";
const PAGE = "https://ajptour.com/events/4471/brackets/88";
const NOW = new Date("2026-03-14T06:00:00.000Z");

const server = setupServer();
const logs: Array<{ level: LogLevel; line: string; record: Record<string, unknown> }> = [];

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
beforeEach(() => {
  logs.length = 0;
  setLogSink((level, line) => logs.push({ level, line, record: JSON.parse(line) as Record<string, unknown> }));
  process.env.WATCHER_WORKER_URL = WORKER;
  process.env.WATCHER_WORKER_TOKEN = TOKEN;
  delete process.env.WATCHER_PREFER_BROWSER;
});
afterEach(() => {
  server.resetHandlers();
  setLogSink(null);
});

const challenge = () => new HttpResponse(fixture("cloudflare-challenge"), { status: 403, headers: { "content-type": "text/html" } });
const workerOk = (html: string, finalUrl = PAGE) => HttpResponse.json({ ok: true, html, finalUrl, status: 200, elapsedMs: 2500, strategy: "browser" });
const opts = { athleteName: "Hamad Al Rumaihi", timezone: "Asia/Qatar", eventDate: "2026-03-14", now: NOW };

function expectCleanLogs() {
  expect(logs).toHaveLength(1);
  expect(logs[0].record).toMatchObject({ msg: `[watch] ${logs[0].record.status}`, tag: "[watch]" });
  for (const l of logs) {
    expect(l.line).not.toContain(TOKEN);
    expect(l.line).not.toContain("<html");
    expect(l.line).not.toMatch(/@[a-z0-9.-]+\.[a-z]{2,}/i);
  }
}

describe("watchUrl end-to-end (MSW)", () => {
  it("parses a plain 200 response (http:table) with diagnostics", async () => {
    server.use(http.get(PAGE, () => HttpResponse.html(fixture("ajp-bracket-table"))));
    const result = await watchUrl(PAGE, opts);
    expect(result).toMatchObject({ platform: "AJP", status: "OK", code: "MATCHES_FOUND", strategy: "http:table", sourceUrl: PAGE, fetchedAt: NOW.toISOString() });
    expect(result.matches).toHaveLength(2);
    expect(result.matches[0]).toMatchObject({ mat: "Mat 3", opponent: "João Silva", scheduledAt: "2026-03-14T07:40:00.000Z" });
    expect(result.diagnostics).toMatchObject({ strategy: "http:table", sourceStatus: 200, finalUrl: PAGE, attempts: 1 });
    expect(result.diagnostics?.elapsedMs).toBeGreaterThanOrEqual(0);
    expectCleanLogs();
    expect(logs[0].record).toMatchObject({ status: "OK", code: "MATCHES_FOUND", strategy: "http:table", matches: 2, host: "ajptour.com", path: "/events/4471/brackets/88", sourceStatus: 200, attempts: 1 });
  });

  it("falls through to the browser worker on a challenge and parses the rendered page (browser:table)", async () => {
    const workerCalls: unknown[] = [];
    server.use(
      http.get(PAGE, challenge),
      http.post(`${WORKER}/render`, async ({ request }) => {
        workerCalls.push({ auth: request.headers.get("authorization"), body: await request.json() });
        return workerOk(fixture("ajp-bracket-table"));
      }),
    );
    const result = await watchUrl(PAGE, opts);
    expect(result).toMatchObject({ status: "OK", code: "MATCHES_FOUND", strategy: "browser:table", athlete: "Hamad Al Rumaihi" });
    expect(result.matches.map((m) => m.matchNumber)).toEqual(["12", "27"]);
    expect(result.diagnostics).toEqual({ strategy: "browser:table", sourceStatus: 200, finalUrl: PAGE, elapsedMs: 2500, attempts: 1 });
    expect(workerCalls).toEqual([{ auth: `Bearer ${TOKEN}`, body: { url: PAGE } }]);
    expectCleanLogs();
    expect(logs[0].record).toMatchObject({ strategy: "browser:table", sourceStatus: 200, matches: 2 });
  });

  it("uses the rendered final URL for the parse context", async () => {
    const landed = "https://www.ajptour.com/events/4471/brackets/88?tab=matches";
    server.use(http.get(PAGE, challenge), http.post(`${WORKER}/render`, () => workerOk(fixture("ajp-embedded-json"), landed)));
    const result = await watchUrl(PAGE, opts);
    expect(result.strategy).toBe("browser:embedded-json");
    expect(result.matches[0].sourceUrl).toBe(landed);
    expect(result.diagnostics?.finalUrl).toBe(landed);
    // A successful parse reports the page it actually read; failures keep the configured URL.
    expect(result.sourceUrl).toBe(landed);
  });

  it("reports BROWSER_WORKER_NOT_CONFIGURED when a challenge is met and no worker is set", async () => {
    delete process.env.WATCHER_WORKER_URL;
    delete process.env.WATCHER_WORKER_TOKEN;
    server.use(http.get(PAGE, challenge));
    const result = await watchUrl(PAGE, opts);
    expect(result).toMatchObject({ status: "REQUIRES_BROWSER_WATCHER", code: "BROWSER_WORKER_NOT_CONFIGURED", strategy: "http", matches: [] });
    expect(result.message).toMatch(/browser challenge/);
    expect(result.message).toMatch(/not configured/);
    expect(result.diagnostics).toMatchObject({ strategy: "http", sourceStatus: 403, finalUrl: PAGE, attempts: 1 });
    expectCleanLogs();
  });

  it("JS shells go to the worker too; a worker that cannot clear the challenge yields BROWSER_CHALLENGE", async () => {
    server.use(
      http.get(PAGE, () => HttpResponse.html(fixture("js-shell"))),
      http.post(`${WORKER}/render`, () => HttpResponse.json({ ok: false, code: "CHALLENGE_NOT_CLEARED", message: "did not clear", status: 403, elapsedMs: 35_000 }, { status: 502 })),
    );
    const result = await watchUrl(PAGE, opts);
    expect(result).toMatchObject({ status: "REQUIRES_BROWSER_WATCHER", code: "BROWSER_CHALLENGE", strategy: "browser", matches: [] });
    expect(result.message).toContain("CHALLENGE_NOT_CLEARED");
    expect(result.diagnostics).toMatchObject({ strategy: "browser", sourceStatus: 403, elapsedMs: 35_000, workerCode: "CHALLENGE_NOT_CLEARED", attempts: 1 });
    expectCleanLogs();
    expect(logs[0].record).toMatchObject({ code: "BROWSER_CHALLENGE", workerCode: "CHALLENGE_NOT_CLEARED" });
  });

  it("maps worker failures to FETCH_ERROR codes (restarting is retried once)", async () => {
    let renders = 0;
    server.use(
      http.get(PAGE, challenge),
      http.post(`${WORKER}/render`, () => { renders += 1; return HttpResponse.json({ ok: false, code: "WORKER_RESTARTING", message: "restarting" }, { status: 503 }); }),
    );
    const result = await watchUrl(PAGE, opts);
    expect(result).toMatchObject({ status: "FETCH_ERROR", code: "BROWSER_WORKER_RESTARTING", strategy: "browser" });
    expect(result.diagnostics).toMatchObject({ workerCode: "WORKER_RESTARTING", attempts: 2 });
    expect(renders).toBe(2);
  }, 10_000);

  it("maps a worker landing off the allow-list to REDIRECT_BLOCKED", async () => {
    server.use(http.get(PAGE, challenge), http.post(`${WORKER}/render`, () => workerOk("<html>x</html>", "https://evil.example/")));
    const result = await watchUrl(PAGE, opts);
    expect(result).toMatchObject({ status: "FETCH_ERROR", code: "REDIRECT_BLOCKED", strategy: "browser", matches: [] });
  });

  it("WATCHER_PREFER_BROWSER=1 skips the plain fetch entirely", async () => {
    process.env.WATCHER_PREFER_BROWSER = "1";
    server.use(http.post(`${WORKER}/render`, () => workerOk(fixture("smoothcomp-cards"), "https://smoothcomp.com/en/event/18211/schedule")));
    const result = await watchUrl("https://smoothcomp.com/en/event/18211/schedule#top", { ...opts, timezone: "Europe/London", eventDate: "2026-07-04" });
    expect(result).toMatchObject({ platform: "SMOOTHCOMP", status: "OK", strategy: "browser:cards" });
    expect(result.matches[0].scheduledAt).toBe("2026-07-04T09:40:00.000Z");
  });

  it("maps plain-fetch failures: 404 -> SOURCE_HTTP_ERROR, blocked redirect -> REDIRECT_BLOCKED", async () => {
    server.use(http.get(PAGE, () => new HttpResponse("gone", { status: 404 })));
    const notFound = await watchUrl(PAGE, opts);
    expect(notFound).toMatchObject({ status: "FETCH_ERROR", code: "SOURCE_HTTP_ERROR", strategy: "http", message: "Source returned HTTP 404." });
    expect(notFound.diagnostics).toMatchObject({ sourceStatus: 404, attempts: 1 });

    server.use(http.get(PAGE, () => new HttpResponse(null, { status: 302, headers: { location: "https://evil.example/" } })));
    expect(await watchUrl(PAGE, opts)).toMatchObject({ status: "FETCH_ERROR", code: "REDIRECT_BLOCKED" });
  });

  it("rejects bad URLs before any network call", async () => {
    expect(await watchUrl("not a url", opts)).toMatchObject({ platform: "OTHER", status: "INVALID_URL", code: "INVALID_URL", strategy: "none", sourceUrl: "not a url" });
    expect(await watchUrl(null, opts)).toMatchObject({ status: "INVALID_URL", sourceUrl: "" });
    expect(await watchUrl("https://example.com/x", opts)).toMatchObject({ status: "UNSUPPORTED_HOST", code: "UNSUPPORTED_HOST" });
    expect(await watchUrl("https://ajptour.com:8443/x", opts)).toMatchObject({ status: "INVALID_URL" });
    expect(logs.map((l) => l.record.status)).toEqual(["INVALID_URL", "INVALID_URL", "UNSUPPORTED_HOST", "INVALID_URL"]);
  });

  it("redacts an e-mail-like athlete name that ends up in the log detail", async () => {
    server.use(http.get(PAGE, () => HttpResponse.html(fixture("ajp-bracket-table"))));
    const result = await watchUrl(PAGE, { ...opts, athleteName: "hamad.alrumaihi@example.com" });
    expect(result.status).toBe("ATHLETE_NOT_FOUND");
    expect(result.message).toContain("hamad.alrumaihi@example.com");
    expectCleanLogs();
    expect(logs[0].record.detail).toContain("[email]");
  });
});
