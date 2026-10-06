"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { writeAudit } from "@/lib/audit";
import { parseOrganizationForm } from "@/lib/organizations/form";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/validation";

/** Owner actions for teams / clubs (user client, RLS). */
export type OrganizationFormState = { error?: string; fieldErrors?: Record<string, string> } | null;
export type OrganizationActionResult = { ok: true } | { ok: false; error: string };

async function owner() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return { supabase, user };
}

function revalidateClubs(id?: string | null) {
  revalidatePath("/clubs");
  revalidatePath("/bookings");
  if (id) revalidatePath(`/clubs/${id}`);
}

async function contactExists(supabase: Awaited<ReturnType<typeof createClient>>, id: string | null): Promise<boolean> {
  if (!id) return true;
  const { data } = await supabase.from("photo_people").select("id").eq("id", id).maybeSingle();
  return Boolean(data);
}

export async function createOrganization(_prev: OrganizationFormState, formData: FormData): Promise<OrganizationFormState> {
  const { supabase, user } = await owner();
  if (!user) return { error: "You are signed out." };
  const { fieldErrors, values } = parseOrganizationForm(formData);
  if (Object.keys(fieldErrors).length) return { fieldErrors };
  if (!(await contactExists(supabase, values.primary_contact_id))) return { fieldErrors: { primary_contact_id: "That contact was not found." } };
  const { data, error } = await supabase.from("photo_organizations").insert({ ...values, owner_id: user.id }).select("id").single();
  if (error) return { error: error.message };
  await writeAudit(supabase, { ownerId: user.id, actorId: user.id, entity: "organization", entityId: data.id, action: "organization.created", data: { kind: values.kind } });
  revalidateClubs(data.id);
  redirect(`/clubs/${data.id}`);
}

export async function updateOrganization(id: string, _prev: OrganizationFormState, formData: FormData): Promise<OrganizationFormState> {
  if (!isUuid(id)) return { error: "Invalid team or club." };
  const { supabase, user } = await owner();
  if (!user) return { error: "You are signed out." };
  const { fieldErrors, values } = parseOrganizationForm(formData);
  if (Object.keys(fieldErrors).length) return { fieldErrors };
  if (!(await contactExists(supabase, values.primary_contact_id))) return { fieldErrors: { primary_contact_id: "That contact was not found." } };
  const { data, error } = await supabase.from("photo_organizations").update(values).eq("id", id).eq("owner_id", user.id).select("id").maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: "Team or club not found." };
  await writeAudit(supabase, { ownerId: user.id, actorId: user.id, entity: "organization", entityId: id, action: "organization.updated", data: {} });
  revalidateClubs(id);
  redirect(`/clubs/${id}`);
}

/** Refuses while bookings reference the organisation. */
export async function deleteOrganization(id: string): Promise<OrganizationActionResult> {
  if (!isUuid(id)) return { ok: false, error: "Invalid team or club." };
  const { supabase, user } = await owner();
  if (!user) return { ok: false, error: "You are signed out." };
  const { count: bookings } = await supabase.from("photo_bookings").select("id", { count: "exact", head: true }).eq("organization_id", id);
  if (bookings) return { ok: false, error: `This club has ${bookings} booking${bookings === 1 ? "" : "s"}. Reassign them first.` };
  const { error, count } = await supabase.from("photo_organizations").delete({ count: "exact" }).eq("id", id).eq("owner_id", user.id);
  if (error) return { ok: false, error: error.message };
  if (!count) return { ok: false, error: "Team or club not found." };
  await writeAudit(supabase, { ownerId: user.id, actorId: user.id, entity: "organization", entityId: id, action: "organization.deleted", data: {} });
  revalidateClubs();
  redirect("/clubs");
}
