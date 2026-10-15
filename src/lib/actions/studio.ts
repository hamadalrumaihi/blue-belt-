"use server";

import { revalidatePath } from "next/cache";
import { writeAudit } from "@/lib/audit";
import { normalizeInstagram } from "@/lib/people/match";
import { requireStudioUser } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { parseGalleryHosts } from "@/lib/galleries/form";
import { isStoredStage, productionStage, settableStages, withStoredProduction, type StoredStage } from "@/lib/bookings/production";
import { normalizePictimeGalleryUrl } from "@/lib/studio/site-content";
import type { Json } from "@/lib/supabase/database.types";
import { isValidEmail, trimOrNull } from "@/lib/utils";
import { isUuid } from "@/lib/validation";

export type StudioState = { error?: string; fieldErrors?: Record<string, string>; saved?: boolean } | null;

const LIMITS = { business_name: 80, tagline: 140, about: 2000, city: 80, phone: 30, whatsapp: 30 } as const;

/**
 * Settings → Public site. Upserts the owner's photo_studio row (owner_id =
 * the signed-in user; RLS rejects anyone else). Inside `settings` jsonb only
 * `galleryHosts` and `pictimeGalleryUrl` are replaced; every other key
 * (testimonials, portfolio, ...) is kept so hand-edited website content
 * survives a save.
 */
export async function saveStudio(_prev: StudioState, formData: FormData): Promise<StudioState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "You are signed out." };
  if (!(await requireStudioUser()).ok) return { error: "This action is for the studio team only." };

  const fieldErrors: Record<string, string> = {};
  const business_name = trimOrNull(formData.get("business_name"));
  const tagline = trimOrNull(formData.get("tagline"));
  const about = trimOrNull(formData.get("about"));
  const city = trimOrNull(formData.get("city"));
  const email = trimOrNull(formData.get("email"))?.toLowerCase() ?? null;
  const phone = trimOrNull(formData.get("phone"));
  const whatsapp = trimOrNull(formData.get("whatsapp"));
  const instagramRaw = trimOrNull(formData.get("instagram"));
  const public_booking = formData.get("public_booking") === "on" || formData.get("public_booking") === "1";
  const galleryHosts = parseGalleryHosts(trimOrNull(formData.get("gallery_hosts")));
  if (galleryHosts.error) fieldErrors.gallery_hosts = galleryHosts.error;
  const pictimeRaw = trimOrNull(formData.get("pictime_gallery_url"));
  const pictimeGalleryUrl = pictimeRaw ? normalizePictimeGalleryUrl(pictimeRaw) : null;
  if (pictimeRaw && !pictimeGalleryUrl) fieldErrors.pictime_gallery_url = "Use the https link to your client gallery on pic-time.com or galleries.bluebelt.media.";

  if (!business_name) fieldErrors.business_name = "Business name is required.";
  else if (business_name.length > LIMITS.business_name) fieldErrors.business_name = `Keep it under ${LIMITS.business_name} characters.`;
  if (tagline && tagline.length > LIMITS.tagline) fieldErrors.tagline = `Keep it under ${LIMITS.tagline} characters.`;
  if (about && about.length > LIMITS.about) fieldErrors.about = `Keep it under ${LIMITS.about} characters.`;
  if (city && city.length > LIMITS.city) fieldErrors.city = `Keep it under ${LIMITS.city} characters.`;
  if (email && !isValidEmail(email)) fieldErrors.email = "Enter a valid e-mail address.";
  if (phone && (phone.length > LIMITS.phone || !/^[+\d\s().-]+$/.test(phone))) fieldErrors.phone = "Digits, spaces and + only.";
  if (whatsapp && (whatsapp.length > LIMITS.whatsapp || (whatsapp.replace(/\D/g, "").length < 8))) fieldErrors.whatsapp = "Enter the number with country code, e.g. +974 5555 5555.";
  const instagram = instagramRaw ? normalizeInstagram(instagramRaw) : null;
  if (instagramRaw && !instagram) fieldErrors.instagram = "Enter just the handle, e.g. @bluebeltmedia.";
  if (Object.keys(fieldErrors).length) return { fieldErrors };

  const { data: current } = await supabase.from("photo_studio").select("settings, updated_at").eq("owner_id", user.id).maybeSingle();
  const previous = current?.settings && typeof current.settings === "object" && !Array.isArray(current.settings) ? (current.settings as Record<string, Json | undefined>) : {};
  const merged: Record<string, Json | undefined> = { ...previous, galleryHosts: galleryHosts.hosts };
  if (pictimeGalleryUrl) merged.pictimeGalleryUrl = pictimeGalleryUrl;
  else delete merged.pictimeGalleryUrl; // empty field = back to the default client gallery
  const settings = merged as Json;
  const row = { owner_id: user.id, business_name: business_name!, tagline, about, city, email, phone, whatsapp, instagram, public_booking, settings };
  if (current) {
    // Optimistic guard: settings also carry testimonials / FAQs / media decisions saved from other pages; never overwrite a newer save.
    const { error, count } = await supabase.from("photo_studio").update(row, { count: "exact" }).eq("owner_id", user.id).eq("updated_at", current.updated_at);
    if (error) return { error: error.message };
    if (!count) return { error: "Your studio settings were changed in another tab. Reload the page and try again." };
  } else {
    const { error } = await supabase.from("photo_studio").insert(row);
    if (error) return { error: error.message };
  }
  await writeAudit(supabase, { ownerId: user.id, actorId: user.id, entity: "studio", entityId: user.id, action: "studio.saved", data: { public_booking } });
  for (const p of ["/settings", "/", "/services", "/work", "/how-it-works", "/contact", "/book", "/privacy", "/terms", "/galleries"]) revalidatePath(p);
  revalidatePath("/services", "layout");
  return { saved: true };
}

// ---------------------------------------------------------------------------
// Production board: the three stored stages (culling / editing / review)
// ---------------------------------------------------------------------------

export type ProductionStageResult = { ok: true; stage: StoredStage | null } | { ok: false; error: string };

/**
 * Set (or clear) the stored editing stage of a booking. Only the stages
 * without a column are stored, in `details.production`; the columns with a
 * real column behind them (shoot complete, gallery ready, delivered) are
 * never written here, so the board can never contradict the booking. Studio
 * user (owner or staff), audited, pages revalidated.
 */
export async function setProductionStage(bookingId: string, stage: StoredStage | null): Promise<ProductionStageResult> {
  if (!isUuid(bookingId)) return { ok: false, error: "Invalid booking." };
  if (stage !== null && !isStoredStage(stage)) return { ok: false, error: "Unknown stage." };
  const guard = await requireStudioUser();
  if (!guard.ok) return { ok: false, error: guard.error };
  const supabase = await createClient();
  const { data: booking } = await supabase.from("photo_bookings").select("id,owner_id,booking_status,coverage_done_at,delivered_at,gallery_delivered_at,balance_state,balance_qr,details,gallery_id").eq("id", bookingId).maybeSingle();
  if (!booking) return { ok: false, error: "Booking not found or you do not have access to it." };
  const gallery = booking.gallery_id
    ? (await supabase.from("photo_galleries").select("status").eq("id", booking.gallery_id).maybeSingle()).data
    : (await supabase.from("photo_galleries").select("status").eq("booking_id", booking.id).order("created_at", { ascending: false }).limit(1).maybeSingle()).data;
  const current = productionStage(booking, gallery);
  if (!current) return { ok: false, error: "This booking is not in production yet. Mark the shoot complete first." };
  if (stage && !settableStages(current).includes(stage)) return { ok: false, error: `The gallery is already ${current.stage === "ready" ? "ready" : "delivered"}; the editing stage no longer applies.` };
  const now = new Date();
  const details = withStoredProduction(booking.details, stage, now, guard.viewer.userId);
  const { error, count } = await supabase.from("photo_bookings").update({ details }, { count: "exact" }).eq("id", bookingId);
  if (error) return { ok: false, error: error.message };
  if (!count) return { ok: false, error: "Booking not found or you do not have access to it." };
  await writeAudit(supabase, { ownerId: booking.owner_id, actorId: guard.viewer.userId, actorKind: guard.viewer.role === "staff" ? "staff" : "owner", entity: "booking", entityId: bookingId, action: "booking.production_stage", data: { from: current.stage, to: stage ?? "shoot_complete" } });
  revalidatePath("/production");
  revalidatePath("/studio");
  revalidatePath(`/bookings/${bookingId}`);
  return { ok: true, stage };
}
