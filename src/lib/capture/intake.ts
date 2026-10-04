import "server-only";
import { NextResponse } from "next/server";
import { createLogger, type Logger } from "@/lib/log";
import { rateLimit, rateLimitHeaders, RULES } from "@/lib/rate-limit";
import type { Database, PhotoCaptureCredentialRow } from "@/lib/supabase/database.types";
import { createServiceClient, isServiceClientConfigured } from "@/lib/supabase/service";
import type { SupabaseClient } from "@supabase/supabase-js";
import { findCredentialByToken } from "./credential-store";
import { parseCaptureBearer, type CredentialKind } from "./credentials";

/**
 * Shared front door for the machine-intake routes (/api/capture/*): resolves
 * the capture credential from the Authorization header, applies the per-ip
 * probe limit and the per-credential limit, and hands back a service client
 * plus the credential (whose owner_id is THE owner for everything after).
 */
export type IntakeContext = { supabase: SupabaseClient<Database>; credential: PhotoCaptureCredentialRow; log: Logger; headers: Record<string, string>; now: Date };

export async function authenticateIntake(request: Request, route: string, requestId: string, log: Logger = createLogger({ route }), requiredKind: CredentialKind = "capture"): Promise<{ ok: true; ctx: IntakeContext } | { ok: false; response: NextResponse }> {
  const headers = { "cache-control": "no-store", "x-request-id": requestId };
  const now = new Date();
  const fail = (status: number, code: string, error: string, extra: Record<string, string> = {}) => ({ ok: false as const, response: NextResponse.json({ error, code }, { status, headers: { ...headers, ...extra } }) });

  if (!isServiceClientConfigured()) return fail(503, "NOT_CONFIGURED", "Machine capture intake is not configured on the server.");
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const probe = rateLimit(`capture-auth:${ip}`, RULES.captureAuthPerIp);
  if (!probe.ok) return fail(429, "RATE_LIMITED", "Too many attempts.", rateLimitHeaders(probe));

  const token = parseCaptureBearer(request.headers.get("authorization"));
  if (!token) {
    log.warn("capture.auth_rejected", { reason: "missing" });
    return fail(401, "UNAUTHORIZED", "A capture credential is required (Authorization: Bearer bbmc_…).");
  }
  const supabase = createServiceClient();
  const lookup = await findCredentialByToken(supabase, token, now);
  if (!lookup.ok) {
    log.warn("capture.auth_rejected", { reason: lookup.reason });
    if (lookup.reason === "UNKNOWN") return fail(401, "UNAUTHORIZED", "Unknown capture credential.");
    return fail(401, lookup.reason === "expired" ? "CREDENTIAL_EXPIRED" : "CREDENTIAL_REVOKED", lookup.reason === "expired" ? "This capture credential has expired. Create a new one in Settings." : "This capture credential was revoked.");
  }
  if ((lookup.credential.kind ?? "capture") !== requiredKind) {
    log.warn("capture.auth_rejected", { reason: "wrong_kind", kind: lookup.credential.kind });
    return fail(403, "WRONG_CREDENTIAL_KIND", requiredKind === "orders" ? "This endpoint needs an orders intake credential (bbmo_…)." : "This endpoint needs a capture credential (bbmc_…).");
  }
  const limit = rateLimit(`capture:${lookup.credential.id}`, RULES.capturePerCredential);
  if (!limit.ok) return fail(429, "RATE_LIMITED", `Too many captures. Try again in ${limit.retryAfterSeconds}s.`, rateLimitHeaders(limit));

  return { ok: true, ctx: { supabase, credential: lookup.credential, log: log.child({ credentialId: lookup.credential.id, ownerId: lookup.credential.owner_id }), headers: { ...headers, ...rateLimitHeaders(limit) }, now } };
}
