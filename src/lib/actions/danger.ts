"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "./types";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/validation";

/**
 * Destructive operations. Nothing here runs automatically: every call comes
 * from an explicit confirmation dialog. Rows cascade (event -> athletes ->
 * matches -> history) and RLS limits everything to the signed-in owner.
 *
 * Every step checks its error and the action reports the first failure, so a
 * partially applied delete is never reported as success. Where two steps are
 * needed (delete rows, then reset watch state) the second step is a
 * best-effort cleanup that is reported separately if it fails.
 */

const RESET_WATCH_STATE = {
  last_checked_at: null,
  last_attempt_at: null,
  last_success_at: null,
  consecutive_failures: 0,
  last_watch_status: null,
  last_watch_code: null,
  last_watch_message: null,
  last_watch_strategy: null,
  last_source_status: null,
  last_final_url: null,
  last_elapsed_ms: null,
} as const;

function revalidateAll() {
  for (const p of ["/dashboard", "/events", "/clients", "/watcher", "/history", "/settings/danger"]) revalidatePath(p);
}

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

/** Deletes tracked matches + history for one athlete (keeps the client). */
export async function deleteMatchDataForAthlete(athleteId: string): Promise<ActionState> {
  if (!isUuid(athleteId)) return { error: "Invalid client id." };
  const { supabase, user } = await requireUser();
  if (!user) return { error: "You are signed out." };

  const { error, count } = await supabase.from("photo_matches").delete({ count: "exact" }).eq("athlete_id", athleteId);
  if (error) return { error: `Could not delete match data: ${error.message}` };
  const reset = await supabase.from("photo_athletes").update(RESET_WATCH_STATE).eq("id", athleteId);
  if (reset.error) return { error: `Deleted ${count ?? 0} match row(s) but could not reset the client's watch state: ${reset.error.message}` };
  revalidateAll();
  revalidatePath(`/clients/${athleteId}`);
  return null;
}

/** Deletes all tracked matches + history for an event (keeps event + clients). */
export async function deleteMatchDataForEvent(eventId: string): Promise<ActionState> {
  if (!isUuid(eventId)) return { error: "Invalid event id." };
  const { supabase, user } = await requireUser();
  if (!user) return { error: "You are signed out." };

  const { data: athletes, error: aErr } = await supabase.from("photo_athletes").select("id").eq("event_id", eventId);
  if (aErr) return { error: `Could not load the event's clients: ${aErr.message}` };
  const ids = (athletes ?? []).map((a) => a.id);
  if (ids.length) {
    const { error, count } = await supabase.from("photo_matches").delete({ count: "exact" }).in("athlete_id", ids);
    if (error) return { error: `Could not delete match data: ${error.message}` };
    const reset = await supabase.from("photo_athletes").update(RESET_WATCH_STATE).in("id", ids);
    if (reset.error) return { error: `Deleted ${count ?? 0} match row(s) but could not reset watch state: ${reset.error.message}` };
  }
  revalidateAll();
  revalidatePath(`/events/${eventId}`);
  return null;
}

/** Deletes every match row (and cascaded history) the user owns. */
export async function deleteAllMatchData(): Promise<ActionState> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "You are signed out." };
  const { error, count } = await supabase.from("photo_matches").delete({ count: "exact" }).eq("owner_id", user.id);
  if (error) return { error: `Could not delete match data: ${error.message}` };
  const reset = await supabase.from("photo_athletes").update(RESET_WATCH_STATE).eq("owner_id", user.id);
  if (reset.error) return { error: `Deleted ${count ?? 0} match row(s) but could not reset watch state: ${reset.error.message}` };
  revalidateAll();
  return null;
}

export async function deleteAthlete(athleteId: string): Promise<ActionState> {
  if (!isUuid(athleteId)) return { error: "Invalid client id." };
  const { supabase, user } = await requireUser();
  if (!user) return { error: "You are signed out." };
  const { error, count } = await supabase.from("photo_athletes").delete({ count: "exact" }).eq("id", athleteId);
  if (error) return { error: `Could not delete the client: ${error.message}` };
  if (!count) return { error: "Client not found (it may already be deleted)." };
  revalidateAll();
  redirect("/clients");
}

/** Deletes a tournament with all its clients, matches and history. Requires typed confirmation. */
export async function deleteEvent(eventId: string, confirmation: string): Promise<ActionState> {
  if (confirmation !== "DELETE") return { error: "Type DELETE to confirm." };
  if (!isUuid(eventId)) return { error: "Invalid event id." };
  const { supabase, user } = await requireUser();
  if (!user) return { error: "You are signed out." };
  const { error, count } = await supabase.from("photo_events").delete({ count: "exact" }).eq("id", eventId);
  if (error) return { error: `Could not delete the event: ${error.message}` };
  if (!count) return { error: "Event not found (it may already be deleted)." };
  revalidateAll();
  redirect("/events");
}

/** Wipes every Tournament Watcher row owned by the user. Requires typed confirmation. */
export async function deleteEverything(confirmation: string): Promise<ActionState> {
  if (confirmation !== "DELETE") return { error: "Type DELETE to confirm." };
  const { supabase, user } = await requireUser();
  if (!user) return { error: "You are signed out." };

  // Athletes without an event do not cascade from events, so delete both.
  // Each step is checked; a failure after the first step is reported as partial.
  const first = await supabase.from("photo_events").delete({ count: "exact" }).eq("owner_id", user.id);
  if (first.error) return { error: `Could not delete events: ${first.error.message}` };
  const second = await supabase.from("photo_athletes").delete({ count: "exact" }).eq("owner_id", user.id);
  if (second.error) return { error: `Deleted ${first.count ?? 0} event(s) but could not delete remaining clients: ${second.error.message}` };
  const third = await supabase.from("photo_match_history").delete({ count: "exact" }).eq("owner_id", user.id);
  if (third.error) return { error: `Deleted events and clients but could not clear remaining history: ${third.error.message}` };
  revalidateAll();
  redirect("/dashboard");
}
