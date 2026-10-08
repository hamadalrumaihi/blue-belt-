import { NextResponse } from "next/server";
import { applyProviderEvent } from "@/lib/documents/events";
import { getEsignProvider } from "@/lib/esign";
import { esignProviderName, esignWebhookSecret } from "@/lib/esign/config";
import type { EsignEvent } from "@/lib/esign/types";
import { requestLogger } from "@/lib/log";
import { rateLimit, rateLimitHeaders, RULES } from "@/lib/rate-limit";
import { createServiceClient, isServiceClientConfigured } from "@/lib/supabase/service";
import type { Json } from "@/lib/supabase/database.types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Provider deliveries are small JSON documents; DocuSign Connect without documents is well under this. */
const MAX_BODY_BYTES = 256 * 1024;

type EventOutcome = { eventId: string; result: "applied" | "duplicate" | "no_document" | "ignored" | "error"; documentId?: string };

/**
 * POST /api/esign/webhook
 *
 * Dark (404) until a provider with webhooks is selected AND ESIGN_WEBHOOK_SECRET
 * is set. Every delivery is verified by the provider's `parseWebhook` with that
 * secret: 401 on a bad or missing signature, 400 on a payload that verified but
 * cannot be read. Verified events are recorded in photo_esign_events first
 * (provider + event_id unique), so a redelivery is a 200 no-op, then mapped to
 * the document by (provider, provider_envelope_id) and applied through the same
 * `applyProviderEvent` path as the internal signing page. Envelope ids come only
 * from the verified body, never from the URL. Nothing from the body is logged.
 */
export async function POST(request: Request) {
  const providerName = esignProviderName();
  const secret = esignWebhookSecret();
  if (providerName === "internal" || !secret) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { log, requestId } = requestLogger(request, "api/esign/webhook");
  const headers = { "cache-control": "no-store", "x-request-id": requestId };

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const limit = rateLimit(`esign-webhook:${ip}`, RULES.paymentsWebhookPerIp);
  if (!limit.ok) return NextResponse.json({ error: "Too many requests.", code: "RATE_LIMITED" }, { status: 429, headers: { ...headers, ...rateLimitHeaders(limit) } });

  if (!isServiceClientConfigured()) {
    log.error("esign.webhook_not_configured");
    return NextResponse.json({ error: "Service client is not configured.", code: "NOT_CONFIGURED" }, { status: 503, headers });
  }
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return NextResponse.json({ error: "Body too large.", code: "TOO_LARGE" }, { status: 413, headers });
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) return NextResponse.json({ error: "Body too large.", code: "TOO_LARGE" }, { status: 413, headers });

  const provider = getEsignProvider(providerName);
  const parsed = provider.parseWebhook({ headers: request.headers, body: text }, secret);
  if (!parsed.ok) {
    log.warn("esign.webhook_rejected", { provider: provider.name, reason: parsed.error });
    if (parsed.error === "unauthorized") return NextResponse.json({ error: "Invalid signature.", code: "INVALID_SIGNATURE" }, { status: 401, headers });
    if (parsed.error === "unsupported") return NextResponse.json({ error: "Not found" }, { status: 404, headers });
    return NextResponse.json({ error: "Payload could not be read.", code: "INVALID_PAYLOAD" }, { status: 400, headers });
  }

  const supabase = createServiceClient();
  const now = new Date();
  const outcomes: EventOutcome[] = [];
  for (const event of parsed.events) outcomes.push(await handleEvent(supabase, provider.name, event, now));

  log.info("esign.webhook", { provider: provider.name, events: outcomes.length, results: outcomes.map((o) => o.result) });
  if (outcomes.some((o) => o.result === "error")) return NextResponse.json({ error: "Could not record an event.", code: "PROCESSING_FAILED", outcomes }, { status: 500, headers });
  return NextResponse.json({ ok: true, outcomes }, { status: 200, headers });
}

async function handleEvent(supabase: ReturnType<typeof createServiceClient>, providerName: string, event: EsignEvent, now: Date): Promise<EventOutcome> {
  // Record first (idempotency key: provider + event id). A row that was
  // already processed is a duplicate; one that was recorded but not processed
  // (a crash mid-way) is picked up again.
  const { data: existing } = await supabase.from("photo_esign_events").select("id,processed_at").eq("provider", providerName).eq("event_id", event.eventId).maybeSingle();
  let rowId: number | null = existing?.id ?? null;
  if (existing?.processed_at) return { eventId: event.eventId, result: "duplicate" };
  if (!existing) {
    const { data: inserted, error } = await supabase
      .from("photo_esign_events")
      .insert({ provider: providerName, event_id: event.eventId, envelope_id: event.envelopeId, event_type: event.type, payload: event as unknown as Json, received_at: now.toISOString() })
      .select("id")
      .single();
    if (error) {
      // Unique violation: a parallel delivery got there first.
      if (error.code === "23505") return { eventId: event.eventId, result: "duplicate" };
      return { eventId: event.eventId, result: "error" };
    }
    rowId = inserted.id;
  }
  const finish = async (result: EventOutcome["result"], documentId?: string) => {
    // An error leaves processed_at empty so the provider's retry is processed, not treated as a duplicate.
    if (rowId !== null) await supabase.from("photo_esign_events").update({ processed_at: result === "error" ? null : new Date().toISOString(), result }).eq("id", rowId);
    return { eventId: event.eventId, result, documentId } satisfies EventOutcome;
  };

  const { data: doc } = await supabase.from("photo_documents").select("*").eq("provider", providerName).eq("provider_envelope_id", event.envelopeId).maybeSingle();
  if (!doc) return finish("no_document");
  const applied = await applyProviderEvent(supabase, { doc, event, actor: { kind: "system" }, reason: event.reason ?? null, columns: { provider_error: null } }, now);
  if (!applied.ok) return finish("error", doc.id);
  return finish(applied.applied ? "applied" : "ignored", doc.id);
}
