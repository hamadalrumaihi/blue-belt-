import { createHash, randomBytes } from "node:crypto";

/**
 * Website pay links: `/pay/<token>` where the token is `bbp_` + 40 random
 * base62 characters, exactly like the document signing tokens. The booking
 * keeps the sha256 of the token in `metadata.pay_token_hash` (the lookup key)
 * and the creation time in `metadata.pay_token_created_at`; a link older than
 * PAY_TOKEN_TTL_MS is refused and the owner creates a fresh one. Pure module:
 * no I/O, safe for tests and server components alike.
 */

export const PAY_TOKEN_PREFIX = "bbp";
export const PAY_TOKEN_TTL_MS = 30 * 24 * 60 * 60_000;
const TOKEN_RE = /^bbp_[A-Za-z0-9]{40}$/;
const PAY_PATH_RE = /^\/pay\/bbp_[A-Za-z0-9]{40}$/;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

function randomBase62(length: number): string {
  // Rejection sampling keeps the distribution uniform (256 % 62 !== 0).
  let out = "";
  while (out.length < length) {
    const bytes = randomBytes(length * 2);
    for (let i = 0; i < bytes.length && out.length < length; i += 1) {
      const b = bytes[i];
      if (b < 248) out += ALPHABET[b % 62];
    }
  }
  return out;
}

export function createPayToken(): { token: string; hash: string } {
  const token = `${PAY_TOKEN_PREFIX}_${randomBase62(40)}`;
  return { token, hash: hashPayToken(token) };
}

export function hashPayToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Cheap shape check before hashing (and before any rate-limited lookup). */
export function isPayTokenShape(value: unknown): value is string {
  return typeof value === "string" && TOKEN_RE.test(value);
}

/** True once the link is older than the TTL. A missing creation time counts as expired. */
export function isPayTokenExpired(createdAt: string | null | undefined, now: Date, ttlMs = PAY_TOKEN_TTL_MS): boolean {
  if (!createdAt) return true;
  const t = new Date(createdAt).getTime();
  if (Number.isNaN(t)) return true;
  return now.getTime() - t > ttlMs;
}

/** The pay page URL for a token on the public site. */
export function payPageUrl(siteUrl: string, token: string): string {
  return `${siteUrl.replace(/\/+$/, "")}/pay/${token}`;
}

/**
 * True when `payment_url` points at OUR pay page (not the provider's hosted
 * invoice). The client portal only ever links to our page; a raw provider
 * URL is never shown to a client.
 */
export function isWebsitePayUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    return (u.protocol === "https:" || u.protocol === "http:") && PAY_PATH_RE.test(u.pathname);
  } catch {
    return false;
  }
}

/** Token-related fields kept in photo_bookings.metadata. */
export type PayTokenMetadata = { pay_token_hash?: string; pay_token_created_at?: string };

export function payTokenMetadata(metadata: unknown): PayTokenMetadata {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return {};
  const m = metadata as Record<string, unknown>;
  return {
    pay_token_hash: typeof m.pay_token_hash === "string" ? m.pay_token_hash : undefined,
    pay_token_created_at: typeof m.pay_token_created_at === "string" ? m.pay_token_created_at : undefined,
  };
}
