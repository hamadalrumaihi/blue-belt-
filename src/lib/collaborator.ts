import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { CollaboratorBoardRow, CollaboratorEventRow, PhotoCoverageRow } from "@/lib/supabase/database.types";

/** Events the signed-in user collaborates on (via the SECURITY DEFINER RPC). */
export async function loadCollaboratorEvents(): Promise<CollaboratorEventRow[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("photo_collaborator_events");
  return (data ?? []) as CollaboratorEventRow[];
}

/**
 * Which nav a signed-in user should see. "Collaborator-only" means they own no
 * events of their own but are a member of at least one event they were invited
 * to: they work from the coverage board and must never see owner surfaces such
 * as Orders (financial / customer data). An owner who is also invited elsewhere
 * (owns >= 1 event) keeps the full owner nav. A brand-new user with nothing yet
 * is treated as an owner so they can set up. photo_collaborator_events() returns
 * membership rows only, never owned events, so the two counts don't overlap.
 */
export const resolveViewerMode = cache(async (): Promise<{ collaboratorOnly: boolean }> => {
  const supabase = await createClient();
  const [owned, collab] = await Promise.all([
    supabase.from("photo_events").select("id", { count: "exact", head: true }),
    supabase.rpc("photo_collaborator_events"),
  ]);
  // Fail open to the owner nav: a transient error must never hide the owner's
  // own surfaces. This only decides what the nav offers; RLS still guards data.
  if (owned.error || collab.error) return { collaboratorOnly: false };
  const ownedCount = owned.count ?? 0;
  const collabCount = (collab.data as CollaboratorEventRow[] | null)?.length ?? 0;
  return { collaboratorOnly: ownedCount === 0 && collabCount > 0 };
});

/** The caller's assigned clients for one event (operational fields only). */
export async function loadCollaboratorBoard(eventId: string): Promise<CollaboratorBoardRow[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("photo_collaborator_board", { p_event_id: eventId });
  return (data ?? []) as CollaboratorBoardRow[];
}

export type EventTeamMember = { userId: string; email: string | null; role: string };

/**
 * Owner view: event collaborators with e-mails for the assignment UI. The
 * e-mails come from the SECURITY DEFINER RPC photo_studio_user_emails with
 * the caller's own session: only owner/staff profiles that share an event
 * with the caller are ever resolved, and no auth user list is enumerated
 * (SECURITY-REGISTER F-10).
 */
export async function loadEventTeam(eventId: string): Promise<EventTeamMember[]> {
  const supabase = await createClient();
  const { data: members } = await supabase.from("photo_event_members").select("user_id, role").eq("event_id", eventId);
  const rows = members ?? [];
  if (!rows.length) return [];
  const { data: emails } = await supabase.rpc("photo_studio_user_emails", { p_ids: rows.map((m) => m.user_id) });
  const byId = new Map((emails ?? []).map((e) => [e.user_id, e.email]));
  return rows.map((m) => ({ userId: m.user_id, email: byId.get(m.user_id) ?? null, role: m.role }));
}

/** Owner view: coverage rows (assignments + completion) for an event, keyed by athlete. */
export async function loadEventCoverage(eventId: string): Promise<Map<string, PhotoCoverageRow>> {
  const supabase = await createClient();
  const { data } = await supabase.from("photo_coverage").select("*").eq("event_id", eventId);
  return new Map((data ?? []).map((c) => [c.athlete_id, c]));
}

