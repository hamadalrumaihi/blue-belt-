import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./supabase/database.types";

/**
 * Explicit authorization boundaries for Server Actions.
 *
 * RLS already hides other owners' rows, but a silent "0 rows updated" reads
 * like success to the caller. These helpers make the boundary visible: an
 * action either confirms the signed-in user owns the row or returns a clear
 * error. When lightweight sharing (photo_event_members: owner / photographer
 * / assistant) is switched on, this is the one place that grows a role check.
 */
type Client = SupabaseClient<Database>;

export type Authz = { ok: true; ownerId: string } | { ok: false; error: string };

export async function requireOwnedEvent(supabase: Client, eventId: string): Promise<Authz> {
  const { data, error } = await supabase.from("photo_events").select("owner_id").eq("id", eventId).maybeSingle();
  if (error) return { ok: false, error: `Could not verify the event: ${error.message}` };
  if (!data) return { ok: false, error: "Event not found or you do not have access to it." };
  return { ok: true, ownerId: data.owner_id };
}

export async function requireOwnedAthlete(supabase: Client, athleteId: string): Promise<Authz & { eventId?: string | null }> {
  const { data, error } = await supabase.from("photo_athletes").select("owner_id,event_id").eq("id", athleteId).maybeSingle();
  if (error) return { ok: false, error: `Could not verify the client: ${error.message}` };
  if (!data) return { ok: false, error: "Client not found or you do not have access to it." };
  return { ok: true, ownerId: data.owner_id, eventId: data.event_id };
}
