import "server-only";
import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient, isServiceClientConfigured } from "@/lib/supabase/service";
import type { Database, PhotoServiceRow, PhotoStudioRow } from "@/lib/supabase/database.types";
import { DEFAULT_PICTIME_GALLERY_URL, readPictimeGalleryUrl } from "@/lib/studio/site-content";

type Client = SupabaseClient<Database>;

export { DEFAULT_PICTIME_GALLERY_URL };

/**
 * The public "View and buy photos" destination: the studio's Pic-Time client
 * gallery from Settings → Public site when it is a valid https link on
 * pic-time.com or galleries.bluebelt.media, else the default. A `headless`
 * query parameter (Pic-Time's embed mode) is always stripped.
 */
export function pictimeGalleryUrl(studio: PhotoStudioRow | null): string {
  return readPictimeGalleryUrl(studio?.settings);
}

export const DEFAULT_STUDIO: Omit<PhotoStudioRow, "owner_id" | "created_at" | "updated_at"> = {
  business_name: "Blue Belt Media",
  tagline: "Combat sports photography & video",
  about: null,
  city: "Doha, Qatar",
  email: null,
  phone: null,
  whatsapp: null,
  instagram: null,
  public_booking: false,
  settings: {},
};

/** The signed-in owner's studio row (null until they save Settings → Public site). */
export const loadStudio = cache(async (): Promise<PhotoStudioRow | null> => {
  const supabase = await createClient();
  const { data } = await supabase.from("photo_studio").select("*").maybeSingle();
  return data ?? null;
});

export type PublicStudio = { studio: PhotoStudioRow; services: PhotoServiceRow[] };

/**
 * What the public website shows and who it books for. Read with the service
 * role (no session on the public site); the owner id comes from this row and
 * never from the browser. Null when no studio has opened public booking yet,
 * or when the server is not configured for it.
 */
export const loadPublicStudio = cache(async (): Promise<PublicStudio | null> => {
  if (!isServiceClientConfigured()) return null;
  const supabase = createServiceClient();
  return loadPublicStudioWith(supabase);
});

export async function loadPublicStudioWith(supabase: Client): Promise<PublicStudio | null> {
  // Single tenant. STUDIO_OWNER_ID pins which owner the public site serves;
  // otherwise the earliest studio row with public booking on. Only
  // owner/staff profiles can create studio rows (RLS: photo_is_studio_user).
  let q = supabase.from("photo_studio").select("*").eq("public_booking", true);
  const pinned = process.env.STUDIO_OWNER_ID?.trim();
  if (pinned) q = q.eq("owner_id", pinned);
  const { data: studio } = await q.order("created_at", { ascending: true }).limit(1).maybeSingle();
  if (!studio) return null;
  const { data: services } = await supabase
    .from("photo_services")
    .select("*")
    .eq("owner_id", studio.owner_id)
    .eq("active", true)
    .eq("public", true)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  return { studio, services: services ?? [] };
}

/** Owner view of every service (active or not). */
export async function listServices(): Promise<PhotoServiceRow[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("photo_services").select("*").order("sort_order", { ascending: true }).order("name", { ascending: true });
  return data ?? [];
}

/** Public site base URL for links in e-mails, Telegram and signing pages. */
export function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? process.env.APP_URL ?? "https://bluebeltmedia.vercel.app").replace(/\/$/, "");
}
