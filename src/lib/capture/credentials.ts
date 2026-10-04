import { createHash, randomBytes } from "node:crypto";

/**
 * Capture credentials: revocable, expiring, owner-scoped bearer tokens for
 * machine intake (`POST /api/capture`). The Windows agent holds one of these
 * — never the Supabase service-role key. Only the sha256 of a token is
 * stored; the token itself is shown to the owner once, at creation.
 *
 * Token shape: `bbmc_<8 chars prefix>_<40 chars secret>`; the prefix is kept
 * in clear for display ("bbmc_a1b2c3d4…") and lookup is by hash.
 */

export const TOKEN_PREFIX = "bbmc";
/** Orders intake credentials (Zapier → Pic-Time orders) carry a different prefix so a mix-up is visible. */
export const ORDERS_TOKEN_PREFIX = "bbmo";
export type CredentialKind = "capture" | "orders";
const TOKEN_RE = /^bbm[co]_[A-Za-z0-9]{8}_[A-Za-z0-9]{40}$/;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

export type CredentialStateInput = { expires_at: string; revoked_at: string | null; scope_source_keys: string[] | null };
export type CredentialState = "active" | "expired" | "revoked";

function randomString(length: number): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i += 1) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

export function generateCaptureToken(kind: CredentialKind = "capture"): { token: string; prefix: string; hash: string } {
  const prefix = `${kind === "orders" ? ORDERS_TOKEN_PREFIX : TOKEN_PREFIX}_${randomString(8)}`;
  const token = `${prefix}_${randomString(40)}`;
  return { token, prefix, hash: hashCaptureToken(token) };
}

/** The kind a token's prefix claims (the stored row's kind is what is enforced). */
export function tokenKind(token: string): CredentialKind {
  return token.startsWith(`${ORDERS_TOKEN_PREFIX}_`) ? "orders" : "capture";
}

export function hashCaptureToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** The capture token from an Authorization header, or null when it is not one of ours. */
export function parseCaptureBearer(header: string | null | undefined): string | null {
  if (!header || !header.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  return TOKEN_RE.test(token) ? token : null;
}

export function credentialState(row: CredentialStateInput, now: Date): CredentialState {
  if (row.revoked_at) return "revoked";
  if (new Date(row.expires_at).getTime() <= now.getTime()) return "expired";
  return "active";
}

/** No scope list = any source of this owner; a list = only those source identities. */
export function inCredentialScope(row: Pick<CredentialStateInput, "scope_source_keys">, sourceKey: string): boolean {
  if (row.scope_source_keys === null) return true;
  return row.scope_source_keys.includes(sourceKey);
}
