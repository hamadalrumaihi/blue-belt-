import { NextResponse } from "next/server";
import { failureStatus, importPage, previewImport } from "@/lib/import-service";
import { requestLogger } from "@/lib/log";
import { rateLimit, rateLimitHeaders, RULES } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { parseImportRequest } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/import         { url, html }  applies the page to its clients.
 * POST /api/import?preview=1 { url, html } previews the outcome, persisting nothing.
 *
 * Applies a page the signed-in photographer fetched in their own browser
 * (where they passed the site's bot check as a person) to the clients that
 * watch that page. Same auth, RLS and persistence path as /api/watch; the
 * network fetch is the only step replaced.
 */
export async function POST(request: Request) {
  const { log, requestId } = requestLogger(request, "api/import");
  const headers = { "cache-control": "no-store", "x-request-id": requestId };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401, headers });

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    raw = undefined;
  }
  const parsed = parseImportRequest(raw);
  if (!parsed.ok) {
    log.info("import.rejected", { code: parsed.code });
    return NextResponse.json({ error: parsed.error, code: parsed.code }, { status: parsed.code === "TOO_LARGE" ? 413 : 400, headers });
  }

  const limit = rateLimit(`import:${user.id}`, RULES.importPerUser);
  if (!limit.ok) {
    log.warn("import.rate_limited", { retryAfter: limit.retryAfterSeconds });
    return NextResponse.json(
      { error: `Too many imports. Try again in ${limit.retryAfterSeconds}s.`, code: "RATE_LIMITED", retryAfterSeconds: limit.retryAfterSeconds },
      { status: 429, headers: { ...headers, ...rateLimitHeaders(limit) } },
    );
  }

  const preview = new URL(request.url).searchParams.get("preview") === "1";
  const outcome = preview
    ? await previewImport(supabase, { url: parsed.url, html: parsed.html, log })
    : await importPage(supabase, { url: parsed.url, html: parsed.html, ownerId: user.id, capture: parsed.capture, transport: parsed.capture.transport ?? "import", log });
  if (!outcome.ok) {
    const status = failureStatus(outcome.code);
    const capture = "capture" in outcome ? outcome.capture : undefined;
    return NextResponse.json({ error: outcome.message, code: outcome.code, url: outcome.url, candidates: outcome.candidates ?? [], ...(capture ? { capture } : {}) }, { status, headers: { ...headers, ...rateLimitHeaders(limit) } });
  }
  return NextResponse.json(outcome, { headers: { ...headers, ...rateLimitHeaders(limit) } });
}
