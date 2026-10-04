import { describe, expect, it } from "vitest";

import { buildEnvelope, checkCaptureTiming, hashContent, MAX_CAPTURE_AGE_MS, MAX_FUTURE_SKEW_MS, parseCaptureMeta, redactDiagnostics } from "@/lib/capture/envelope";

const NOW = new Date("2026-03-14T06:00:00.000Z");
const PAGE = "https://ajptour.com/en/event/1411/bracket/130617";

describe("hashContent", () => {
  it("is a stable sha256 of the page bytes", () => {
    expect(hashContent("<html>a</html>")).toMatch(/^[0-9a-f]{64}$/);
    expect(hashContent("<html>a</html>")).toBe(hashContent("<html>a</html>"));
    expect(hashContent("<html>a</html>")).not.toBe(hashContent("<html>b</html>"));
  });
});

describe("checkCaptureTiming", () => {
  it("accepts a capture taken a little before it was received", () => {
    expect(checkCaptureTiming({ capturedAt: "2026-03-14T05:58:00.000Z", receivedAt: NOW })).toEqual({ ok: true });
  });

  it("tolerates small clock skew into the future but rejects implausible timestamps", () => {
    const slightlyAhead = new Date(NOW.getTime() + MAX_FUTURE_SKEW_MS - 1000).toISOString();
    expect(checkCaptureTiming({ capturedAt: slightlyAhead, receivedAt: NOW })).toEqual({ ok: true });
    const farAhead = new Date(NOW.getTime() + MAX_FUTURE_SKEW_MS + 60_000).toISOString();
    expect(checkCaptureTiming({ capturedAt: farAhead, receivedAt: NOW })).toMatchObject({ ok: false, code: "CAPTURE_IN_FUTURE" });
  });

  it("rejects late-stale captures and unparseable timestamps", () => {
    const old = new Date(NOW.getTime() - MAX_CAPTURE_AGE_MS - 1).toISOString();
    expect(checkCaptureTiming({ capturedAt: old, receivedAt: NOW })).toMatchObject({ ok: false, code: "CAPTURE_TOO_OLD" });
    expect(checkCaptureTiming({ capturedAt: "yesterday", receivedAt: NOW })).toMatchObject({ ok: false, code: "CAPTURE_TIME_INVALID" });
  });
});

describe("parseCaptureMeta (optional client-supplied metadata)", () => {
  it("returns an empty object when nothing was supplied", () => {
    expect(parseCaptureMeta(undefined)).toEqual({ ok: true, meta: {} });
    expect(parseCaptureMeta(null)).toEqual({ ok: true, meta: {} });
  });

  it("accepts the documented fields and rejects anything else", () => {
    const ok = parseCaptureMeta({ captureId: "cap_01HXYZ-abc", capturedAt: "2026-03-14T05:58:00.000Z", finalUrl: PAGE, transport: "handoff", completeness: "partial" });
    expect(ok).toEqual({ ok: true, meta: { captureId: "cap_01HXYZ-abc", capturedAt: "2026-03-14T05:58:00.000Z", finalUrl: PAGE, transport: "handoff", completeness: "partial" } });
    expect(parseCaptureMeta({ captureId: "x".repeat(200) })).toMatchObject({ ok: false, code: "INVALID_CAPTURE" });
    expect(parseCaptureMeta({ captureId: "has spaces" })).toMatchObject({ ok: false, code: "INVALID_CAPTURE" });
    expect(parseCaptureMeta({ transport: "service-role" })).toMatchObject({ ok: false, code: "INVALID_CAPTURE" });
    expect(parseCaptureMeta({ completeness: "maybe" })).toMatchObject({ ok: false, code: "INVALID_CAPTURE" });
    expect(parseCaptureMeta({ ownerId: "someone-else" })).toMatchObject({ ok: false, code: "INVALID_CAPTURE" });
    expect(parseCaptureMeta("cap")).toMatchObject({ ok: false, code: "INVALID_CAPTURE" });
  });
});

describe("buildEnvelope", () => {
  it("fills defaults (fresh id, now, import transport, unknown completeness) and hashes the page", () => {
    const env = buildEnvelope({ sourceUrl: PAGE, html: "<html>x</html>", now: NOW, meta: {} });
    expect(env.captureId).toMatch(/^[0-9a-f-]{36}$/);
    expect(env).toMatchObject({ sourceUrl: PAGE, finalUrl: PAGE, transport: "import", completeness: "unknown", capturedAt: NOW.toISOString(), receivedAt: NOW.toISOString(), bytes: 14 });
    expect(env.contentHash).toBe(hashContent("<html>x</html>"));
  });

  it("keeps supplied metadata", () => {
    const env = buildEnvelope({ sourceUrl: PAGE, html: "<p>", now: NOW, meta: { captureId: "cap-1", capturedAt: "2026-03-14T05:59:00.000Z", finalUrl: `${PAGE}?tab=1`, transport: "agent", completeness: "complete" } });
    expect(env).toMatchObject({ captureId: "cap-1", capturedAt: "2026-03-14T05:59:00.000Z", finalUrl: `${PAGE}?tab=1`, transport: "agent", completeness: "complete" });
  });
});

describe("redactDiagnostics", () => {
  it("keeps only known scalar keys, truncates strings and drops anything that looks like markup or a secret", () => {
    const out = redactDiagnostics({
      strategy: "browser:table",
      sourceStatus: 200,
      finalUrl: PAGE,
      elapsedMs: 1234.6,
      attempts: 2,
      workerCode: "CHALLENGE_NOT_CLEARED:interactive",
      completeness: "partial",
      readiness: "SCHEDULE_FOUND",
      html: "<html>never</html>",
      cookie: "cf_clearance=abc",
      authorization: "Bearer x",
      note: "<b>markup</b>",
      long: "y".repeat(500),
      nested: { deep: true },
    });
    expect(out).toEqual({ strategy: "browser:table", sourceStatus: 200, finalUrl: PAGE, elapsedMs: 1235, attempts: 2, workerCode: "CHALLENGE_NOT_CLEARED:interactive", completeness: "partial", readiness: "SCHEDULE_FOUND" });
    expect(JSON.stringify(out)).not.toMatch(/<|cf_clearance|Bearer/);
  });

  it("returns an empty object for nothing", () => {
    expect(redactDiagnostics(undefined)).toEqual({});
    expect(redactDiagnostics(null)).toEqual({});
  });
});
