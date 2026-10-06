import { NextResponse } from "next/server";
import { hashSigningToken, isSigningTokenShape } from "@/lib/documents/tokens";
import { evidenceSummaryOf, renderDocumentPdf } from "@/lib/documents/pdf";
import { getDocumentByTokenHash } from "@/lib/documents/queries";
import { requestLogger } from "@/lib/log";
import { rateLimit, rateLimitHeaders, RULES } from "@/lib/rate-limit";
import { DEFAULT_STUDIO } from "@/lib/studio/queries";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient, isServiceClientConfigured } from "@/lib/supabase/service";
import type { PhotoDocumentRow } from "@/lib/supabase/database.types";
import { isUuid } from "@/lib/validation";

export const runtime = "nodejs";

/**
 * GET /api/documents/<id>/pdf[?token=bbs_…]
 *
 * Who may download: (a) whoever holds the signing token for THIS document
 * (service lookup by token hash, id must match), (b) the signed-in owner,
 * (c) the signed-in client the document belongs to — (b) and (c) go through
 * the user client, so RLS decides. Anything else is a 404: the response
 * never reveals whether a document id exists.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/documents/[id]/pdf">) {
  const { id } = await ctx.params;
  const { log, requestId } = requestLogger(request, "api/documents/pdf");
  const baseHeaders = { "cache-control": "private, no-store", "x-request-id": requestId };
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const limit = rateLimit(`document-pdf:${ip}`, RULES.signPerIp);
  if (!limit.ok) return NextResponse.json({ error: "Too many downloads. Try again shortly.", code: "RATE_LIMITED" }, { status: 429, headers: { ...baseHeaders, ...rateLimitHeaders(limit) } });
  if (!isUuid(id)) return notFound(baseHeaders);

  const token = new URL(request.url).searchParams.get("token");
  let doc: PhotoDocumentRow | null = null;
  if (token) {
    if (!isSigningTokenShape(token)) return notFound(baseHeaders);
    const byToken = await getDocumentByTokenHash(hashSigningToken(token));
    doc = byToken && byToken.id === id && byToken.status !== "draft" ? byToken : null;
  } else {
    const supabase = await createClient();
    const { data } = await supabase.from("photo_documents").select("*").eq("id", id).maybeSingle();
    doc = data ?? null;
  }
  if (!doc) return notFound(baseHeaders);

  const businessName = await studioNameFor(doc.owner_id);
  const signer =
    doc.status === "signed" && doc.signer_name && doc.signed_at
      ? {
          name: doc.signer_name,
          email: doc.signer_email,
          phone: doc.signer_phone,
          signedAt: new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Qatar", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(doc.signed_at)) + " (Qatar time)",
          evidenceSummary: evidenceSummaryOf(doc.signature_evidence),
        }
      : null;
  const bytes = await renderDocumentPdf({ title: doc.title, body: doc.body, status: doc.status, signer, businessName, ref: { documentId: doc.id, bodyHash: doc.body_hash } });
  log.info("documents.pdf", { documentId: doc.id, status: doc.status, auth: token ? "token" : "session", bytes: bytes.byteLength });
  const filename = `${doc.title.replace(/[^A-Za-z0-9 _-]+/g, "").trim().slice(0, 60) || "document"}${doc.status === "signed" ? " (signed)" : ""}.pdf`;
  return new NextResponse(Buffer.from(bytes), {
    status: 200,
    headers: { ...baseHeaders, "content-type": "application/pdf", "content-length": String(bytes.byteLength), "content-disposition": `attachment; filename="${filename}"` },
  });
}

function notFound(headers: Record<string, string>) {
  return NextResponse.json({ error: "Not found", code: "NOT_FOUND" }, { status: 404, headers });
}

/** The studio's name for the PDF header; the service client reads it because a client session cannot see photo_studio. */
async function studioNameFor(ownerId: string): Promise<string> {
  if (!isServiceClientConfigured()) return DEFAULT_STUDIO.business_name;
  const { data } = await createServiceClient().from("photo_studio").select("business_name").eq("owner_id", ownerId).maybeSingle();
  return data?.business_name ?? DEFAULT_STUDIO.business_name;
}
