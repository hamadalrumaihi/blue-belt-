import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultNextFor, loginPathFor, planCallback, safeNext } from "@/lib/auth/callback";

vi.mock("server-only", () => ({}));
const verifyOtp = vi.fn();
const exchangeCodeForSession = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({ auth: { verifyOtp, exchangeCodeForSession } })) }));
vi.mock("@/lib/log", () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }));

import { GET } from "@/app/auth/callback/route";

const ORIGIN = "https://www.bluebeltmedia.com";
const HASH = "9f2c1a0b8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e";

function get(query: string) {
  return GET(new Request(`${ORIGIN}/auth/callback${query}`));
}

beforeEach(() => {
  verifyOtp.mockReset().mockResolvedValue({ data: {}, error: null });
  exchangeCodeForSession.mockReset().mockResolvedValue({ data: {}, error: null });
});

describe("planCallback (pure)", () => {
  it("defaults the landing page by link type", () => {
    expect(defaultNextFor("magiclink")).toBe("/client");
    expect(defaultNextFor("signup")).toBe("/client");
    expect(defaultNextFor("recovery")).toBe("/reset-password");
    expect(defaultNextFor("invite")).toBe("/reset-password");
    expect(defaultNextFor(null)).toBe("/dashboard");
  });

  it("only follows same-site relative paths", () => {
    expect(safeNext("/client", "/x")).toBe("/client");
    expect(safeNext("/client/bookings/abc", "/x")).toBe("/client/bookings/abc");
    expect(safeNext("https://evil.example/", "/x")).toBe("/x");
    expect(safeNext("//evil.example", "/x")).toBe("/x");
    expect(safeNext("/\\evil.example", "/x")).toBe("/x");
    expect(safeNext(null, "/x")).toBe("/x");
  });

  it("sends a failed client link back to the client sign-in, and a failed staff link to the studio sign-in", () => {
    expect(loginPathFor("/client", "magiclink")).toBe("/client/login?error=link");
    expect(loginPathFor("/dashboard", "magiclink")).toBe("/client/login?error=link");
    expect(loginPathFor("/client/bookings/1", null)).toBe("/client/login?error=link");
    expect(loginPathFor("/reset-password", "recovery")).toBe("/login?error=link");
    expect(loginPathFor("/dashboard", null)).toBe("/login?error=link");
  });

  it("prefers the token hash over a code and rejects unknown types", () => {
    expect(planCallback({ tokenHash: HASH, type: "magiclink", code: "c", next: "/client" })).toMatchObject({ kind: "token_hash", type: "magiclink", next: "/client" });
    expect(planCallback({ tokenHash: HASH, type: "bogus", code: null, next: null })).toMatchObject({ kind: "invalid", onError: "/login?error=link" });
    expect(planCallback({ tokenHash: null, type: null, code: "c", next: "/client" })).toMatchObject({ kind: "code", next: "/client", onError: "/client/login?error=link" });
    expect(planCallback({ tokenHash: null, type: null, code: null, next: null })).toEqual({ kind: "invalid", onError: "/login?error=link" });
  });
});

describe("GET /auth/callback", () => {
  it("verifies a token hash from the e-mail and lands on the client portal, without needing the requesting browser's cookies", async () => {
    const res = await get(`?token_hash=${HASH}&type=magiclink&next=/client`);
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(`${ORIGIN}/client`);
    expect(verifyOtp).toHaveBeenCalledWith({ type: "magiclink", token_hash: HASH });
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("treats a first sign-up confirmation the same way", async () => {
    const res = await get(`?token_hash=${HASH}&type=signup`);
    expect(res.headers.get("location")).toBe(`${ORIGIN}/client`);
    expect(verifyOtp).toHaveBeenCalledWith({ type: "signup", token_hash: HASH });
  });

  it("still exchanges a PKCE code from the same browser", async () => {
    const res = await get("?code=abc123&next=/client");
    expect(res.headers.get("location")).toBe(`${ORIGIN}/client`);
    expect(exchangeCodeForSession).toHaveBeenCalledWith("abc123");
  });

  it("returns an expired or used client link to the client sign-in with a message, never to the staff login", async () => {
    verifyOtp.mockResolvedValueOnce({ data: {}, error: { message: "Token has expired or is invalid", code: "otp_expired", status: 403 } });
    const res = await get(`?token_hash=${HASH}&type=magiclink&next=/client`);
    expect(res.headers.get("location")).toBe(`${ORIGIN}/client/login?error=link`);
  });

  it("returns a failed PKCE exchange on a client link to the client sign-in", async () => {
    exchangeCodeForSession.mockResolvedValueOnce({ data: {}, error: { message: "invalid request: both auth code and code verifier should be non-empty", status: 400 } });
    const res = await get("?code=abc123&next=/client");
    expect(res.headers.get("location")).toBe(`${ORIGIN}/client/login?error=link`);
  });

  it("returns a failed password-reset link to the studio sign-in", async () => {
    exchangeCodeForSession.mockResolvedValueOnce({ data: {}, error: { message: "bad", status: 400 } });
    const res = await get("?code=abc123&next=/reset-password");
    expect(res.headers.get("location")).toBe(`${ORIGIN}/login?error=link`);
  });

  it("never follows an off-site next and never calls Supabase without a token or code", async () => {
    const res = await get(`?token_hash=${HASH}&type=magiclink&next=https://evil.example/`);
    expect(res.headers.get("location")).toBe(`${ORIGIN}/client`);
    const bare = await get("?next=/client");
    expect(bare.headers.get("location")).toBe(`${ORIGIN}/client/login?error=link`);
    expect(verifyOtp).toHaveBeenCalledTimes(1);
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
  });
});
