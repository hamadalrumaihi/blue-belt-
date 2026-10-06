"use server";

import { revalidatePath } from "next/cache";
import { writeAudit } from "@/lib/audit";
import { normalizeInstagram } from "@/lib/people/match";
import { requireStudioUser } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { isValidEmail, trimOrNull } from "@/lib/utils";

export type StudioState = { error?: string; fieldErrors?: Record<string, string>; saved?: boolean } | null;

const LIMITS = { business_name: 80, tagline: 140, about: 2000, city: 80, phone: 30, whatsapp: 30 } as const;

/**
 * Settings → Public site. Upserts the owner's photo_studio row (owner_id =
 * the signed-in user; RLS rejects anyone else). `settings` jsonb is left
 * untouched so hand-edited website content survives a save.
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

  const { error } = await supabase
    .from("photo_studio")
    .upsert({ owner_id: user.id, business_name: business_name!, tagline, about, city, email, phone, whatsapp, instagram, public_booking }, { onConflict: "owner_id" });
  if (error) return { error: error.message };
  await writeAudit(supabase, { ownerId: user.id, actorId: user.id, entity: "studio", entityId: user.id, action: "studio.saved", data: { public_booking } });
  for (const p of ["/settings", "/", "/services", "/portfolio", "/contact", "/book", "/privacy", "/terms"]) revalidatePath(p);
  return { saved: true };
}
