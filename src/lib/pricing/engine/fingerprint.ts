import { createHash } from "node:crypto";
import { PUBLIC_REQUEST_KEYS } from "./extract";
import type { PricingRequest } from "./types";

/**
 * Stable fingerprint of the public-scope inputs of a request. Two
 * submissions that describe the same job hash the same, whatever order the
 * keys arrive in; assumptions and missing-input lists are derived and left
 * out. Used to dedupe queued assessments per booking.
 */
export function requestFingerprint(req: PricingRequest): string {
  const canonical: Record<string, unknown> = {};
  for (const key of [...PUBLIC_REQUEST_KEYS].sort()) {
    const v = req[key];
    canonical[key] = Array.isArray(v) ? [...v].sort() : v ?? null;
  }
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex").slice(0, 32);
}
