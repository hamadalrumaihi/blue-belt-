import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { backoffMs, classifyUpload, createSchedule, retryAfterMs } from "../src/schedule.mjs";

const job = (key) => ({ sourceKey: key, url: `https://ajptour.com/${key}`, clients: 1 });

describe("createSchedule", () => {
  test("new jobs are due at once, then only after the interval; missed intervals are not caught up", () => {
    const s = createSchedule(60_000);
    s.setJobs([job("a"), job("b")]);
    assert.deepEqual(s.due(1_000).map((j) => j.sourceKey), ["a", "b"]);
    s.markStarted("a", 1_000);
    assert.deepEqual(s.due(30_000).map((j) => j.sourceKey), ["b"]);
    s.markStarted("b", 30_000);
    assert.deepEqual(s.due(61_000).map((j) => j.sourceKey), ["a"]);
    // The laptop slept for an hour: "a" is due once, and after it runs it is not due again until +60s.
    s.markStarted("a", 3_661_000);
    assert.deepEqual(s.due(3_662_000).map((j) => j.sourceKey), ["b"]);
    assert.deepEqual(s.due(3_720_000).map((j) => j.sourceKey), ["b"]);
    assert.deepEqual(s.due(3_721_000).map((j) => j.sourceKey), ["b", "a"]);
  });

  test("setJobs keeps timing of known jobs and drops removed ones", () => {
    const s = createSchedule(60_000);
    s.setJobs([job("a"), job("b")]);
    s.markStarted("a", 10_000);
    s.setJobs([{ ...job("a"), clients: 3 }, job("c")]);
    assert.equal(s.size(), 2);
    assert.deepEqual(s.due(20_000).map((j) => j.sourceKey), ["c"]);
    assert.equal(s.snapshot().find((e) => e.sourceKey === "a").lastStartedAt, 10_000);
  });
});

describe("backoff and retry-after", () => {
  test("grows exponentially with jitter, is bounded, and honours a Retry-After floor", () => {
    const fixed = () => 1; // no jitter reduction
    assert.equal(backoffMs(1, { random: fixed }), 2_000);
    assert.equal(backoffMs(2, { random: fixed }), 4_000);
    assert.equal(backoffMs(20, { random: fixed }), 5 * 60_000);
    assert.ok(backoffMs(1, { random: () => 0 }) >= 1_000);
    assert.equal(backoffMs(1, { random: fixed, retryAfterMs: 90_000 }), 90_000);
  });

  test("retryAfterMs parses seconds and HTTP dates", () => {
    assert.equal(retryAfterMs("30"), 30_000);
    assert.equal(retryAfterMs(null), 0);
    const now = Date.parse("2026-03-14T06:00:00Z");
    assert.equal(retryAfterMs("Sat, 14 Mar 2026 06:01:00 GMT", now), 60_000);
    assert.equal(retryAfterMs("garbage", now), 0);
  });
});

describe("classifyUpload", () => {
  test("terminal verdicts free the spool; transient ones keep it; credential problems stop the agent", () => {
    assert.deepEqual(classifyUpload(200, { ok: true }), { kind: "applied" });
    assert.deepEqual(classifyUpload(409, { code: "STALE_CAPTURE" }), { kind: "refused", code: "STALE_CAPTURE" });
    assert.deepEqual(classifyUpload(404, { code: "NO_ATHLETES" }), { kind: "refused", code: "NO_ATHLETES" });
    assert.deepEqual(classifyUpload(403, { code: "OUT_OF_SCOPE" }), { kind: "refused", code: "OUT_OF_SCOPE" });
    assert.deepEqual(classifyUpload(422, { code: "CAPTURE_TIMING" }), { kind: "refused", code: "CAPTURE_TIMING" });
    assert.deepEqual(classifyUpload(429, { code: "RATE_LIMITED" }), { kind: "retry", code: "RATE_LIMITED" });
    assert.deepEqual(classifyUpload(503, null), { kind: "retry", code: "HTTP_503" });
    assert.deepEqual(classifyUpload(0, { code: "NETWORK" }), { kind: "retry", code: "NETWORK" });
    assert.deepEqual(classifyUpload(401, { code: "CREDENTIAL_EXPIRED" }), { kind: "stop", code: "CREDENTIAL_EXPIRED" });
    assert.deepEqual(classifyUpload(401, { code: "CREDENTIAL_REVOKED" }), { kind: "stop", code: "CREDENTIAL_REVOKED" });
    // A plain 401 (server misconfiguration, token typo) is retried, not fatal.
    assert.deepEqual(classifyUpload(401, { code: "UNAUTHORIZED" }), { kind: "retry", code: "UNAUTHORIZED" });
  });
});
