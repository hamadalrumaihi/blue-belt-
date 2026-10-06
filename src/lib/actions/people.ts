"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { writeAudit } from "@/lib/audit";
import { parsePersonForm } from "@/lib/people/form";
import { requireStudioUser } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/validation";

/** Owner actions for CRM people (user client, RLS). */
export type PersonFormState = { error?: string; fieldErrors?: Record<string, string> } | null;
export type PersonActionResult = { ok: true } | { ok: false; error: string };

const PG_UNIQUE_VIOLATION = "23505";

async function owner() {
  const supabase = await createClient();
  // Studio team only: a client-portal account gets `user: null` here, which every
  // caller turns into a clear error. RLS (photo_is_studio_user) enforces the same.
  const guard = await requireStudioUser();
  const user = guard.ok ? ({ id: guard.viewer.userId, email: guard.viewer.email } as { id: string; email: string | null }) : null;
  return { supabase, user };
}

function revalidatePeople(id?: string | null) {
  revalidatePath("/people");
  revalidatePath("/bookings");
  if (id) revalidatePath(`/people/${id}`);
}

export async function createPerson(_prev: PersonFormState, formData: FormData): Promise<PersonFormState> {
  const { supabase, user } = await owner();
  if (!user) return { error: "You are signed out." };
  const { fieldErrors, values } = parsePersonForm(formData);
  if (Object.keys(fieldErrors).length) return { fieldErrors };
  const { data, error } = await supabase.from("photo_people").insert({ ...values, owner_id: user.id, source: "manual" }).select("id").single();
  if (error) return error.code === PG_UNIQUE_VIOLATION ? { fieldErrors: { email: "A client with this e-mail already exists." } } : { error: error.message };
  await writeAudit(supabase, { ownerId: user.id, actorId: user.id, entity: "person", entityId: data.id, action: "person.created", data: { kind: values.kind } });
  revalidatePeople(data.id);
  redirect(`/people/${data.id}`);
}

export async function updatePerson(id: string, _prev: PersonFormState, formData: FormData): Promise<PersonFormState> {
  if (!isUuid(id)) return { error: "Invalid client." };
  const { supabase, user } = await owner();
  if (!user) return { error: "You are signed out." };
  const { fieldErrors, values } = parsePersonForm(formData);
  if (Object.keys(fieldErrors).length) return { fieldErrors };
  const { data, error } = await supabase.from("photo_people").update(values).eq("id", id).eq("owner_id", user.id).select("id").maybeSingle();
  if (error) return error.code === PG_UNIQUE_VIOLATION ? { fieldErrors: { email: "Another client already uses this e-mail." } } : { error: error.message };
  if (!data) return { error: "Client not found." };
  // Keep the denormalised contact on their bookings in step so receipts and e-mails use the current details.
  await supabase.from("photo_bookings").update({ customer_name: values.full_name, customer_email: values.email ?? "", customer_phone: values.phone ?? "" }).eq("client_id", id).eq("owner_id", user.id);
  await writeAudit(supabase, { ownerId: user.id, actorId: user.id, entity: "person", entityId: id, action: "person.updated", data: {} });
  revalidatePeople(id);
  redirect(`/people/${id}`);
}

/** Refuses while bookings reference the person: their history must stay intact. */
export async function deletePerson(id: string): Promise<PersonActionResult> {
  if (!isUuid(id)) return { ok: false, error: "Invalid client." };
  const { supabase, user } = await owner();
  if (!user) return { ok: false, error: "You are signed out." };
  const { count: bookings } = await supabase.from("photo_bookings").select("id", { count: "exact", head: true }).eq("client_id", id);
  if (bookings) return { ok: false, error: `This client has ${bookings} booking${bookings === 1 ? "" : "s"}. Cancel or reassign them first.` };
  const { error, count } = await supabase.from("photo_people").delete({ count: "exact" }).eq("id", id).eq("owner_id", user.id);
  if (error) return { ok: false, error: error.message };
  if (!count) return { ok: false, error: "Client not found." };
  await writeAudit(supabase, { ownerId: user.id, actorId: user.id, entity: "person", entityId: id, action: "person.deleted", data: {} });
  revalidatePeople();
  redirect("/people");
}
