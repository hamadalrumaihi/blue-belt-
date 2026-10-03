"use server";

import { revalidatePath } from "next/cache";
import { requireOwnedAthlete, requireOwnedEvent } from "@/lib/authz";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient, isServiceClientConfigured } from "@/lib/supabase/service";
import { isValidEmail } from "@/lib/utils";
import { isUuid } from "@/lib/validation";

/**
 * Photo/video coverage + collaboration actions.
 *
 * Completion flips go through the photo_set_coverage_done RPC, which enforces
 * in the database that only the assigned collaborator for that kind — or the
 * event owner — may change it. Assignment and invitations are owner-only,
 * enforced by requireOwnedEvent / requireOwnedAthlete plus the coverage table's
 * owner RLS. Nothing here widens access to clients or contact details.
 */
export type CoverageResult = { ok: true } | { ok: false; error: string };
export type CoverageKind = "photo" | "video";

/** Owner-only: make sure a coverage row exists for an athlete so it can be assigned / completed. */
async function ensureRow(supabase: Awaited<ReturnType<typeof createClient>>, athleteId: string): Promise<CoverageResult & { eventId?: string }> {
  const owned = await requireOwnedAthlete(supabase, athleteId);
  if (!owned.ok) return { ok: false, error: owned.error };
  if (!owned.eventId) return { ok: false, error: "This client is not attached to an event." };
  const { error } = await supabase.from("photo_coverage").upsert({ athlete_id: athleteId, event_id: owned.eventId }, { onConflict: "athlete_id" });
  if (error) return { ok: false, error: error.message };
  return { ok: true, eventId: owned.eventId };
}

/** Flip Photos done / Video done. Works for the assigned collaborator or the owner. */
export async function setCoverageDone(athleteId: string, kind: CoverageKind, done: boolean): Promise<CoverageResult> {
  if (!isUuid(athleteId)) return { ok: false, error: "Invalid client id." };
  if (kind !== "photo" && kind !== "video") return { ok: false, error: "Invalid coverage kind." };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You are signed out." };

  let res = await supabase.rpc("photo_set_coverage_done", { p_athlete_id: athleteId, p_kind: kind, p_done: done });
  if (res.error) {
    // No coverage row yet: an owner toggling before assigning. Create it, then retry.
    const ensured = await ensureRow(supabase, athleteId);
    if (!ensured.ok) return { ok: false, error: friendly(res.error.message) };
    res = await supabase.rpc("photo_set_coverage_done", { p_athlete_id: athleteId, p_kind: kind, p_done: done });
    if (res.error) return { ok: false, error: friendly(res.error.message) };
  }
  revalidatePath(`/clients/${athleteId}`);
  revalidatePath("/coverage");
  revalidatePath("/dashboard");
  return { ok: true };
}

/** Owner-only: assign (or clear) the photographer and/or videographer for a client. */
export async function assignCoverage(athleteId: string, input: { photographerId?: string | null; videographerId?: string | null }): Promise<CoverageResult> {
  if (!isUuid(athleteId)) return { ok: false, error: "Invalid client id." };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You are signed out." };
  const ensured = await ensureRow(supabase, athleteId);
  if (!ensured.ok) return ensured;

  const patch: { photographer_id?: string | null; videographer_id?: string | null } = {};
  for (const key of ["photographerId", "videographerId"] as const) {
    const val = input[key];
    if (val === undefined) continue;
    if (val !== null && !isUuid(val)) return { ok: false, error: "Invalid assignee." };
    if (val) {
      // The assignee must be a member of the event (owner isolation + sane assignment).
      const { data: member } = await supabase.from("photo_event_members").select("user_id").eq("event_id", ensured.eventId!).eq("user_id", val).maybeSingle();
      if (!member) return { ok: false, error: "That person is not a collaborator on this event yet. Invite them first." };
    }
    if (key === "photographerId") patch.photographer_id = val;
    else patch.videographer_id = val;
  }
  if (Object.keys(patch).length) {
    const { error } = await supabase.from("photo_coverage").update(patch).eq("athlete_id", athleteId);
    if (error) return { ok: false, error: error.message };
  }
  revalidatePath(`/clients/${athleteId}`);
  revalidatePath("/coverage");
  return { ok: true };
}

/** Owner-only: invite a collaborator to an event by email (they must already have an account). */
export async function inviteCollaborator(eventId: string, email: string, role: "photographer" | "assistant"): Promise<CoverageResult> {
  if (!isUuid(eventId)) return { ok: false, error: "Invalid event." };
  if (!isValidEmail(email)) return { ok: false, error: "Enter a valid email." };
  if (role !== "photographer" && role !== "assistant") return { ok: false, error: "Invalid role." };
  const supabase = await createClient();
  const owned = await requireOwnedEvent(supabase, eventId);
  if (!owned.ok) return { ok: false, error: owned.error };
  if (!isServiceClientConfigured()) return { ok: false, error: "Collaborator invites need SUPABASE_SERVICE_ROLE_KEY on the server." };

  const target = await findUserByEmail(email.trim().toLowerCase());
  if (!target) return { ok: false, error: "No account uses that email yet. Ask them to sign up first, then invite." };
  if (target === owned.ownerId) return { ok: false, error: "You are already the owner of this event." };

  const { error } = await supabase.from("photo_event_members").upsert({ event_id: eventId, user_id: target, role, invited_by: owned.ownerId }, { onConflict: "event_id,user_id" });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/events/${eventId}`);
  return { ok: true };
}

/** Owner-only: remove a collaborator and clear any coverage assigned to them in that event. */
export async function removeCollaborator(eventId: string, userId: string): Promise<CoverageResult> {
  if (!isUuid(eventId) || !isUuid(userId)) return { ok: false, error: "Invalid request." };
  const supabase = await createClient();
  const owned = await requireOwnedEvent(supabase, eventId);
  if (!owned.ok) return { ok: false, error: owned.error };

  const { error } = await supabase.from("photo_event_members").delete().eq("event_id", eventId).eq("user_id", userId);
  if (error) return { ok: false, error: error.message };
  // Clear assignments so the revoked user can no longer see those clients.
  await supabase.from("photo_coverage").update({ photographer_id: null }).eq("event_id", eventId).eq("photographer_id", userId);
  await supabase.from("photo_coverage").update({ videographer_id: null }).eq("event_id", eventId).eq("videographer_id", userId);
  revalidatePath(`/events/${eventId}`);
  revalidatePath("/coverage");
  return { ok: true };
}

/** Resolves an email to a user id using the service (admin) client. Server-side only. */
async function findUserByEmail(email: string): Promise<string | null> {
  const admin = createServiceClient();
  // Small user base: scan the first pages of the admin user list.
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error || !data?.users?.length) return null;
    const hit = data.users.find((u) => (u.email ?? "").toLowerCase() === email);
    if (hit) return hit.id;
    if (data.users.length < 200) return null;
  }
  return null;
}

function friendly(message: string): string {
  if (/not authorized/i.test(message)) return "You are not assigned to this coverage.";
  if (/no coverage/i.test(message)) return "No coverage to update for this client.";
  return message;
}
