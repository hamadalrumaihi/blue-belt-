"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "./types";
import { createClient } from "@/lib/supabase/server";
import { isPlatform } from "@/lib/types";
import { isValidEmail, isValidHttpUrl, trimOrNull } from "@/lib/utils";
import { validateSourceUrl } from "@/lib/watchers/url-policy";

function parseClientForm(formData: FormData) {
  const fieldErrors: Record<string, string> = {};
  const name = trimOrNull(formData.get("name"));
  const phone = trimOrNull(formData.get("phone"));
  const email = trimOrNull(formData.get("email"));
  const academy = trimOrNull(formData.get("academy"));
  const event_id = trimOrNull(formData.get("event_id"));
  const platform = trimOrNull(formData.get("platform")) ?? "";
  const source_url = trimOrNull(formData.get("source_url"));

  if (!name) fieldErrors.name = "Full name is required.";
  if (!phone) fieldErrors.phone = "Phone is required.";
  if (!email) fieldErrors.email = "Email is required.";
  else if (!isValidEmail(email)) fieldErrors.email = "Enter a valid email.";
  if (!academy) fieldErrors.academy = "Academy / team is required.";
  if (!event_id) fieldErrors.event_id = "Choose an event.";
  if (!isPlatform(platform)) fieldErrors.platform = "Choose a platform.";
  if (!source_url) fieldErrors.source_url = "Player / schedule URL is required.";
  else if (!isValidHttpUrl(source_url)) fieldErrors.source_url = "Enter a full URL starting with https://";
  else if (platform !== "OTHER") {
    const policy = validateSourceUrl(source_url);
    if (!policy.ok) fieldErrors.source_url = policy.message;
    else if (policy.platform !== platform) fieldErrors.source_url = `This looks like a ${policy.platform === "AJP" ? "AJP" : "Smoothcomp"} link. Change the platform or the URL.`;
  }

  return {
    fieldErrors,
    values: {
      name: name ?? "",
      phone,
      email,
      academy,
      event_id,
      platform,
      source_url,
      division: trimOrNull(formData.get("division")),
      weight: trimOrNull(formData.get("weight")),
      belt: trimOrNull(formData.get("belt")),
      gender: trimOrNull(formData.get("gender")),
      age_category: trimOrNull(formData.get("age_category")),
      notes: trimOrNull(formData.get("notes")),
      package_name: trimOrNull(formData.get("package_name")),
      internal_notes: trimOrNull(formData.get("internal_notes")),
      active: formData.get("active") !== "off" && formData.get("active") !== "false",
    },
  };
}

export async function createAthlete(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { fieldErrors, values } = parseClientForm(formData);
  if (Object.keys(fieldErrors).length) return { fieldErrors };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "You are signed out." };

  const { data, error } = await supabase
    .from("photo_athletes")
    .insert({ ...values, owner_id: user.id })
    .select("id")
    .single();
  if (error) return { error: error.message };

  revalidateClientPaths(values.event_id);
  redirect(`/clients/${data.id}`);
}

export async function updateAthlete(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { fieldErrors, values } = parseClientForm(formData);
  if (Object.keys(fieldErrors).length) return { fieldErrors };

  const supabase = await createClient();
  const { error } = await supabase.from("photo_athletes").update(values).eq("id", id);
  if (error) return { error: error.message };

  revalidateClientPaths(values.event_id);
  revalidatePath(`/clients/${id}`);
  redirect(`/clients/${id}`);
}

export async function setAthleteActive(id: string, active: boolean): Promise<ActionState> {
  const supabase = await createClient();
  const { error } = await supabase.from("photo_athletes").update({ active }).eq("id", id);
  if (error) return { error: error.message };
  revalidateClientPaths(null);
  revalidatePath(`/clients/${id}`);
  return null;
}

function revalidateClientPaths(eventId: string | null) {
  revalidatePath("/clients");
  revalidatePath("/dashboard");
  revalidatePath("/watcher");
  if (eventId) revalidatePath(`/events/${eventId}`);
}
