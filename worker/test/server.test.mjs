import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";

// The server module validates its config at import time; give it a token so
// the import itself is quiet. Every server under test injects its own deps.
process.env.WORKER_TOKEN = process.env.WORKER_TOKEN || "import-time-token-0123456789";
const { createServer } = await import("../src/server.mjs");

const TOKEN = "test-worker-token-0123456789";
const HOSTS = ["ajptour.com", "smoothcomp.com"];
const TARGET = "https://www.ajptour.com/events/4471/brackets/88";
const AUTH = { authorization: `Bearer ${TOKEN}` };
const stats = () => ({ active: 0, queued: 1, browserReady: true, mode: "new", engine: "playwright", proxy: null });

function harness(deps = {}) {
  const calls = [];
  let next = async (url) => ({ ok: true, html: `<html><body><table><tr><td>Mat 3</td><td>10:40</td></tr></table></body></html>`, finalUrl: url, status: 200, elapsedMs: 12 });
  const server = createServer({
    render: async (url, opts) => { calls.push({ url, opts }); return next(url, opts); },
    stats,
    configErrors: [],
    token: TOKEN,
    allowedHosts: HOSTS,
    ...deps,
  });
  return {
    server,
    calls,
    base: "",
    setRender(fn) { next = fn; },
    async start() { await new Promise((r) => server.listen(0, "127.0.0.1", r)); this.base = `http://127.0.0.1:${server.address().port}`; },
    async stop() { await new Promise((r) => server.close(r)); },
    render(body, headers = {}, init = {}) {
      return fetch(`${this.base}/render`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body), ...init });
    },
  };
}

describe("worker HTTP server", () => {
  const h = harness();
  before(() => h.start());
  after(() => h.stop());

  test("GET /health unauthenticated exposes only ok / browserReady / mode", async () => {
    const res = await fetch(`${h.base}/health`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.deepEqual(await res.json(), { ok: true, browserReady: true, mode: "new" });
  });

  test("GET /health with the token adds config problems, stats and uptime", async () => {
    const res = await fetch(`${h.base}/health`, { headers: AUTH });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.deepEqual(body.configErrors, []);
    assert.equal(body.engine, "playwright");
    assert.equal(body.queued, 1);
    assert.equal(typeof body.uptimeSec, "number");
  });

  test("POST /render without a token is 401 (wrong or truncated tokens too)", async () => {
    for (const headers of [{}, { authorization: "Bearer nope" }, { authorization: `Bearer ${TOKEN.slice(0, -1)}` }, { authorization: TOKEN }]) {
      const res = await h.render({ url: TARGET }, headers);
      assert.equal(res.status, 401);
      assert.deepEqual(await res.json(), { ok: false, code: "UNAUTHORIZED", message: "Missing or invalid worker token." });
    }
    assert.equal(h.calls.length, 0);
  });

  test("400 for invalid JSON and non-object bodies", async () => {
    const bad = await h.render("{nope", AUTH);
    assert.equal(bad.status, 400);
    assert.deepEqual(await bad.json(), { ok: false, code: "BAD_REQUEST", message: "Invalid JSON body." });
    for (const body of ["[]", "null", '"x"']) {
      const res = await h.render(body, AUTH);
      assert.equal(res.status, 400);
      assert.equal((await res.json()).code, "BAD_REQUEST");
    }
    // An empty body is treated as {} and fails URL validation instead.
    const empty = await h.render("", AUTH);
    assert.equal(empty.status, 400);
    assert.equal((await empty.json()).code, "INVALID_URL");
  });

  test("400 INVALID_URL for http://, credentials and custom ports", async () => {
    for (const url of ["http://ajptour.com/x", "https://user:pw@ajptour.com/x", "https://ajptour.com:8443/x", "", 42]) {
      const res = await h.render({ url }, AUTH);
      assert.equal(res.status, 400, String(url));
      const body = await res.json();
      assert.equal(body.ok, false);
      assert.equal(body.code, "INVALID_URL");
    }
    assert.equal(h.calls.length, 0);
  });

  test("403 UNSUPPORTED_HOST for hosts outside the allow-list (IP literals included)", async () => {
    for (const url of ["https://example.com/x", "https://127.0.0.1/", "https://ajptour.com.evil.example/x"]) {
      const res = await h.render({ url }, AUTH);
      assert.equal(res.status, 403, url);
      assert.equal((await res.json()).code, "UNSUPPORTED_HOST");
    }
    assert.equal(h.calls.length, 0);
  });

  // readBody() keeps draining an oversized body (without buffering it) so the
  // 413 is written on the open connection instead of resetting it.
  test("413 for an oversized body", async () => {
    const res = await h.render({ url: TARGET, pad: "x".repeat(70 * 1024) }, AUTH);
    assert.equal(res.status, 413);
    assert.deepEqual(await res.json(), { ok: false, code: "BAD_REQUEST", message: "Body too large." });
  });

  test("200 with html / finalUrl / strategy on success; fragment stripped and selector forwarded", async () => {
    h.calls.length = 0;
    const res = await h.render({ url: `${TARGET}#top`, waitForSelector: "table" }, AUTH);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.match(body.html, /Mat 3/);
    assert.equal(body.finalUrl, TARGET);
    assert.equal(body.strategy, "browser");
    assert.equal(body.status, 200);
    assert.equal(body.elapsedMs, 12);
    assert.ok(Date.parse(body.fetchedAt));
    assert.deepEqual(h.calls, [{ url: TARGET, opts: { waitForSelector: "table" } }]);
  });

  test("an overlong waitForSelector is ignored", async () => {
    h.calls.length = 0;
    await h.render({ url: TARGET, waitForSelector: "x".repeat(201) }, AUTH);
    assert.deepEqual(h.calls[0].opts, { waitForSelector: undefined });
  });

  test("502 with the render code when the browser fails", async () => {
    h.setRender(async () => ({ ok: false, code: "CHALLENGE_NOT_CLEARED", message: "The site's bot challenge did not clear in time.", elapsedMs: 35000 }));
    const res = await h.render({ url: TARGET }, AUTH);
    assert.equal(res.status, 502);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.equal(body.code, "CHALLENGE_NOT_CLEARED");
    assert.equal(body.message, "The site's bot challenge did not clear in time.");
    assert.equal(body.status, null);
    assert.equal(body.elapsedMs, 35000);
    assert.equal(body.strategy, "browser");
  });

  test("502 REDIRECT_BLOCKED when the page landed outside the allow-list, HTML discarded", async () => {
    h.setRender(async () => ({ ok: true, html: "<html>secret</html>", finalUrl: "https://evil.example/login", status: 200, elapsedMs: 5 }));
    const res = await h.render({ url: TARGET }, AUTH);
    assert.equal(res.status, 502);
    const body = await res.json();
    assert.equal(body.code, "REDIRECT_BLOCKED");
    assert.equal(body.html, undefined);
    assert.equal(body.status, 200);
  });

  test("a redirect that stays inside the allow-list is reported as the final URL", async () => {
    h.setRender(async () => ({ ok: true, html: "<html>ok</html>", finalUrl: "https://ajptour.com/events/4471/brackets/88?x=1#frag", status: 200, elapsedMs: 5 }));
    const body = await (await h.render({ url: TARGET }, AUTH)).json();
    assert.equal(body.ok, true);
    assert.equal(body.finalUrl, "https://ajptour.com/events/4471/brackets/88?x=1");
  });

  test("x-request-id is echoed when well-formed, minted otherwise", async () => {
    const echoed = await fetch(`${h.base}/health`, { headers: { "x-request-id": "req-123_abc" } });
    assert.equal(echoed.headers.get("x-request-id"), "req-123_abc");
    const minted = await fetch(`${h.base}/health`, { headers: { "x-request-id": "bad id!" } });
    assert.match(minted.headers.get("x-request-id"), /^[0-9a-f-]{36}$/);
    const none = await fetch(`${h.base}/health`);
    assert.match(none.headers.get("x-request-id"), /^[0-9a-f-]{36}$/);
  });

  test("unknown routes are 404 (authenticated) and GET /render is not a route", async () => {
    const res = await fetch(`${h.base}/nope`, { headers: AUTH });
    assert.equal(res.status, 404);
    assert.equal((await res.json()).code, "NOT_FOUND");
    assert.equal((await fetch(`${h.base}/render`, { headers: AUTH })).status, 404);
  });
});

describe("misconfigured worker", () => {
  const h = harness({ configErrors: ["WORKER_TOKEN must be set (16+ random characters)"], token: "" });
  before(() => h.start());
  after(() => h.stop());

  test("503 MISCONFIGURED on /render, with /health reporting ok:false", async () => {
    const res = await h.render({ url: TARGET }, AUTH);
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { ok: false, code: "MISCONFIGURED", message: "Worker is misconfigured; see /health with the worker token." });
    const health = await (await fetch(`${h.base}/health`)).json();
    assert.deepEqual(health, { ok: false, browserReady: true, mode: "new" });
    assert.equal(h.calls.length, 0);
  });

  test("an empty token never authorizes", async () => {
    const res = await fetch(`${h.base}/health`, { headers: { authorization: "Bearer " } });
    assert.deepEqual(await res.json(), { ok: false, browserReady: true, mode: "new" });
  });
});
