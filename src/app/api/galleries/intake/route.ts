import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { touchCredential } from "@/lib/capture/credential-store";
import { authenticateIntake } from "@/lib/capture/intake";
import { galleryHostsOf } from "@/lib/galleries/form";
import { matchGalleryByName, parseGalleryEvent, type GalleryEvent } from "@/lib/galleries/intake-contract";
import { isAllowedGalleryUrl } from "@/lib/galleries/state";
import type { Logger } from "@/lib/log";
import { requestLogger } from "@/lib/log";
import { enqueueOwnerTelegram } from "@/lib/notifications/owner";
import { isOrdersIntakeEnabled } from "@/lib/orders/config";
import { siteUrl } from "@/lib/studio/queries";
import type { Database, PhotoGalleryRow } from "@/lib/supabase/database.types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_BODY_BYTES = 64 * 1024;
const GALLERY_COLS = "id,owner_id,name,status,pictime_url,pictime_project_id,visitor_count,booking_id,ready_at,created_in_pictime_at";
type GalleryLite = Pick<PhotoGalleryRow, "id" | "owner_id" | "name" | "status" | "pictime_url" | "pictime_project_id" | "visitor_count" | "booking_id" | "ready_at" | "created_in_pictime_at">;
type Client = SupabaseClient<Database>;

/**
 * POST /api/galleries/intake   (JSON; Authorization: Bearer bbmo_…)
 *
 * Pic-Time gallery events relayed by Zapier, behind the same flag and the
 * same orders-intake credential as /api/orders/intake. An invite sent from
 * Pic-Time marks the matching gallery ready (the client already has the link
 * from Pic-Time, so NO e-mail is sent from here); a visitor bumps the
 * counter; a new gallery creates or fills in the row. Unknown galleries are
 * acknowledged (202) and logged, never invented from a visitor or invite.
 */
export async function POST(request: Request) {
  const { log, requestId } = requestLogger(request, "api/galleries/intake");
  const headers = { "cache-control": "no-store", "x-request-id": requestId };
  if (!isOrdersIntakeEnabled()) return NextResponse.json({ error: "Not found", code: "NOT_FOUND" }, { status: 404, headers });

  const auth = await authenticateIntake(request, "api/galleries/intake", requestId, log, "orders");
  if (!auth.ok) return auth.response;
  const { supabase, credential, now } = auth.ctx;
  const ownerId = credential.owner_id;

  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) return NextResponse.json({ error: "Body too large.", code: "TOO_LARGE" }, { status: 413, headers: auth.ctx.headers });
  let raw: unknown;
  try {
    const text = await request.text();
    if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) return NextResponse.json({ error: "Body too large.", code: "TOO_LARGE" }, { status: 413, headers: auth.ctx.headers });
    raw = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON.", code: "INVALID_JSON" }, { status: 400, headers: auth.ctx.headers });
  }
  const parsed = parseGalleryEvent(raw);
  if (!parsed.ok) {
    auth.ctx.log.info("galleries.rejected", { code: parsed.code });
    return NextResponse.json({ error: parsed.error, code: parsed.code }, { status: 400, headers: auth.ctx.headers });
  }
  const event = parsed.event;

  try {
    const [gallery, hosts] = await Promise.all([findGallery(supabase, ownerId, event), extraHosts(supabase, ownerId)]);
    const url = event.gallery.url && isAllowedGalleryUrl(event.gallery.url, hosts) ? event.gallery.url : null;
    const iso = now.toISOString();
    let outcome: { status: number; galleryId: string | null; action: string; matched: boolean };

    if (event.event === "gallery_created") {
      if (!gallery) {
        const { data, error } = await supabase
          .from("photo_galleries")
          .insert({ owner_id: ownerId, name: event.gallery.name, pictime_url: url, pictime_project_id: event.gallery.id, status: "created", created_in_pictime_at: event.occurredAt ?? iso })
          .select("id")
          .single();
        if (error) throw new Error(error.message);
        outcome = { status: 201, galleryId: data.id, action: "created", matched: false };
      } else {
        const patch: Partial<PhotoGalleryRow> = { updated_at: iso };
        if (!gallery.pictime_url && url) patch.pictime_url = url;
        if (!gallery.pictime_project_id && event.gallery.id) patch.pictime_project_id = event.gallery.id;
        if (!gallery.created_in_pictime_at) patch.created_in_pictime_at = event.occurredAt ?? iso;
        if (gallery.status === "pending" && (gallery.pictime_url || url)) patch.status = "created";
        await patchGallery(supabase, gallery, patch);
        outcome = { status: 200, galleryId: gallery.id, action: Object.keys(patch).length > 1 ? "filled" : "noop", matched: true };
      }
    } else if (!gallery) {
      auth.ctx.log.info("galleries.unmatched", { event: event.event, hasProjectId: Boolean(event.gallery.id) });
      outcome = { status: 202, galleryId: null, action: "ignored", matched: false };
    } else if (event.event === "gallery_invite_sent") {
      if (gallery.status === "pending" || gallery.status === "created") {
        const patch: Partial<PhotoGalleryRow> = { status: "ready", ready_at: gallery.ready_at ?? event.occurredAt ?? iso, updated_at: iso };
        if (!gallery.pictime_url && url) patch.pictime_url = url;
        if (!gallery.pictime_project_id && event.gallery.id) patch.pictime_project_id = event.gallery.id;
        await patchGallery(supabase, gallery, patch);
        await enqueueOwnerTelegram(supabase, {
          ownerId,
          kind: "GALLERY_READY",
          alertKey: `gallery:${gallery.id}:ready`,
          title: `Gallery ready — ${gallery.name} (Pic-Time invite sent)`,
          lines: [event.client?.email ? "Pic-Time e-mailed the client the gallery invite." : "Pic-Time sent the gallery invite.", "Nothing was e-mailed from the studio."],
          url: `${siteUrl()}/galleries/${gallery.id}`,
          now,
        });
        outcome = { status: 200, galleryId: gallery.id, action: "ready", matched: true };
      } else {
        outcome = { status: 200, galleryId: gallery.id, action: "noop", matched: true };
      }
    } else {
      await patchGallery(supabase, gallery, { visitor_count: (gallery.visitor_count ?? 0) + 1, last_visitor_at: event.visitor?.at ?? event.occurredAt ?? iso, updated_at: iso });
      outcome = { status: 200, galleryId: gallery.id, action: "visitor", matched: true };
    }

    await touchCredential(supabase, credential, now);
    auth.ctx.log.info("galleries.event", { event: event.event, action: outcome.action, matched: outcome.matched, galleryId: outcome.galleryId });
    return NextResponse.json({ ok: true, event: event.event, galleryId: outcome.galleryId, action: outcome.action, matched: outcome.matched, receivedAt: iso }, { status: outcome.status, headers: auth.ctx.headers });
  } catch (err) {
    logFailure(auth.ctx.log, err);
    return NextResponse.json({ error: "Could not record the gallery event.", code: "RECORD_FAILED" }, { status: 500, headers: auth.ctx.headers });
  }
}

function logFailure(log: Logger, err: unknown) {
  log.error("galleries.record_failed", { error: err instanceof Error ? err.message : String(err) });
}

async function findGallery(supabase: Client, ownerId: string, event: GalleryEvent): Promise<GalleryLite | null> {
  if (event.gallery.id) {
    const { data, error } = await supabase.from("photo_galleries").select(GALLERY_COLS).eq("owner_id", ownerId).eq("pictime_project_id", event.gallery.id).limit(1);
    if (error) throw new Error(error.message);
    if (data?.[0]) return data[0] as GalleryLite;
  }
  const { data, error } = await supabase.from("photo_galleries").select(GALLERY_COLS).eq("owner_id", ownerId).limit(500);
  if (error) throw new Error(error.message);
  return matchGalleryByName((data ?? []) as GalleryLite[], event.gallery.name);
}

async function extraHosts(supabase: Client, ownerId: string): Promise<string[]> {
  const { data } = await supabase.from("photo_studio").select("settings").eq("owner_id", ownerId).maybeSingle();
  return galleryHostsOf(data?.settings);
}

async function patchGallery(supabase: Client, gallery: GalleryLite, patch: Partial<PhotoGalleryRow>): Promise<void> {
  const { error } = await supabase.from("photo_galleries").update(patch).eq("id", gallery.id).eq("owner_id", gallery.owner_id);
  if (error) throw new Error(error.message);
}
