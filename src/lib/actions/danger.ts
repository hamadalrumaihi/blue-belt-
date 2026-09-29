"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "./types";
import { createClient } from "@/lib/supabase/server";

/**
 * Destructive operations. Nothing here runs automatically: every call comes
 * from an explicit confirmation dialog. Rows cascade (event -> athletes ->
 * matches -> history) and RLS limits everything to the signed-in owner.
 */

function revalidateAll() {
  for (const p of ["/dashboard", "/events", "/clients", "/watcher", "/history", "/settings/danger"]) revalidatePath(p);
}

/** Deletes tracked matches + history for one athlete (keeps the client). */
export async function deleteMatchDataForAthlete(athleteId: string): Promise<ActionState> {
  const supabase = await createClient();
  const { error } = await supabase.from("photo_matches").delete().eq("athlete_id", athleteId);
  if (error) return { error: error.message };
  await supabase.from("photo_athletes").update({ last_checked_at: null, last_watch_status: null, last_watch_message: null }).eq("id", athleteId);
  revalidateAll();
  revalidatePath(`/clients/${athleteId}`);
  return null;
}

/** Deletes all tracked matches + history for an event (keeps event + clients). */
export async function deleteMatchDataForEvent(eventId: string): Promise<ActionState> {
  const supabase = await createClient();
  const { data: athletes, error: aErr } = await supabase.from("photo_athletes").select("id").eq("event_id", eventId);
  if (aErr) return { error: aErr.message };
  const ids = (athletes ?? []).map((a) => a.id);
  if (ids.length) {
    const { error } = await supabase.from("photo_matches").delete().in("athlete_id", ids);
    if (error) return { error: error.message };
    await supabase.from("photo_athletes").update({ last_checked_at: null, last_watch_status: null, last_watch_message: null }).in("id", ids);
  }
  revalidateAll();
  revalidatePath(`/events/${eventId}`);
  return null;
}

/** Deletes every match row (and cascaded history) the user owns. */
export async function deleteAllMatchData(): Promise<ActionState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "You are signed out." };
  const { error } = await supabase.from("photo_matches").delete().eq("owner_id", user.id);
  if (error) return { error: error.message };
  await supabase.from("photo_athletes").update({ last_checked_at: null, last_watch_status: null, last_watch_message: null }).eq("owner_id", user.id);
  revalidateAll();
  return null;
}

export async function deleteAthlete(athleteId: string): Promise<ActionState> {
  const supabase = await createClient();
  const { error } = await supabase.from("photo_athletes").delete().eq("id", athleteId);
  if (error) return { error: error.message };
  revalidateAll();
  redirect("/clients");
}

/** Deletes a tournament with all its clients, matches and history. Requires typed confirmation. */
export async function deleteEvent(eventId: string, confirmation: string): Promise<ActionState> {
  if (confirmation !== "DELETE") return { error: "Type DELETE to confirm." };
  const supabase = await createClient();
  const { error } = await supabase.from("photo_events").delete().eq("id", eventId);
  if (error) return { error: error.message };
  revalidateAll();
  redirect("/events");
}

/** Wipes every Tournament Watcher row owned by the user. Requires typed confirmation. */
export async function deleteEverything(confirmation: string): Promise<ActionState> {
  if (confirmation !== "DELETE") return { error: "Type DELETE to confirm." };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "You are signed out." };

  // Athletes without an event do not cascade from events, so delete both.
  const first = await supabase.from("photo_events").delete().eq("owner_id", user.id);
  if (first.error) return { error: first.error.message };
  const second = await supabase.from("photo_athletes").delete().eq("owner_id", user.id);
  if (second.error) return { error: second.error.message };
  revalidateAll();
  redirect("/dashboard");
}
