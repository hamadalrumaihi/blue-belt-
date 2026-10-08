import type { EmailOtpType } from "@supabase/supabase-js";

/**
 * Pure helpers for the `/auth/callback` route, shared with tests.
 *
 * Two ways a link can arrive:
 *  - `token_hash` + `type`: the e-mail template carries the hashed one-time
 *    token. Verifying it on the server needs nothing from the browser that
 *    requested the link, so it works when the customer opens the e-mail in
 *    Gmail's in-app browser or on another device.
 *  - `code`: the PKCE flow. It only works in the browser that holds the
 *    code verifier cookie, so it stays as a fallback for same-browser links.
 */
export const EMAIL_OTP_TYPES = ["signup", "invite", "magiclink", "recovery", "email_change", "email"] as const satisfies readonly EmailOtpType[];

export function isEmailOtpType(v: string | null): v is EmailOtpType {
  return v !== null && (EMAIL_OTP_TYPES as readonly string[]).includes(v);
}

/** Link types that belong to the client portal (magic link sign-in or first confirmation). */
const CLIENT_TYPES: ReadonlySet<string> = new Set(["magiclink", "signup", "email"]);

/** Where a link type lands when the e-mail template did not say. */
export function defaultNextFor(type: EmailOtpType | null): string {
  if (type === "recovery" || type === "invite") return "/reset-password";
  if (type && CLIENT_TYPES.has(type)) return "/client";
  return "/dashboard";
}

/** Same-site relative paths only: never an absolute URL, a protocol-relative one or a backslash trick. */
export function safeNext(raw: string | null, fallback: string): string {
  if (!raw) return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\") || /[\u0000-\u001f]/.test(raw)) return fallback;
  return raw;
}

/** The sign-in page a failed link should return to, with a message and a way to ask for a new link. */
export function loginPathFor(next: string, type: EmailOtpType | null): string {
  const client = next === "/client" || next.startsWith("/client/") || (type !== null && CLIENT_TYPES.has(type));
  return client ? "/client/login?error=link" : "/login?error=link";
}

export type CallbackInput = { tokenHash: string | null; type: string | null; code: string | null; next: string | null };

export type CallbackPlan =
  | { kind: "token_hash"; type: EmailOtpType; tokenHash: string; next: string; onError: string }
  | { kind: "code"; code: string; next: string; onError: string }
  | { kind: "invalid"; onError: string };

/** Decides how to handle one callback request. Pure, so every branch is unit-tested. */
export function planCallback(input: CallbackInput): CallbackPlan {
  const type = isEmailOtpType(input.type) ? input.type : null;
  const next = safeNext(input.next, defaultNextFor(type));
  const onError = loginPathFor(next, type);
  if (input.tokenHash && type) return { kind: "token_hash", type, tokenHash: input.tokenHash, next, onError };
  if (input.code) return { kind: "code", code: input.code, next, onError };
  return { kind: "invalid", onError };
}
