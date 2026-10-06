import { NextResponse } from "next/server";
import { requireOwnedEvent } from "@/lib/authz";
import { EXTRACT_LIMITS, extractedToRows, isExtractMediaType } from "@/lib/bracket-extract";
import { extractBracketFromImage, isBracketExtractionConfigured } from "@/lib/bracket-extract-server";
import { normaliseName } from "@/lib/client-form";
import { rulesOf } from "@/lib/local-divisions";
import { requestLogger } from "@/lib/log";
import { rateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/validation";

export const runtime = "nodejs";
export const maxDuration = 120;

const RULE = { max: 20, windowMs: 10 * 60_000 };

/**
 * POST { eventId, mediaType, image (base64) } → reviewable bracket rows read
 * from the picture. Owner-only; nothing is saved here — the owner reviews
 * and corrects the rows, then applies them through applyBracketRows.
 */
export async function POST(request: Request) {
  const { log, requestId } = requestLogger(request, "api/brackets/extract");
  const headers = { "cache-control": "no-store", "x-request-id": requestId };
  if (!isBracketExtractionConfigured()) return NextResponse.json({ error: "Reading bracket photos is not set up on this server.", code: "NOT_CONFIGURED" }, { status: 404, headers });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401, headers });
  const limit = rateLimit(`brackets-extract:${user.id}`, RULE);
  if (!limit.ok) return NextResponse.json({ error: "Too many photos in a short time. Wait a few minutes.", code: "RATE_LIMITED" }, { status: 429, headers: { ...headers, ...rateLimitHeaders(limit) } });

  let body: { eventId?: unknown; mediaType?: unknown; image?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Body must be JSON.", code: "INVALID_JSON" }, { status: 400, headers });
  }
  const eventId = typeof body.eventId === "string" ? body.eventId : "";
  if (!isUuid(eventId)) return NextResponse.json({ error: "Choose an event.", code: "INVALID_EVENT" }, { status: 400, headers });
  if (!isExtractMediaType(body.mediaType)) return NextResponse.json({ error: "Use a JPEG, PNG, WebP or GIF image.", code: "INVALID_IMAGE" }, { status: 400, headers });
  const image = typeof body.image === "string" ? body.image.replace(/^data:[^,]+,/, "") : "";
  if (!image || image.length > EXTRACT_LIMITS.maxBase64Bytes) return NextResponse.json({ error: "The image is missing or larger than 6 MB.", code: "INVALID_IMAGE" }, { status: 400, headers });

  const owned = await requireOwnedEvent(supabase, eventId);
  if (!owned.ok) return NextResponse.json({ error: owned.error, code: "FORBIDDEN" }, { status: 403, headers });
  if (owned.ownerId !== user.id) return NextResponse.json({ error: "Only the owner can import brackets.", code: "FORBIDDEN" }, { status: 403, headers });
  const [{ data: event }, { data: clients }] = await Promise.all([
    supabase.from("photo_events").select("name,platform,division_rules").eq("id", eventId).maybeSingle(),
    supabase.from("photo_athletes").select("id,name").eq("event_id", eventId),
  ]);
  if (!event) return NextResponse.json({ error: "Event not found.", code: "NOT_FOUND" }, { status: 404, headers });

  const started = Date.now();
  const outcome = await extractBracketFromImage({ data: image, mediaType: body.mediaType, eventName: event.name, rules: rulesOf(event) });
  log.info("brackets.extract", { eventId, ok: outcome.ok, elapsedMs: Date.now() - started, matches: outcome.ok ? outcome.extracted.matches.length : 0 });
  if (!outcome.ok) return NextResponse.json({ error: outcome.error, code: "EXTRACT_FAILED" }, { status: 422, headers });

  const keys = new Set((clients ?? []).map((c) => normaliseName(c.name)));
  return NextResponse.json(
    {
      ok: true,
      extracted: outcome.extracted,
      rows: extractedToRows(outcome.extracted, keys, { everyone: true }),
      clientNames: (clients ?? []).map((c) => c.name),
    },
    { headers },
  );
}
