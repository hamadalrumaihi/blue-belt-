"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/validation";

export type IncidentActionResult = { ok: true } | { ok: false; error: string };

/**
 * Marks an issue done (or not). This is the owner's acknowledgement only: it
 * does not resolve the incident — that still happens automatically when the
 * source reads OK again — and the same problem coming back later is shown and
 * alerted afresh.
 */
export async function setIssueDone(incidentId: string, done: boolean): Promise<IncidentActionResult> {
  if (!isUuid(incidentId)) return { ok: false, error: "Invalid issue." };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You are signed out." };
  const { data, error } = await supabase
    .from("photo_incidents")
    .update({ acknowledged_at: done ? new Date().toISOString() : null })
    .eq("id", incidentId)
    .eq("owner_id", user.id)
    .select("id");
  if (error) {
    if (/acknowledged_at/.test(error.message)) return { ok: false, error: "“Done” needs the latest database update (incident acknowledge migration). Ask to apply it, then try again." };
    return { ok: false, error: error.message };
  }
  if (!data?.length) return { ok: false, error: "Issue not found." };
  revalidatePath("/issues");
  revalidatePath("/watcher");
  revalidatePath("/dashboard");
  return { ok: true };
}
