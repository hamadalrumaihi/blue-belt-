import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PublicEventOption } from "@/lib/bookings/public-form";
import type { Database } from "@/lib/supabase/database.types";
import { createServiceClient, isServiceClientConfigured } from "@/lib/supabase/service";

type Client = SupabaseClient<Database>;

/**
 * Active events of the studio owner as offered to the public booking wizard:
 * id, name and date only, nothing else leaves the studio. Read with the
 * service role because the visitor has no session; the owner id must come
 * from loadPublicStudio(), never from the browser.
 */
export async function listPublicEvents(ownerId: string, supabase?: Client): Promise<PublicEventOption[]> {
  if (!supabase && !isServiceClientConfigured()) return [];
  const client = supabase ?? createServiceClient();
  const { data } = await client.from("photo_events").select("id,name,event_date").eq("owner_id", ownerId).eq("active", true).order("event_date", { ascending: true, nullsFirst: false }).limit(50);
  return (data ?? []).map((e) => ({ id: e.id, name: e.name, event_date: e.event_date }));
}
