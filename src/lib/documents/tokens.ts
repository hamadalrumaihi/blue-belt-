import { createHash, randomBytes } from "node:crypto";

/**
 * Signing links: `/sign/<token>` where the token is `bbs_` + 40 random
 * base62 characters (~238 bits). Only the sha256 of the token is stored on
 * photo_documents.access_token_hash; the token itself is shown to the owner
 * once (and sent to the client), exactly like capture credentials.
 */

export const SIGNING_TOKEN_PREFIX = "bbs";
const TOKEN_RE = /^bbs_[A-Za-z0-9]{40}$/;
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

export function createSigningToken(): { token: string; hash: string } {
  const token = `${SIGNING_TOKEN_PREFIX}_${randomBase62(40)}`;
  return { token, hash: hashSigningToken(token) };
}

export function hashSigningToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** True when a string looks like one of our signing tokens (cheap check before hashing). */
export function isSigningTokenShape(value: unknown): value is string {
  return typeof value === "string" && TOKEN_RE.test(value);
}
