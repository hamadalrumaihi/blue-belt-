import { describe, expect, it } from "vitest";
import { createSigningToken, hashSigningToken, isSigningTokenShape } from "@/lib/documents/tokens";

describe("signing tokens", () => {
  it("mints bbs_ + 40 base62 characters and returns the sha256 that is stored", () => {
    const t = createSigningToken();
    expect(t.token).toMatch(/^bbs_[A-Za-z0-9]{40}$/);
    expect(t.hash).toBe(hashSigningToken(t.token));
    expect(t.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(t.hash).not.toContain(t.token.slice(4));
  });

  it("never repeats", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i += 1) seen.add(createSigningToken().token);
    expect(seen.size).toBe(200);
  });

  it("recognises only well-formed tokens", () => {
    expect(isSigningTokenShape(createSigningToken().token)).toBe(true);
    expect(isSigningTokenShape("bbs_short")).toBe(false);
    expect(isSigningTokenShape(`bbmc_${"a".repeat(8)}_${"b".repeat(40)}`)).toBe(false);
    expect(isSigningTokenShape(`bbs_${"a".repeat(40)}x`)).toBe(false);
    expect(isSigningTokenShape(`bbs_${"a".repeat(39)}-`)).toBe(false);
    expect(isSigningTokenShape(null)).toBe(false);
    expect(isSigningTokenShape(42)).toBe(false);
  });
});
