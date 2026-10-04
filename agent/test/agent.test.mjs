import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { runAgent } from "../src/main.mjs";
import { createSpool } from "../src/spool.mjs";
import { createUploader } from "../src/uploader.mjs";

const dir = mkdtempSync(path.join(tmpdir(), "bbm-agent-"));
after(() => rmSync(dir, { recursive: true, force: true }));

const TOKEN = "bbmc_abcdefgh_" + "x".repeat(40);
const PAGE = "https://ajptour.com/en/event/1411/bracket/130617";
const JOB = { sourceKey: "ajptour.com|/event/1411/bracket/130617", url: PAGE, eventId: "e", eventName: "Qatar Open", clients: 2 };

function config(overrides = {}) {
  return { appUrl: "https://app.test", token: TOKEN, version: "test", intervalSeconds: 60, jobsRefreshSeconds: 300, heartbeatSeconds: 60, readyWaitMs: 1, navTimeoutMs: 1, maxHtmlBytes: 1_000_000, maxSpoolFiles: 50, once: true, headless: true, browserChannel: "chromium", ...overrides };
}

/** Fake app: records requests, scripted responses per path. */
function fakeApp(script = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const u = new URL(url);
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ path: u.pathname, auth: init.headers.authorization, body });
    const handler = script[u.pathname] ?? (() => ({ status: 200, body: { ok: true } }));
    const r = await handler(body, calls.filter((c) => c.path === u.pathname).length);
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status, headers: { "content-type": "application/json", ...(r.headers ?? {}) } });
  };
  return { calls, fetchImpl };
}

function fakeSession(results) {
  const captures = [];
  let i = 0;
  return {
    captures,
    async capture(job) {
      captures.push(job.sourceKey);
      const r = results[Math.min(i, results.length - 1)];
      i += 1;
      return typeof r === "function" ? r(job) : r;
    },
    async challengeCleared() {
      return true;
    },
    async bringToFront() {},
    async close() {},
    isOpen: () => true,
  };
}

const OK_PAGE = { ok: true, html: "<html><body><table><tr><td>Mat 1</td></tr></table></body></html>", finalUrl: PAGE, status: 200, readiness: "SCHEDULE_FOUND", completeness: "unknown" };

describe("runAgent (one tick)", () => {
  test("loads jobs, captures each due source, spools before upload, deletes on ack and heartbeats", async () => {
    const app = fakeApp({
      "/api/capture/jobs": () => ({ status: 200, body: { jobs: [JOB], intervalSeconds: 60 } }),
      "/api/capture": (body) => ({ status: 200, body: { ok: true, matched: 2, capture: { captureId: body.capture.captureId, replayed: false } } }),
    });
    const spool = createSpool(path.join(dir, "ok"));
    const uploader = createUploader({ appUrl: "https://app.test", token: TOKEN, version: "test", fetchImpl: app.fetchImpl, log: { warn() {}, info() {} } });
    const session = fakeSession([OK_PAGE]);
    const result = await runAgent(config(), { uploader, spool, session, sleep: async () => {} });

    assert.deepEqual(session.captures, [JOB.sourceKey]);
    const upload = app.calls.find((c) => c.path === "/api/capture");
    assert.equal(upload.auth, `Bearer ${TOKEN}`);
    assert.equal(upload.body.url, PAGE);
    assert.equal(upload.body.capture.finalUrl, PAGE);
    assert.match(upload.body.capture.captureId, /^[0-9a-f-]{36}$/);
    assert.ok(Date.parse(upload.body.capture.capturedAt));
    assert.equal("ownerId" in upload.body, false);
    assert.equal(spool.count(), 0); // acknowledged → deleted
    assert.equal(result.captures, 1);
    const hb = app.calls.filter((c) => c.path === "/api/capture/heartbeat");
    assert.ok(hb.length >= 1);
    assert.equal(hb.at(-1).body.status.spooled, 0);
    assert.equal(hb.at(-1).body.status.state, "stopped");
    assert.equal("html" in hb.at(-1).body.status, false);
  });

  test("keeps the capture spooled on a 5xx / network failure and replays it (same capture id) on the next start", async () => {
    let fail = true;
    const app = fakeApp({
      "/api/capture/jobs": () => ({ status: 200, body: { jobs: [JOB], intervalSeconds: 60 } }),
      "/api/capture": () => (fail ? { status: 503, body: { code: "UPSTREAM" }, headers: { "retry-after": "1" } } : { status: 200, body: { ok: true, matched: 1, capture: { replayed: true } } }),
    });
    const spool = createSpool(path.join(dir, "retry"));
    const uploader = createUploader({ appUrl: "https://app.test", token: TOKEN, version: "test", fetchImpl: app.fetchImpl, log: { warn() {}, info() {} } });
    const first = await runAgent(config(), { uploader, spool, session: fakeSession([OK_PAGE]), sleep: async () => {} });
    assert.equal(first.spooled, 1);
    const queued = spool.list()[0];
    assert.equal(queued.attempts, 1);
    assert.equal(queued.lastError, "UPSTREAM");

    fail = false;
    const second = await runAgent(config(), { uploader, spool, session: fakeSession([OK_PAGE]), sleep: async () => {} });
    const uploads = app.calls.filter((c) => c.path === "/api/capture");
    assert.equal(uploads[1].body.capture.captureId, queued.captureId); // replayed with the SAME id
    assert.equal(spool.count(), 0);
    assert.equal(second.stopReason, null);
  });

  test("a refused capture (stale / out of scope) is dropped from the spool, not retried forever", async () => {
    const app = fakeApp({
      "/api/capture/jobs": () => ({ status: 200, body: { jobs: [JOB], intervalSeconds: 60 } }),
      "/api/capture": () => ({ status: 409, body: { code: "STALE_CAPTURE" } }),
    });
    const spool = createSpool(path.join(dir, "refused"));
    const uploader = createUploader({ appUrl: "https://app.test", token: TOKEN, version: "test", fetchImpl: app.fetchImpl, log: { warn() {}, info() {} } });
    await runAgent(config(), { uploader, spool, session: fakeSession([OK_PAGE]), sleep: async () => {} });
    assert.equal(spool.count(), 0);
    assert.equal(app.calls.filter((c) => c.path === "/api/capture").length, 1);
  });

  test("a human check pauses capturing (nothing uploaded) and the heartbeat says so", async () => {
    const app = fakeApp({ "/api/capture/jobs": () => ({ status: 200, body: { jobs: [JOB, { ...JOB, sourceKey: "other", url: `${PAGE}?category=2` }], intervalSeconds: 60 } }) });
    const spool = createSpool(path.join(dir, "paused"));
    const uploader = createUploader({ appUrl: "https://app.test", token: TOKEN, version: "test", fetchImpl: app.fetchImpl, log: { warn() {}, info() {} } });
    const session = fakeSession([{ ok: false, code: "CHALLENGE", readiness: "CHALLENGE" }]);
    session.challengeCleared = async () => false;
    const result = await runAgent(config(), { uploader, spool, session, sleep: async () => {} });
    assert.deepEqual(session.captures, [JOB.sourceKey]); // the second job waits
    assert.equal(app.calls.filter((c) => c.path === "/api/capture").length, 0);
    assert.equal(result.pausedReason, "human check");
    const hb = app.calls.filter((c) => c.path === "/api/capture/heartbeat").at(-1);
    assert.equal(hb.body.status.state, "paused");
    assert.equal(hb.body.status.pausedReason, "human check");
  });

  test("an expired credential stops the agent and keeps the spool", async () => {
    const app = fakeApp({
      "/api/capture/jobs": () => ({ status: 200, body: { jobs: [JOB], intervalSeconds: 60 } }),
      "/api/capture": () => ({ status: 401, body: { code: "CREDENTIAL_EXPIRED" } }),
    });
    const spool = createSpool(path.join(dir, "expired"));
    const uploader = createUploader({ appUrl: "https://app.test", token: TOKEN, version: "test", fetchImpl: app.fetchImpl, log: { warn() {}, info() {} } });
    const result = await runAgent(config({ once: false }), { uploader, spool, session: fakeSession([OK_PAGE]), sleep: async () => {} });
    assert.equal(result.stopReason, "CREDENTIAL_EXPIRED");
    assert.equal(spool.count(), 1);
  });

  test("a page that is not ready is logged and skipped without an upload", async () => {
    const app = fakeApp({ "/api/capture/jobs": () => ({ status: 200, body: { jobs: [JOB], intervalSeconds: 60 } }) });
    const spool = createSpool(path.join(dir, "notready"));
    const uploader = createUploader({ appUrl: "https://app.test", token: TOKEN, version: "test", fetchImpl: app.fetchImpl, log: { warn() {}, info() {} } });
    const result = await runAgent(config(), { uploader, spool, session: fakeSession([{ ok: false, code: "PAGE_NOT_READY", readiness: "LOGIN_PAGE" }]), sleep: async () => {} });
    assert.equal(app.calls.filter((c) => c.path === "/api/capture").length, 0);
    assert.equal(result.failures, 1);
    assert.equal(spool.count(), 0);
  });
});
