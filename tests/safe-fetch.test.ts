import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { FETCH_TIMEOUT_MS, MAX_ATTEMPTS, MAX_HTML_BYTES, safeFetchHtml } from "@/lib/watchers/safe-fetch";

const PAGE = "https://ajptour.com/events/4471/brackets/88";
const noSleep = async () => {};
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  vi.useRealTimers();
});
afterAll(() => server.close());

describe("safeFetchHtml (MSW)", () => {
  it("returns the HTML and the final URL on 200", async () => {
    const seen: Record<string, string | null>[] = [];
    server.use(
      http.get(PAGE, ({ request }) => {
        seen.push({ ua: request.headers.get("user-agent"), accept: request.headers.get("accept") });
        return HttpResponse.html("<html><title>ok</title></html>");
      }),
    );
    const result = await safeFetchHtml(new URL(PAGE), { sleep: noSleep });
    expect(result).toEqual({ ok: true, html: "<html><title>ok</title></html>", finalUrl: PAGE, status: 200, attempts: 1 });
    expect(seen[0].ua).toMatch(/iPhone/);
    expect(seen[0].accept).toMatch(/text\/html/);
  });

  it("retries a 503 and succeeds on the second attempt (attempts 2)", async () => {
    const slept: number[] = [];
    server.use(
      http.get(PAGE, () => new HttpResponse("busy", { status: 503 }), { once: true }),
      http.get(PAGE, () => HttpResponse.html("<html>fine</html>")),
    );
    const result = await safeFetchHtml(new URL(PAGE), { sleep: async (ms) => { slept.push(ms); } });
    expect(result).toMatchObject({ ok: true, html: "<html>fine</html>", status: 200, attempts: 2 });
    expect(slept).toHaveLength(1);
    expect(slept[0]).toBeGreaterThanOrEqual(400);
    expect(slept[0]).toBeLessThan(600);
  });

  it("gives up after MAX_ATTEMPTS transient failures with growing backoff", async () => {
    let calls = 0;
    const slept: number[] = [];
    server.use(http.get(PAGE, () => { calls += 1; return new HttpResponse("down", { status: 502 }); }));
    const result = await safeFetchHtml(new URL(PAGE), { sleep: async (ms) => { slept.push(ms); } });
    expect(result).toEqual({ ok: false, code: "HTTP_ERROR", status: 502, message: "Source returned HTTP 502.", attempts: MAX_ATTEMPTS });
    expect(calls).toBe(MAX_ATTEMPTS);
    expect(slept).toHaveLength(MAX_ATTEMPTS - 1);
    expect(slept[1]).toBeGreaterThanOrEqual(1200);
  });

  it("does not retry a 404 (attempts 1)", async () => {
    let calls = 0;
    server.use(http.get(PAGE, () => { calls += 1; return new HttpResponse("gone", { status: 404 }); }));
    const result = await safeFetchHtml(new URL(PAGE), { sleep: noSleep });
    expect(result).toEqual({ ok: false, code: "HTTP_ERROR", status: 404, message: "Source returned HTTP 404.", attempts: 1 });
    expect(calls).toBe(1);
  });

  it("returns a 403 body as ok (Cloudflare challenges use 403)", async () => {
    server.use(http.get(PAGE, () => new HttpResponse("<html><title>Just a moment...</title></html>", { status: 403, headers: { "content-type": "text/html" } })));
    const result = await safeFetchHtml(new URL(PAGE), { sleep: noSleep });
    expect(result).toMatchObject({ ok: true, status: 403, attempts: 1 });
    expect(result.ok && result.html).toContain("Just a moment");
  });

  it("follows redirects inside the allow-list and reports the final URL", async () => {
    server.use(
      http.get("https://ajptour.com/go", () => new HttpResponse(null, { status: 302, headers: { location: "/events/4471/brackets/88" } })),
      http.get(PAGE, () => new HttpResponse(null, { status: 301, headers: { location: "https://www.ajptour.com/events/4471/brackets/88" } })),
      http.get("https://www.ajptour.com/events/4471/brackets/88", () => HttpResponse.html("<html>landed</html>")),
    );
    const result = await safeFetchHtml(new URL("https://ajptour.com/go"), { sleep: noSleep });
    expect(result).toEqual({ ok: true, html: "<html>landed</html>", finalUrl: "https://www.ajptour.com/events/4471/brackets/88", status: 200, attempts: 1 });
  });

  it("blocks a redirect to a non-allow-listed host without following it", async () => {
    let evilCalls = 0;
    server.use(
      http.get(PAGE, () => new HttpResponse(null, { status: 302, headers: { location: "https://evil.example/steal" } })),
      http.get("https://evil.example/steal", () => { evilCalls += 1; return HttpResponse.html("<html>evil</html>"); }),
    );
    const result = await safeFetchHtml(new URL(PAGE), { sleep: noSleep });
    expect(result).toEqual({ ok: false, code: "REDIRECT_BLOCKED", message: "Redirect to evil.example blocked.", attempts: 1 });
    expect(evilCalls).toBe(0);
  });

  it("blocks a downgrade to http:// and a redirect loop", async () => {
    server.use(http.get(PAGE, () => new HttpResponse(null, { status: 302, headers: { location: "http://ajptour.com/plain" } })));
    expect(await safeFetchHtml(new URL(PAGE), { sleep: noSleep })).toMatchObject({ ok: false, code: "REDIRECT_BLOCKED" });

    server.use(http.get("https://ajptour.com/loop", () => new HttpResponse(null, { status: 302, headers: { location: "https://ajptour.com/loop" } })));
    expect(await safeFetchHtml(new URL("https://ajptour.com/loop"), { sleep: noSleep })).toEqual({ ok: false, code: "REDIRECT_BLOCKED", message: "Too many redirects.", attempts: 1 });

    server.use(http.get("https://ajptour.com/nowhere", () => new HttpResponse(null, { status: 302 })));
    expect(await safeFetchHtml(new URL("https://ajptour.com/nowhere"), { sleep: noSleep })).toMatchObject({ ok: false, code: "HTTP_ERROR", status: 302, message: "Redirect without location." });
  });

  it("rejects a body over 2 MB as TOO_LARGE without retrying, cancelling the stream", async () => {
    expect(MAX_HTML_BYTES).toBe(2 * 1024 * 1024);
    // A chunked body served by a real streaming Response (MSW's mocked body
    // never resolves reader.cancel(), which safeFetchHtml awaits).
    let calls = 0;
    let cancelled = false;
    let sent = 0;
    const chunk = new Uint8Array(64 * 1024).fill(120);
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          sent += chunk.byteLength;
          controller.enqueue(chunk);
          if (sent >= 4 * MAX_HTML_BYTES) controller.close();
        },
        cancel() {
          cancelled = true;
        },
      });
      return new Response(body, { status: 200, headers: { "content-type": "text/html" } });
    };
    const result = await safeFetchHtml(new URL(PAGE), { fetchImpl, sleep: noSleep });
    expect(result).toEqual({ ok: false, code: "TOO_LARGE", message: "Page exceeded the 2 MB limit.", attempts: 1 });
    expect(calls).toBe(1);
    expect(cancelled).toBe(true);
    expect(sent).toBeLessThan(4 * MAX_HTML_BYTES); // stopped reading as soon as the cap was crossed
  });

  it("accepts a body of exactly 2 MB", async () => {
    server.use(http.get(PAGE, () => HttpResponse.html("x".repeat(MAX_HTML_BYTES))));
    const result = await safeFetchHtml(new URL(PAGE), { sleep: noSleep });
    expect(result.ok).toBe(true);
    expect(result.ok && result.html.length).toBe(MAX_HTML_BYTES);
  });

  it("a network error is retried and reported as NETWORK", async () => {
    let calls = 0;
    server.use(http.get(PAGE, () => { calls += 1; return HttpResponse.error(); }));
    const result = await safeFetchHtml(new URL(PAGE), { sleep: noSleep, maxAttempts: 2 });
    expect(result).toMatchObject({ ok: false, code: "NETWORK", attempts: 2 });
    expect(calls).toBe(2);
  });

  it("aborts a hanging source after the timeout", async () => {
    vi.useFakeTimers();
    const fetchImpl: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      });
    const pending = safeFetchHtml(new URL(PAGE), { fetchImpl, sleep: noSleep, maxAttempts: 1 });
    await vi.advanceTimersByTimeAsync(FETCH_TIMEOUT_MS + 1);
    expect(await pending).toEqual({ ok: false, code: "TIMEOUT", message: "Source did not respond within 8s.", attempts: 1 });
  });
});
