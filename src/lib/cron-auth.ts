import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Constant-time check of `Authorization: Bearer <CRON_SECRET>` for the cron
 * endpoints (refresh, deliveries, payments). Both the presented token and the
 * secret are hashed to a fixed 32-byte digest before comparison, so neither the
 * comparison time nor an early length check reveals anything about the secret.
 * Fail-closed: returns false when CRON_SECRET is unset.
 *
 * One shared helper so a future change to cron auth lands in every route at once.
 */
export function verifyCronSecret(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const a = createHash("sha256").update(token, "utf8").digest();
  const b = createHash("sha256").update(secret, "utf8").digest();
  return timingSafeEqual(a, b);
}
