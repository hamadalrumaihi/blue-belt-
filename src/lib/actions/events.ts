"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isValidTimeZone } from "@/lib/time";
import { isPlatform } from "@/lib/types";
import { isValidHttpUrl, trimOrNull } from "@/lib/utils";
import { isUuid, isValidCalendarDate } from "@/lib/validation";

import { FIRST_EVENT } from "@/lib/first-event";
import type { ActionState } from "./types";

function parseEventForm(formData: FormData) {
  const fieldErrors: Record<string, string> = {};
  const name = trimOrNull(formData.get("name"));
  const platform = trimOrNull(formData.get("platform")) ?? "";
  const timezone = trimOrNull(formData.get("timezone")) ?? "Asia/Qatar";
  const source_url = trimOrNull(formData.get("source_url"));
  const event_date = trimOrNull(formData.get("event_date"));

  if (!name) fieldErrors.name = "Event name is required.";
  if (!isPlatform(platform)) fieldErrors.platform = "Choose a platform.";
  if (!isValidTimeZone(timezone)) fieldErrors.timezone = "Unknown timezone.";
  if (source_url && !isValidHttpUrl(source_url)) fieldErrors.source_url = "Enter a full URL starting with https://";
  if (event_date && !isValidCalendarDate(event_date)) fieldErrors.event_date = "Enter a real date (YYYY-MM-DD).";

  return {
    fieldErrors,
    values: {
      name: name ?? "",
      platform,
      timezone,
      source_url,
      event_date,
      venue: trimOrNull(formData.get("venue")),
      country: trimOrNull(formData.get("country")),
      active: formData.get("active") === "on" || formData.get("active") === "true",
    },
  };
}

export async function createEvent(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { fieldErrors, values } = parseEventForm(formData);
  if (Object.keys(fieldErrors).length) return { fieldErrors };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "You are signed out." };

  const { data, error } = await supabase
    .from("photo_events")
    .insert({ ...values, owner_id: user.id })
    .select("id")
    .single();
  if (error) return { error: error.message };

  revalidatePath("/events");
  revalidatePath("/dashboard");
  redirect(`/events/${data.id}`);
}

export async function updateEvent(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!isUuid(id)) return { error: "Invalid event id." };
  const { fieldErrors, values } = parseEventForm(formData);
  if (Object.keys(fieldErrors).length) return { fieldErrors };

  const supabase = await createClient();
  const { error, count } = await supabase.from("photo_events").update(values, { count: "exact" }).eq("id", id);
  if (error) return { error: error.message };
  if (!count) return { error: "Event not found or you do not have access to it." };

  revalidatePath("/events");
  revalidatePath(`/events/${id}`);
  revalidatePath("/dashboard");
  redirect(`/events/${id}`);
}

export async function setEventActive(id: string, active: boolean): Promise<ActionState> {
  if (!isUuid(id)) return { error: "Invalid event id." };
  const supabase = await createClient();
  const { error, count } = await supabase.from("photo_events").update({ active }, { count: "exact" }).eq("id", id);
  if (error) return { error: error.message };
  if (!count) return { error: "Event not found or you do not have access to it." };
  revalidatePath("/events");
  revalidatePath(`/events/${id}`);
  revalidatePath("/dashboard");
  return null;
}

/** Creates the preconfigured first event if the user has no events yet. */
export async function seedFirstEvent(): Promise<ActionState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "You are signed out." };

  const { count } = await supabase.from("photo_events").select("id", { count: "exact", head: true });
  if ((count ?? 0) > 0) return { error: "You already have events." };

  const { data, error } = await supabase
    .from("photo_events")
    .insert({ ...FIRST_EVENT, owner_id: user.id })
    .select("id")
    .single();
  if (error) return { error: error.message };

  revalidatePath("/events");
  revalidatePath("/dashboard");
  redirect(`/events/${data.id}`);
}
