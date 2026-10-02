import { NextResponse } from "next/server";
import { requestLogger } from "@/lib/log";
import { rateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { createServiceClient, isServiceClientConfigured } from "@/lib/supabase/service";
import { getPaymentsConfig, isPaymentsEnabled } from "@/lib/payments/config";
import { isSupportedWebhookVersion, SIGNATURE_HEADER, VERSION_HEADER, verifySignature } from "@/lib/payments/myfatoorah/signature";
import { processWebhook } from "@/lib/payments/myfatoorah/webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/payments/myfatoorah/webhook  (Webhook V2, see docs/payments.md)
 *
 * Outside the watcher's critical path and dark until PAYMENTS_MYFATOORAH_ENABLED=1
 * plus both secrets are set (404 otherwise, so the URL is not even discoverable).
 *
 * Responses: 200 for processed / duplicate / ignored outcomes (MyFatoorah stops
 * retrying), 401 for a bad or unverifiable signature, 400 for malformed JSON,
 * 429 when rate limited, 500 only when the delivery could not be recorded (so
 * MyFatoorah retries, up to 5 times). The raw payload is never logged.
 */
export async function POST(request: Request) {
  if (!isPaymentsEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { log, requestId } = requestLogger(request, "api/payments/myfatoorah/webhook");
  const headers = { "cache-control": "no-store", "x-request-id": requestId };

  const limit = rateLimit("payments-webhook", { max: 120, windowMs: 60_000 });
  if (!limit.ok) return NextResponse.json({ error: "Too many requests.", code: "RATE_LIMITED" }, { status: 429, headers: { ...headers, ...rateLimitHeaders(limit) } });

  if (!isServiceClientConfigured()) {
    log.error("payments.webhook_not_configured");
    return NextResponse.json({ error: "Service client is not configured.", code: "NOT_CONFIGURED" }, { status: 503, headers });
  }

  // The signature covers specific fields, not the raw bytes, so read the text
  // first (never consumed twice) and parse after.
  const text = await request.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON.", code: "INVALID_JSON" }, { status: 400, headers });
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: "Request body must be a JSON object.", code: "INVALID_JSON" }, { status: 400, headers });
  }

  const config = getPaymentsConfig();
  if (!isSupportedWebhookVersion(request.headers.get(VERSION_HEADER))) {
    log.warn("payments.webhook_unsupported_version");
    return NextResponse.json({ error: "Only MyFatoorah Webhook V2 is supported.", code: "UNSUPPORTED_VERSION" }, { status: 401, headers });
  }
  const verdict = verifySignature(request.headers.get(SIGNATURE_HEADER), body as Record<string, unknown>, config.webhookSecret);

  const outcome = await processWebhook({ body: body as Record<string, unknown>, signatureValid: verdict.valid }, { supabase: createServiceClient(), now: () => new Date(), log });

  log.info("payments.webhook", {
    result: outcome.result,
    eventId: outcome.eventId,
    eventType: outcome.eventType,
    bookingId: outcome.bookingId,
    status: outcome.status,
    detail: outcome.detail,
    verified: verdict.valid,
    // Key name avoids the log redactor's secret-ish patterns; the value is an enum, not a secret.
    verdictReason: verdict.valid ? undefined : verdict.reason,
  });

  if (!verdict.valid) return NextResponse.json({ error: "Invalid signature.", code: "INVALID_SIGNATURE" }, { status: 401, headers });
  if (outcome.result === "error") return NextResponse.json({ error: "Could not record the event.", code: "PROCESSING_FAILED" }, { status: 500, headers });
  return NextResponse.json({ ok: true, result: outcome.result }, { status: 200, headers });
}
