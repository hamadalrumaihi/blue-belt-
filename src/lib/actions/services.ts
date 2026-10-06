"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "./types";
import { writeAudit } from "@/lib/audit";
import { DEFAULT_SERVICES, parseServiceForm } from "@/lib/services/form";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/validation";

type Result = { ok: true } | { ok: false; error: string };

function revalidateServicePaths() {
  revalidatePath("/packages");
  revalidatePath("/services");
  revalidatePath("/book");
  revalidatePath("/");
}

export async function createService(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "You are signed out." };
  const { fieldErrors, values } = parseServiceForm(formData);
  if (!values) return { fieldErrors };
  const { data, error } = await supabase.from("photo_services").insert({ ...values, owner_id: user.id }).select("id").single();
  if (error) return error.code === "23505" ? { fieldErrors: { code: "You already have a package with this code." } } : { error: error.message };
  await writeAudit(supabase, { ownerId: user.id, actorId: user.id, entity: "service", entityId: data.id, action: "service.created", data: { code: values.code } });
  revalidateServicePaths();
  redirect("/packages");
}

export async function updateService(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!isUuid(id)) return { error: "Invalid package id." };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "You are signed out." };
  const { fieldErrors, values } = parseServiceForm(formData);
  if (!values) return { fieldErrors };
  const { error, count } = await supabase.from("photo_services").update(values, { count: "exact" }).eq("id", id).eq("owner_id", user.id);
  if (error) return error.code === "23505" ? { fieldErrors: { code: "You already have a package with this code." } } : { error: error.message };
  if (!count) return { error: "Package not found or you do not have access to it." };
  await writeAudit(supabase, { ownerId: user.id, actorId: user.id, entity: "service", entityId: id, action: "service.updated", data: { code: values.code } });
  revalidateServicePaths();
  revalidatePath(`/packages/${id}/edit`);
  redirect("/packages");
}

export async function setServiceActive(id: string, active: boolean): Promise<Result> {
  if (!isUuid(id)) return { ok: false, error: "Invalid package id." };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You are signed out." };
  const { error, count } = await supabase.from("photo_services").update({ active: Boolean(active) }, { count: "exact" }).eq("id", id).eq("owner_id", user.id);
  if (error) return { ok: false, error: error.message };
  if (!count) return { ok: false, error: "Package not found or you do not have access to it." };
  await writeAudit(supabase, { ownerId: user.id, actorId: user.id, entity: "service", entityId: id, action: active ? "service.activated" : "service.archived" });
  revalidateServicePaths();
  return { ok: true };
}

export async function deleteService(id: string): Promise<Result> {
  if (!isUuid(id)) return { ok: false, error: "Invalid package id." };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You are signed out." };
  const { error, count } = await supabase.from("photo_services").delete({ count: "exact" }).eq("id", id).eq("owner_id", user.id);
  if (error) return { ok: false, error: error.code === "23503" ? "This package is used by bookings. Archive it instead." : error.message };
  if (!count) return { ok: false, error: "Package not found or you do not have access to it." };
  await writeAudit(supabase, { ownerId: user.id, actorId: user.id, entity: "service", entityId: id, action: "service.deleted" });
  revalidateServicePaths();
  return { ok: true };
}

/** Starter set for an owner with no packages yet. Prices are left as "quote" so nothing books at 0 QAR by accident. */
export async function seedDefaultServices(): Promise<Result & { inserted?: number }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You are signed out." };
  const { count, error: countError } = await supabase.from("photo_services").select("id", { count: "exact", head: true }).eq("owner_id", user.id);
  if (countError) return { ok: false, error: countError.message };
  if ((count ?? 0) > 0) return { ok: false, error: "You already have packages. Add more one by one." };
  const { error, count: inserted } = await supabase.from("photo_services").insert(DEFAULT_SERVICES.map((s) => ({ ...s, owner_id: user.id })), { count: "exact" });
  if (error) return { ok: false, error: error.message };
  await writeAudit(supabase, { ownerId: user.id, actorId: user.id, entity: "service", action: "service.seeded", data: { count: inserted ?? DEFAULT_SERVICES.length } });
  revalidateServicePaths();
  return { ok: true, inserted: inserted ?? DEFAULT_SERVICES.length };
}
