"use server";

import { headers } from "next/headers";
import { declineDocument, signDocument, type SignError } from "@/lib/documents/sign-service";
import { isSigningTokenShape } from "@/lib/documents/tokens";
import { rateLimit, RULES } from "@/lib/rate-limit";
import { trimOrNull } from "@/lib/utils";

/**
 * Form actions behind the public signing page. The token travels in a
 * hidden field; the client's address and user agent are read from the
 * request (never from the form) and stored as signature evidence.
 */
export type SignState = { error?: string; fieldErrors?: Record<string, string>; signed?: { documentId: string; signedAt: string }; declined?: boolean } | null;

const ERROR_TEXT: Record<SignError, string> = {
  not_found: "This signing link is not valid.",
  expired: "This signing link has expired. Ask the studio to send a new one.",
  already_signed: "This agreement has already been signed.",
  declined: "This agreement was declined and can no longer be signed.",
  invalid_name: "Type your full legal name (at least 3 letters).",
  invalid_email: "Enter a valid e-mail address, or leave it empty.",
  not_agreed: "Tick the box to confirm you have read the agreement.",
  hash_mismatch: "This document changed after it was sent. Ask the studio to send it again.",
  conflict: "Something went wrong while saving. Please try again.",
};

async function clientAddress(): Promise<{ ip: string | null; userAgent: string | null }> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  const ip = (forwarded ? forwarded.split(",")[0] : h.get("x-real-ip"))?.trim() || null;
  return { ip, userAgent: h.get("user-agent") };
}

export async function signByToken(_prev: SignState, formData: FormData): Promise<SignState> {
  const token = trimOrNull(formData.get("token"));
  if (!isSigningTokenShape(token)) return { error: ERROR_TEXT.not_found };
  const { ip, userAgent } = await clientAddress();
  const limit = rateLimit(`sign:${ip ?? "unknown"}`, RULES.signPerIp);
  if (!limit.ok) return { error: `Too many attempts. Try again in ${Math.ceil(limit.retryAfterSeconds / 60)} minutes.` };

  const signerName = trimOrNull(formData.get("signer_name")) ?? "";
  const signerEmail = trimOrNull(formData.get("signer_email"));
  const signerPhone = trimOrNull(formData.get("signer_phone"));
  const agreed = formData.get("agreed") === "on" || formData.get("agreed") === "1";
  const res = await signDocument(token, { signerName, signerEmail, signerPhone, agreed, ip, userAgent });
  if (!res.ok) {
    if (res.error === "invalid_name") return { fieldErrors: { signer_name: ERROR_TEXT.invalid_name } };
    if (res.error === "invalid_email") return { fieldErrors: { signer_email: ERROR_TEXT.invalid_email } };
    if (res.error === "not_agreed") return { fieldErrors: { agreed: ERROR_TEXT.not_agreed } };
    return { error: ERROR_TEXT[res.error] };
  }
  return { signed: { documentId: res.documentId, signedAt: res.signedAt } };
}

export async function declineByToken(_prev: SignState, formData: FormData): Promise<SignState> {
  const token = trimOrNull(formData.get("token"));
  if (!isSigningTokenShape(token)) return { error: ERROR_TEXT.not_found };
  const { ip } = await clientAddress();
  const limit = rateLimit(`sign:${ip ?? "unknown"}`, RULES.signPerIp);
  if (!limit.ok) return { error: `Too many attempts. Try again in ${Math.ceil(limit.retryAfterSeconds / 60)} minutes.` };
  const res = await declineDocument(token, trimOrNull(formData.get("reason")));
  if (!res.ok) return { error: ERROR_TEXT[res.error] };
  return { declined: true };
}
