"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { writeAudit } from "@/lib/audit";
import { deliveryColumns, formatQr } from "@/lib/bookings/state";
import { galleryHostsOf, parseGalleryForm } from "@/lib/galleries/form";
import { canTransitionGallery, isGalleryStatus } from "@/lib/galleries/state";
import { enqueueClientEmail } from "@/lib/notifications/email/outbox";
import { buildEmail } from "@/lib/notifications/email/templates";
import { enqueueOwnerTelegram } from "@/lib/notifications/owner";
import { loadStudio, siteUrl } from "@/lib/studio/queries";
import type { GalleryStatus, PhotoBookingRow, PhotoGalleryRow } from "@/lib/supabase/database.types";
import { requireStudioUser } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { isValidEmail } from "@/lib/utils";
import { isUuid } from "@/lib/validation";
import type { ActionState } from "./types";

/**
 * Gallery lifecycle for the owner. Everything runs on the user client (RLS:
 * owner policies on photo_galleries / photo_bookings / photo_people), with
 * owner_id pinned explicitly on every write.
 *
 * Round 3 rules:
 *   - saving a gallery link never sends anything to the client and never
 *     makes the final balance due (audit gallery.url_added);
 *   - "Deliver gallery" (deliverGallery) is the ONLY action that marks the
 *     booking delivered and makes the remaining 50% due; the client e-mail
 *     is an opt-in tick, OFF by default, and the final payment link is never
 *     created or sent automatically;
 *   - "Mark ready" (markGalleryReady) tells the client the gallery is up
 *     (opt-in) but leaves the booking and the balance alone.
 */
export type GalleryActionResult = { ok: true; status: GalleryStatus; notified?: boolean; notifyReason?: string; balanceDue?: boolean } | { ok: false; error: string };

const BOOKING_COLS = "id,owner_id,client_id,customer_name,customer_email,athlete_name,public_ref,booking_status,event_id,quoted_at,confirmed_at,delivered_at,completed_at,cancelled_at,gallery_delivered_at,balance_state,balance_qr,balance_due_at,currency";
type BookingLite = Pick<PhotoBookingRow, "id" | "owner_id" | "client_id" | "customer_name" | "customer_email" | "athlete_name" | "public_ref" | "booking_status" | "event_id" | "quoted_at" | "confirmed_at" | "delivered_at" | "completed_at" | "cancelled_at" | "gallery_delivered_at" | "balance_state" | "balance_qr" | "balance_due_at" | "currency">;

async function currentUser() {
  const supabase = await createClient();
  // Studio team only: a client-portal account gets `user: null` here, which every
  // caller turns into a clear error. RLS (photo_is_studio_user) enforces the same.
  const guard = await requireStudioUser();
  const user = guard.ok ? ({ id: guard.viewer.userId, email: guard.viewer.email } as { id: string; email: string | null }) : null;
  return { supabase, user };
}

type Client = Awaited<ReturnType<typeof createClient>>;

async function ownedGallery(supabase: Client, id: string, ownerId: string): Promise<PhotoGalleryRow | null> {
  const { data } = await supabase.from("photo_galleries").select("*").eq("id", id).eq("owner_id", ownerId).maybeSingle();
  return data ?? null;
}

async function ownedBooking(supabase: Client, id: string | null, ownerId: string): Promise<BookingLite | null> {
  if (!id) return null;
  const { data } = await supabase.from("photo_bookings").select(BOOKING_COLS).eq("id", id).eq("owner_id", ownerId).maybeSingle();
  return (data as BookingLite | null) ?? null;
}

async function extraHosts(): Promise<string[]> {
  const studio = await loadStudio();
  return galleryHostsOf(studio?.settings);
}

function revalidateGalleryPaths(galleryId: string | null, bookingIds: Array<string | null | undefined>) {
  revalidatePath("/galleries");
  revalidatePath("/studio");
  if (galleryId) revalidatePath(`/galleries/${galleryId}`);
  for (const b of bookingIds) {
    if (!b) continue;
    revalidatePath(`/bookings/${b}`);
    revalidatePath(`/client/bookings/${b}`);
  }
  revalidatePath("/bookings");
  revalidatePath("/client");
}

export async function createGallery(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { supabase, user } = await currentUser();
  if (!user) return { error: "You are signed out." };
  const { values, fieldErrors } = parseGalleryForm(fd, { extraHosts: await extraHosts() });
  if (Object.keys(fieldErrors).length) return { fieldErrors };

  const booking = await ownedBooking(supabase, values.booking_id, user.id);
  if (values.booking_id && !booking) return { fieldErrors: { booking_id: "Booking not found or you do not have access to it." } };
  const clientId = values.client_id ?? booking?.client_id ?? null;
  const now = new Date().toISOString();
  const status: GalleryStatus = values.pictime_url ? "created" : "pending";

  const { data, error } = await supabase
    .from("photo_galleries")
    .insert({
      owner_id: user.id,
      name: values.name,
      pictime_url: values.pictime_url,
      pictime_project_id: values.pictime_project_id,
      booking_id: booking?.id ?? null,
      client_id: clientId,
      event_id: values.event_id ?? booking?.event_id ?? null,
      notes: values.notes,
      status,
      created_in_pictime_at: values.pictime_url ? now : null,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };

  if (booking) await supabase.from("photo_bookings").update({ gallery_id: data.id }).eq("id", booking.id).eq("owner_id", user.id);
  await writeAudit(supabase, { ownerId: user.id, actorId: user.id, entity: "gallery", entityId: data.id, action: "gallery.created", data: { status, bookingId: booking?.id ?? null, hasUrl: Boolean(values.pictime_url) } });
  if (values.pictime_url) {
    await writeAudit(supabase, { ownerId: user.id, actorId: user.id, entity: "booking", entityId: booking?.id ?? null, action: "gallery.url_added", data: { gallery_id: data.id, host: hostOf(values.pictime_url) } });
    // Owner-only notice; the client is never messaged by saving a link.
    await enqueueOwnerTelegram(supabase, {
      ownerId: user.id,
      kind: "GALLERY_LINKED",
      alertKey: `gallery:${data.id}:linked`,
      title: `Gallery linked: ${values.name}`,
      lines: [booking ? `Booking ${booking.public_ref ?? ""} · ${booking.athlete_name}`.trim() : null, "Deliver the gallery from the booking page when it is ready; that makes the final balance due."],
      url: `${siteUrl()}/galleries/${data.id}`,
    });
  }
  revalidateGalleryPaths(data.id, [booking?.id]);
  redirect(`/galleries/${data.id}`);
}

export async function updateGallery(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  if (!isUuid(id)) return { error: "Invalid gallery id." };
  const { supabase, user } = await currentUser();
  if (!user) return { error: "You are signed out." };
  const { values, fieldErrors } = parseGalleryForm(fd, { extraHosts: await extraHosts() });
  if (Object.keys(fieldErrors).length) return { fieldErrors };
  const gallery = await ownedGallery(supabase, id, user.id);
  if (!gallery) return { error: "Gallery not found or you do not have access to it." };
  const booking = await ownedBooking(supabase, values.booking_id, user.id);
  if (values.booking_id && !booking) return { fieldErrors: { booking_id: "Booking not found or you do not have access to it." } };

  // A ready/delivered gallery must keep a link; otherwise a freshly linked pending gallery becomes "created".
  if ((gallery.status === "ready" || gallery.status === "delivered") && !values.pictime_url) return { fieldErrors: { pictime_url: "A ready gallery needs its gallery link. Step it back to “Created” first to remove the link." } };
  const linkedNow = Boolean(values.pictime_url) && !gallery.pictime_url;
  const status: GalleryStatus = gallery.status === "pending" && values.pictime_url ? "created" : gallery.status === "created" && !values.pictime_url ? "pending" : gallery.status;
  const now = new Date().toISOString();

  const { error, count } = await supabase
    .from("photo_galleries")
    .update(
      {
        name: values.name,
        pictime_url: values.pictime_url,
        pictime_project_id: values.pictime_project_id,
        booking_id: booking?.id ?? null,
        client_id: values.client_id ?? booking?.client_id ?? gallery.client_id,
        event_id: values.event_id ?? booking?.event_id ?? gallery.event_id,
        notes: values.notes,
        status,
        created_in_pictime_at: gallery.created_in_pictime_at ?? (values.pictime_url ? now : null),
        updated_at: now,
      },
      { count: "exact" },
    )
    .eq("id", id)
    .eq("owner_id", user.id);
  if (error) return { error: error.message };
  if (!count) return { error: "Gallery not found or you do not have access to it." };

  if (gallery.booking_id && gallery.booking_id !== (booking?.id ?? null)) {
    await supabase.from("photo_bookings").update({ gallery_id: null }).eq("id", gallery.booking_id).eq("owner_id", user.id).eq("gallery_id", id);
  }
  if (booking) await supabase.from("photo_bookings").update({ gallery_id: id }).eq("id", booking.id).eq("owner_id", user.id);
  await writeAudit(supabase, { ownerId: user.id, actorId: user.id, entity: "gallery", entityId: id, action: "gallery.updated", data: { status, bookingId: booking?.id ?? null, linkedNow } });
  if (linkedNow) {
    await writeAudit(supabase, { ownerId: user.id, actorId: user.id, entity: "booking", entityId: booking?.id ?? null, action: "gallery.url_added", data: { gallery_id: id, host: hostOf(values.pictime_url) } });
    await enqueueOwnerTelegram(supabase, { ownerId: user.id, kind: "GALLERY_LINKED", alertKey: `gallery:${id}:linked`, title: `Gallery linked: ${values.name}`, lines: [booking ? `Booking ${booking.public_ref ?? ""} · ${booking.athlete_name}`.trim() : null, "Deliver the gallery from the booking page when it is ready; that makes the final balance due."], url: `${siteUrl()}/galleries/${id}` });
  }
  revalidateGalleryPaths(id, [gallery.booking_id, booking?.id]);
  redirect(`/galleries/${id}`);
}

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/** Generic step along the gallery lifecycle (no e-mail, no booking change). */
export async function transitionGallery(id: string, to: GalleryStatus): Promise<GalleryActionResult> {
  if (!isUuid(id)) return { ok: false, error: "Invalid gallery id." };
  if (!isGalleryStatus(to)) return { ok: false, error: "Unknown gallery status." };
  const { supabase, user } = await currentUser();
  if (!user) return { ok: false, error: "You are signed out." };
  const gallery = await ownedGallery(supabase, id, user.id);
  if (!gallery) return { ok: false, error: "Gallery not found or you do not have access to it." };
  if (!canTransitionGallery(gallery.status, to)) return { ok: false, error: `A gallery cannot go from “${gallery.status}” to “${to}”.` };
  if ((to === "ready" || to === "delivered") && !gallery.pictime_url) return { ok: false, error: "Add the gallery link before marking the gallery ready." };
  const now = new Date().toISOString();
  const patch: Partial<PhotoGalleryRow> = { status: to, updated_at: now };
  if (to === "ready" && !gallery.ready_at) patch.ready_at = now;
  if (to === "delivered") patch.delivered_at = gallery.delivered_at ?? now;
  if (to === "created" && !gallery.created_in_pictime_at) patch.created_in_pictime_at = now;
  const { error, count } = await supabase.from("photo_galleries").update(patch, { count: "exact" }).eq("id", id).eq("owner_id", user.id);
  if (error) return { ok: false, error: error.message };
  if (!count) return { ok: false, error: "Gallery not found or you do not have access to it." };
  await writeAudit(supabase, { ownerId: user.id, actorId: user.id, entity: "gallery", entityId: id, action: "gallery.status", data: { from: gallery.status, to } });
  revalidateGalleryPaths(id, [gallery.booking_id]);
  return { ok: true, status: to };
}

/** The e-mail address a gallery notice goes to: the linked client, else the booking's customer. */
async function clientEmailFor(supabase: Client, gallery: PhotoGalleryRow, booking: BookingLite | null, ownerId: string): Promise<{ email: string | null; name: string | null }> {
  if (gallery.client_id) {
    const { data } = await supabase.from("photo_people").select("full_name,email").eq("id", gallery.client_id).eq("owner_id", ownerId).maybeSingle();
    if (data?.email) return { email: data.email, name: data.full_name };
  }
  if (booking?.customer_email) return { email: booking.customer_email, name: booking.customer_name };
  return { email: null, name: null };
}

/**
 * Queues the "Your private gallery is ready" e-mail (one per gallery, honours
 * the owner's "Gallery ready" switch). Vendor-free wording; the button opens
 * the gallery link. Returns what happened in owner words.
 */
async function queueGalleryEmail(supabase: Client, gallery: PhotoGalleryRow, booking: BookingLite | null, ownerId: string, now: Date): Promise<{ notified: boolean; reason?: string }> {
  const to = await clientEmailFor(supabase, gallery, booking, ownerId);
  if (!to.email || !isValidEmail(to.email)) return { notified: false, reason: "No e-mail address on file for this client, so nothing was sent." };
  if (!gallery.pictime_url) return { notified: false, reason: "The gallery has no link, so nothing was sent." };
  const studio = await loadStudio();
  const businessName = studio?.business_name ?? "Blue Belt Media";
  const facts: Array<[string, string]> = [["Gallery", gallery.name]];
  if (booking?.public_ref) facts.push(["Booking reference", booking.public_ref]);
  if (booking?.athlete_name) facts.push(["Coverage for", booking.athlete_name]);
  if (gallery.event_id) {
    const { data: ev } = await supabase.from("photo_events").select("name").eq("id", gallery.event_id).maybeSingle();
    if (ev?.name) facts.push(["Event", ev.name]);
  }
  const balanceDue = booking && booking.balance_state === "due" && Number(booking.balance_qr) > 0;
  const draft = buildEmail(to.email, {
    kind: "GALLERY_READY",
    subject: `Your private gallery is ready${booking?.public_ref ? ` (${booking.public_ref})` : ""}`,
    greeting: `Hi ${to.name?.split(/\s+/)[0] || "there"},`,
    paragraphs: [
      `Your photos from ${businessName} are ready in your private online gallery.`,
      "Open the gallery with the button below. You can view and buy photos there.",
      ...(balanceDue ? [`The remaining balance of ${formatQr(booking.balance_qr)} is now due. You will receive a payment link for it.`] : []),
    ],
    cta: { label: "View your gallery", url: gallery.pictime_url },
    facts,
    businessName,
  });
  const res = await enqueueClientEmail(supabase, { ownerId, kind: "GALLERY_READY", alertKey: `email:gallery:${gallery.id}:ready`, draft, personId: gallery.client_id, bookingId: gallery.booking_id, now });
  if (!res.ok) return { notified: false, reason: `The e-mail could not be queued: ${res.error}` };
  if (res.queued) return { notified: true };
  if (res.reason === "duplicate") return { notified: true, reason: "The client was already e-mailed about this gallery; no second message was sent." };
  if (res.reason === "disabled_by_owner") return { notified: false, reason: "“Gallery ready” e-mails are switched off under Notifications, so the client was not e-mailed." };
  return { notified: false, reason: "The client's e-mail address is not valid, so nothing was sent." };
}

/**
 * Marks a gallery ready for the client. With notifyClient the client gets
 * the gallery link by e-mail. The booking is NOT delivered and the balance
 * does NOT become due here: that is the explicit "Deliver gallery" action.
 */
export async function markGalleryReady(id: string, opts: { notifyClient: boolean }): Promise<GalleryActionResult> {
  if (!isUuid(id)) return { ok: false, error: "Invalid gallery id." };
  const notifyClient = opts?.notifyClient === true;
  const { supabase, user } = await currentUser();
  if (!user) return { ok: false, error: "You are signed out." };
  const gallery = await ownedGallery(supabase, id, user.id);
  if (!gallery) return { ok: false, error: "Gallery not found or you do not have access to it." };
  if (!gallery.pictime_url) return { ok: false, error: "Add the gallery link before marking the gallery ready." };
  if (gallery.status === "delivered") return { ok: false, error: "This gallery is already delivered." };
  if (gallery.status !== "ready" && !canTransitionGallery(gallery.status, "ready")) return { ok: false, error: `A gallery cannot go from “${gallery.status}” to “ready”.` };

  const now = new Date();
  const iso = now.toISOString();
  if (gallery.status !== "ready") {
    const { error, count } = await supabase.from("photo_galleries").update({ status: "ready", ready_at: gallery.ready_at ?? iso, updated_at: iso }, { count: "exact" }).eq("id", id).eq("owner_id", user.id);
    if (error) return { ok: false, error: error.message };
    if (!count) return { ok: false, error: "Gallery not found or you do not have access to it." };
  }
  const booking = await ownedBooking(supabase, gallery.booking_id, user.id);
  const galleryUrl = `${siteUrl()}/galleries/${id}`;

  await enqueueOwnerTelegram(supabase, {
    ownerId: user.id,
    kind: "GALLERY_READY",
    alertKey: `gallery:${id}:ready`,
    title: `Gallery ready: ${gallery.name}`,
    lines: [booking ? `Booking ${booking.public_ref ?? ""} · ${booking.athlete_name}`.trim() : null, notifyClient ? "Client e-mail requested." : "Client not e-mailed.", "Deliver the gallery from the booking page to make the final balance due."],
    url: galleryUrl,
  });

  let notified = false;
  let notifyReason: string | undefined;
  if (notifyClient) {
    const out = await queueGalleryEmail(supabase, gallery, booking, user.id, now);
    notified = out.notified;
    notifyReason = out.reason;
    if (notified) {
      await supabase.from("photo_galleries").update({ notified_at: gallery.notified_at ?? iso, updated_at: iso }).eq("id", id).eq("owner_id", user.id);
      await writeAudit(supabase, { ownerId: user.id, actorId: user.id, entity: "gallery", entityId: id, action: "gallery.notified", data: { via: "ready" } });
    }
  }
  await writeAudit(supabase, { ownerId: user.id, actorId: user.id, entity: "gallery", entityId: id, action: "gallery.ready", data: { from: gallery.status, notifyClient, notified } });
  revalidateGalleryPaths(id, [gallery.booking_id]);
  return { ok: true, status: "ready", notified, notifyReason };
}

/**
 * EXPLICIT owner action "Deliver gallery": the gallery becomes delivered,
 * the booking becomes delivered (gallery_delivered_at, delivered_at) and the
 * remaining balance becomes due (only when there is one). The final payment
 * link is NOT created and NOT sent here. The client e-mail ("Your private
 * gallery is ready") is sent only when `notifyClient` is ticked (off by
 * default).
 */
export async function deliverGallery(id: string, opts: { notifyClient?: boolean } = {}): Promise<GalleryActionResult> {
  if (!isUuid(id)) return { ok: false, error: "Invalid gallery id." };
  const notifyClient = opts.notifyClient === true;
  const { supabase, user } = await currentUser();
  if (!user) return { ok: false, error: "You are signed out." };
  const gallery = await ownedGallery(supabase, id, user.id);
  if (!gallery) return { ok: false, error: "Gallery not found or you do not have access to it." };
  if (!gallery.pictime_url) return { ok: false, error: "Add the gallery link before delivering the gallery." };
  if (gallery.status === "delivered") return { ok: false, error: "This gallery is already delivered." };
  const booking = await ownedBooking(supabase, gallery.booking_id, user.id);
  if (booking?.booking_status === "cancelled") return { ok: false, error: "This booking is cancelled." };
  if (booking && ["inquiry", "quoted", "awaiting_contract", "awaiting_payment"].includes(booking.booking_status)) return { ok: false, error: "Confirm the booking before delivering the gallery." };

  const now = new Date();
  const iso = now.toISOString();
  const { error, count } = await supabase.from("photo_galleries").update({ status: "delivered", ready_at: gallery.ready_at ?? iso, delivered_at: gallery.delivered_at ?? iso, updated_at: iso }, { count: "exact" }).eq("id", id).eq("owner_id", user.id);
  if (error) return { ok: false, error: error.message };
  if (!count) return { ok: false, error: "Gallery not found or you do not have access to it." };

  let balanceDue = false;
  let deliveredBooking: BookingLite | null = booking;
  if (booking) {
    const { balanceBecameDue, ...cols } = deliveryColumns(booking, now);
    const { data } = await supabase.from("photo_bookings").update({ ...cols, updated_at: iso }).eq("id", booking.id).eq("owner_id", user.id).select(BOOKING_COLS).maybeSingle();
    deliveredBooking = (data as BookingLite | null) ?? { ...booking, ...cols };
    balanceDue = balanceBecameDue;
    if (cols.booking_status === "delivered") await writeAudit(supabase, { ownerId: user.id, actorId: user.id, entity: "booking", entityId: booking.id, action: "booking.status", data: { from: booking.booking_status, to: "delivered", via: "gallery" } });
    if (balanceBecameDue) await writeAudit(supabase, { ownerId: user.id, actorId: user.id, entity: "booking", entityId: booking.id, action: "balance.due", data: { balance_qr: Number(booking.balance_qr), currency: booking.currency, gallery_id: id } });
  }
  await writeAudit(supabase, { ownerId: user.id, actorId: user.id, entity: "gallery", entityId: id, action: "gallery.delivered", data: { bookingId: booking?.id ?? null, notifyClient, balanceDue } });
  if (booking) await writeAudit(supabase, { ownerId: user.id, actorId: user.id, entity: "booking", entityId: booking.id, action: "gallery.delivered", data: { gallery_id: id, notifyClient, balanceDue } });

  let notified = false;
  let notifyReason: string | undefined;
  if (notifyClient) {
    const out = await queueGalleryEmail(supabase, gallery, deliveredBooking, user.id, now);
    notified = out.notified;
    notifyReason = out.reason;
    if (notified) {
      await supabase.from("photo_galleries").update({ notified_at: gallery.notified_at ?? iso, updated_at: iso }).eq("id", id).eq("owner_id", user.id);
      await writeAudit(supabase, { ownerId: user.id, actorId: user.id, entity: "gallery", entityId: id, action: "gallery.notified", data: { via: "delivered" } });
    }
  }
  await enqueueOwnerTelegram(supabase, {
    ownerId: user.id,
    kind: "DELIVERY_SENT",
    alertKey: `gallery:${id}:delivered`,
    title: `Gallery delivered: ${gallery.name}`,
    lines: [booking ? `Booking ${booking.public_ref ?? ""} · ${booking.athlete_name}`.trim() : null, balanceDue && deliveredBooking ? `Final balance due: ${formatQr(deliveredBooking.balance_qr)}. Create the payment link from the booking page.` : "No final balance to collect.", notified ? "Client e-mailed." : "Client not e-mailed."],
    url: booking ? `${siteUrl()}/bookings/${booking.id}` : `${siteUrl()}/galleries/${id}`,
    now,
  });
  revalidateGalleryPaths(id, [gallery.booking_id]);
  return { ok: true, status: "delivered", notified, notifyReason, balanceDue };
}

/** Owner marks a gallery delivered by hand (told the client some other way). Same effect as deliverGallery without the e-mail. */
export async function markGalleryDelivered(id: string): Promise<GalleryActionResult> {
  return deliverGallery(id, { notifyClient: false });
}

export async function deleteGallery(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isUuid(id)) return { ok: false, error: "Invalid gallery id." };
  const { supabase, user } = await currentUser();
  if (!user) return { ok: false, error: "You are signed out." };
  const gallery = await ownedGallery(supabase, id, user.id);
  if (!gallery) return { ok: false, error: "Gallery not found or you do not have access to it." };
  await supabase.from("photo_bookings").update({ gallery_id: null }).eq("owner_id", user.id).eq("gallery_id", id);
  const { error, count } = await supabase.from("photo_galleries").delete({ count: "exact" }).eq("id", id).eq("owner_id", user.id);
  if (error) return { ok: false, error: error.message };
  if (!count) return { ok: false, error: "Gallery not found or you do not have access to it." };
  await writeAudit(supabase, { ownerId: user.id, actorId: user.id, entity: "gallery", entityId: id, action: "gallery.deleted", data: { name: gallery.name, bookingId: gallery.booking_id } });
  revalidateGalleryPaths(null, [gallery.booking_id]);
  redirect("/galleries");
}
