import { describe, expect, it } from "vitest";

import { credentialState, generateCaptureToken, hashCaptureToken, inCredentialScope, parseCaptureBearer, TOKEN_PREFIX } from "@/lib/capture/credentials";

const NOW = new Date("2026-03-14T06:00:00.000Z");

function row(overrides: Partial<Parameters<typeof credentialState>[0]> = {}) {
  return { expires_at: "2026-03-15T06:00:00.000Z", revoked_at: null, scope_source_keys: null, ...overrides };
}

describe("capture tokens", () => {
  it("generates a prefixed random token whose hash (not the token) is what gets stored", () => {
    const t = generateCaptureToken();
    expect(t.token.startsWith(`${TOKEN_PREFIX}_`)).toBe(true);
    expect(t.token.length).toBeGreaterThanOrEqual(50);
    expect(t.prefix).toBe(t.token.slice(0, TOKEN_PREFIX.length + 1 + 8));
    expect(t.hash).toBe(hashCaptureToken(t.token));
    expect(t.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(t.hash).not.toContain(t.token);
    expect(generateCaptureToken().token).not.toBe(t.token);
  });

  it("parses only well-formed bearer headers", () => {
    const { token } = generateCaptureToken();
    expect(parseCaptureBearer(`Bearer ${token}`)).toBe(token);
    expect(parseCaptureBearer(`Bearer  ${token} `)).toBe(token);
    expect(parseCaptureBearer(null)).toBeNull();
    expect(parseCaptureBearer("Bearer nope")).toBeNull();
    expect(parseCaptureBearer("Bearer eyJhbGciOi.service.role")).toBeNull();
    expect(parseCaptureBearer(token)).toBeNull();
  });
});

describe("credentialState", () => {
  it("is active until expiry or revocation", () => {
    expect(credentialState(row(), NOW)).toBe("active");
    expect(credentialState(row({ expires_at: "2026-03-14T05:59:59.000Z" }), NOW)).toBe("expired");
    expect(credentialState(row({ revoked_at: "2026-03-14T01:00:00.000Z" }), NOW)).toBe("revoked");
    // Revoked wins over expired so the owner's action is what is reported.
    expect(credentialState(row({ revoked_at: "2026-03-13T00:00:00.000Z", expires_at: "2026-03-13T00:00:00.000Z" }), NOW)).toBe("revoked");
  });
});

describe("inCredentialScope", () => {
  it("allows any of the owner's sources when no scope is set, else only the listed source keys", () => {
    expect(inCredentialScope(row(), "ajptour.com|/event/1/bracket/2")).toBe(true);
    const scoped = row({ scope_source_keys: ["ajptour.com|/event/1/bracket/2", "smoothcomp.com|/event/9/schedule|category=3"] });
    expect(inCredentialScope(scoped, "ajptour.com|/event/1/bracket/2")).toBe(true);
    expect(inCredentialScope(scoped, "ajptour.com|/event/1/bracket/3")).toBe(false);
    expect(inCredentialScope(row({ scope_source_keys: [] }), "ajptour.com|/event/1/bracket/2")).toBe(false);
  });
});
