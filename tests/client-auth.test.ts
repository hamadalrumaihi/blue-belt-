import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const signInWithOtp = vi.fn();
const signOut = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({ auth: { signInWithOtp, signOut } })) }));
let forwardedFor = "203.0.113.9";
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers({ "x-forwarded-for": `${forwardedFor}, 10.0.0.1`, host: "studio.example.com", "x-forwarded-proto": "https" })) }));
vi.mock("next/navigation", () => ({ redirect: vi.fn((to: string) => { throw new Error(`NEXT_REDIRECT:${to}`); }) }));

import { requestClientMagicLink, signOutClient } from "@/lib/actions/client-auth";
import { resetRateLimits, RULES } from "@/lib/rate-limit";

function fd(email: string | null) {
  const f = new FormData();
  if (email !== null) f.set("email", email);
  return f;
}

beforeEach(() => {
  resetRateLimits();
  forwardedFor = "203.0.113.9";
  signInWithOtp.mockReset();
  signInWithOtp.mockResolvedValue({ data: {}, error: null });
  delete process.env.NEXT_PUBLIC_SITE_URL;
});

describe("requestClientMagicLink", () => {
  it("answers the same way for a known and an unknown address, and never leaks the provider error", async () => {
    const known = await requestClientMagicLink(null, fd("Client@Example.com"));
    signInWithOtp.mockResolvedValueOnce({ data: {}, error: { message: "Signups not allowed for this instance" } });
    const unknown = await requestClientMagicLink(null, fd("nobody@example.com"));
    expect(known).toEqual({ sent: true });
    expect(unknown).toEqual(known);
    expect(signInWithOtp).toHaveBeenCalledTimes(2);
    expect(signInWithOtp.mock.calls[0][0]).toEqual({ email: "client@example.com", options: { emailRedirectTo: "https://www.bluebeltmedia.com/auth/callback?next=/client", shouldCreateUser: true } });
  });

  it("uses NEXT_PUBLIC_SITE_URL for the redirect when it is set, without a double slash", async () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://bluebeltmedia.qa/";
    await requestClientMagicLink(null, fd("a@b.co"));
    expect(signInWithOtp.mock.calls[0][0].options.emailRedirectTo).toBe("https://bluebeltmedia.qa/auth/callback?next=/client");
  });

  it("never builds the link from the request Host header (a preview or retired deployment host would give a dead link)", async () => {
    await requestClientMagicLink(null, fd("a@b.co"));
    const to = signInWithOtp.mock.calls[0][0].options.emailRedirectTo as string;
    expect(to).not.toContain("studio.example.com");
    expect(to).not.toContain("vercel.app");
    expect(to.startsWith("https://www.bluebeltmedia.com/auth/callback")).toBe(true);
  });

  it("rejects a missing or malformed address without calling the provider", async () => {
    expect(await requestClientMagicLink(null, fd(null))).toEqual({ fieldErrors: { email: expect.stringMatching(/e-mail/i) } });
    expect(await requestClientMagicLink(null, fd("not an email"))).toMatchObject({ fieldErrors: { email: expect.any(String) } });
    expect(signInWithOtp).not.toHaveBeenCalled();
  });

  it("rate limits per client address", async () => {
    for (let i = 0; i < RULES.clientLoginPerIp.max; i += 1) expect(await requestClientMagicLink(null, fd(`u${i}@example.com`))).toEqual({ sent: true });
    const blocked = await requestClientMagicLink(null, fd("late@example.com"));
    expect(blocked).toMatchObject({ error: expect.stringMatching(/too many/i) });
    expect(signInWithOtp).toHaveBeenCalledTimes(RULES.clientLoginPerIp.max);
    forwardedFor = "198.51.100.7";
    expect(await requestClientMagicLink(null, fd("other@example.com"))).toEqual({ sent: true });
  });
});

describe("signOutClient", () => {
  it("signs out and redirects to the portal login", async () => {
    signOut.mockResolvedValue({ error: null });
    await expect(signOutClient()).rejects.toThrow("NEXT_REDIRECT:/client/login");
    expect(signOut).toHaveBeenCalledTimes(1);
  });
});
