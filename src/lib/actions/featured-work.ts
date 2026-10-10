"use server";

import { revalidatePath } from "next/cache";
import { writeAudit } from "@/lib/audit";
import { normalizeFeaturedWork, type FeaturedWork } from "@/lib/photos/featured";
import { isServiceSlot, type Manifest } from "@/lib/photos/manifest";
import { requireStudioUser } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/database.types";
import { isPlainObject } from "@/lib/validation";
import manifestJson from "../../../public/photos/manifest.json";

const manifest = manifestJson as unknown as Manifest;

export type FeaturedWorkResult = { ok: true; published: boolean } | { ok: false; error: string };

function parse(input: unknown): FeaturedWork | null {
  if (!isPlainObject(input)) return null;
  const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const services: FeaturedWork["services"] = {};
  if (isPlainObject(input.services)) for (const [k, v] of Object.entries(input.services)) if (isServiceSlot(k)) services[k] = strs(v);
  const alt: Record<string, string> = {};
  if (isPlainObject(input.alt)) for (const [k, v] of Object.entries(input.alt)) if (typeof v === "string") alt[k] = v;
  return { published: input.published === true, approved: strs(input.approved), rejected: strs(input.rejected), hero: typeof input.hero === "string" ? input.hero : null, featured: strs(input.featured), services, alt };
}

/**
 * Saves the owner's approvals, order and publish switch for the curated
 * photographs. Owner only (RLS on photo_studio plus the studio-role check);
 * ids are validated against the committed manifest, so nothing outside the
 * pipeline's output can be referenced.
 */
export async function saveFeaturedWork(input: unknown): Promise<FeaturedWorkResult> {
  const gate = await requireStudioUser();
  if (!gate.ok) return { ok: false, error: gate.error };
  const parsed = parse(input);
  if (!parsed) return { ok: false, error: "The selection could not be read. Reload the page and try again." };
  const work = normalizeFeaturedWork(parsed, manifest);
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You are signed out." };
  const { data: row } = await supabase.from("photo_studio").select("settings").eq("owner_id", user.id).maybeSingle();
  if (!row) return { ok: false, error: "Save your public site settings first (Settings > Public site), then come back here." };
  const previous = isPlainObject(row.settings) ? row.settings : {};
  const settings = { ...previous, featuredWork: work } as unknown as Json;
  const { error } = await supabase.from("photo_studio").update({ settings }).eq("owner_id", user.id);
  if (error) return { ok: false, error: error.message };
  await writeAudit(supabase, { ownerId: user.id, actorId: user.id, entity: "studio", entityId: user.id, action: work.published ? "featured_work.published" : "featured_work.saved", data: { approved: work.approved.length, rejected: work.rejected.length, hero: work.hero } });
  for (const p of ["/", "/services", "/featured-work"]) revalidatePath(p);
  return { ok: true, published: work.published };
}
