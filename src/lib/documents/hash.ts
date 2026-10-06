import { createHash } from "node:crypto";

/** Line endings and trailing whitespace are normalised so a copy/paste round trip does not change the hash. */
export function normalizeBody(body: string): string {
  return body.replace(/\r\n?/g, "\n").trimEnd();
}

/**
 * sha256 (hex) of the normalised body. Stored on photo_documents.body_hash
 * when a document is created, re-checked just before a signature is
 * recorded, embedded in the signature evidence and printed on the PDF
 * footer, so a signed body can always be proven unchanged.
 */
export function bodyHash(body: string): string {
  return createHash("sha256").update(normalizeBody(body), "utf8").digest("hex");
}

export function shortHash(hash: string | null | undefined): string {
  return hash ? hash.slice(0, 12) : "—";
}
