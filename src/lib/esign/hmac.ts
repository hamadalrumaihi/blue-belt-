import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * HMAC-SHA256 over the raw webhook body, compared in constant time. Both
 * DocuSign Connect (X-DocuSign-Signature-N, base64) and the mock provider
 * (X-Esign-Signature, hex or base64) use this shape.
 */
export function hmacSha256(secret: string, body: string, encoding: "base64" | "hex" = "base64"): string {
  return createHmac("sha256", secret).update(body, "utf8").digest(encoding);
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** True when `provided` equals the HMAC of `body` in either encoding. */
export function verifyHmacSignature(secret: string, body: string, provided: string | null | undefined): boolean {
  if (!secret || !provided) return false;
  const candidate = provided.trim();
  if (!candidate) return false;
  return safeEqual(candidate, hmacSha256(secret, body, "base64")) || safeEqual(candidate.toLowerCase(), hmacSha256(secret, body, "hex"));
}
