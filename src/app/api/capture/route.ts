import { NextResponse } from "next/server";
import { touchCredential } from "@/lib/capture/credential-store";
import { inCredentialScope } from "@/lib/capture/credentials";
import { authenticateIntake } from "@/lib/capture/intake";
import { sourceKey } from "@/lib/capture/source-identity";
import { failureStatus, importPage } from "@/lib/import-service";
import { requestLogger } from "@/lib/log";
import { parseImportRequest } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/capture   (JSON, machine intake)
 *   Authorization: Bearer bbmc_…            revocable owner/source-scoped capture credential
 *   { url, html, capture: { captureId, capturedAt, finalUrl?, completeness? } }
 *
 * The Windows event-session agent posts here. It is deliberately separate
 * from /api/import (signed-in photographer) and /api/import/receive (HTML
 * form hand-over): no session cookie, no service-role key, owner = the
 * credential's owner. Everything after authentication is the same capture
 * pipeline as the import page (source identity, replay, out-of-order,
 * timing, final URL, refresh, history, notifications).
 */
export async function POST(request: Request) {
  const { log, requestId } = requestLogger(request, "api/capture");
  const auth = await authenticateIntake(request, "api/capture", requestId, log);
  if (!auth.ok) return auth.response;
  const { supabase, credential, headers, now } = auth.ctx;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    raw = undefined;
  }
  const parsed = parseImportRequest(raw);
  if (!parsed.ok) {
    auth.ctx.log.info("capture.rejected", { code: parsed.code });
    return NextResponse.json({ error: parsed.error, code: parsed.code }, { status: parsed.code === "TOO_LARGE" ? 413 : 400, headers });
  }
  if (!parsed.capture.captureId || !parsed.capture.capturedAt) {
    return NextResponse.json({ error: "capture.captureId and capture.capturedAt are required for machine intake.", code: "INVALID_CAPTURE" }, { status: 400, headers });
  }
  const key = sourceKey(parsed.url);
  if (!key) return NextResponse.json({ error: "Only ajptour.com and smoothcomp.com links can be captured.", code: "UNSUPPORTED_HOST" }, { status: 400, headers });
  if (!inCredentialScope(credential, key)) {
    auth.ctx.log.warn("capture.out_of_scope", { sourceKey: key });
    return NextResponse.json({ error: "This credential is not allowed to capture that source.", code: "OUT_OF_SCOPE" }, { status: 403, headers });
  }

  const outcome = await importPage(supabase, {
    url: parsed.url,
    html: parsed.html,
    ownerId: credential.owner_id,
    eventId: credential.scope_event_id,
    capture: { ...parsed.capture, transport: "agent" },
    transport: "agent",
    now,
    log: auth.ctx.log,
  });
  await touchCredential(supabase, credential, now);
  if (!outcome.ok) {
    const capture = "capture" in outcome ? outcome.capture : undefined;
    return NextResponse.json({ error: outcome.message, code: outcome.code, url: outcome.url, candidates: outcome.candidates ?? [], ...(capture ? { capture } : {}) }, { status: failureStatus(outcome.code), headers });
  }
  // The agent needs the verdict, not every match row.
  return NextResponse.json(
    {
      ok: true,
      url: outcome.url,
      matched: outcome.matched,
      checkedAt: outcome.checkedAt,
      capture: outcome.capture,
      results: outcome.results.map((r) => ({ athleteId: r.athleteId, status: r.status, code: r.code, matches: r.matches.length, changes: r.changes.length })),
    },
    { headers },
  );
}
