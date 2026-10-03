import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient, isServiceClientConfigured } from "@/lib/supabase/service";
import type { CollaboratorBoardRow, CollaboratorEventRow, PhotoCoverageRow } from "@/lib/supabase/database.types";

/** Events the signed-in user collaborates on (via the SECURITY DEFINER RPC). */
export async function loadCollaboratorEvents(): Promise<CollaboratorEventRow[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("photo_collaborator_events");
  return (data ?? []) as CollaboratorEventRow[];
}

/** The caller's assigned clients for one event (operational fields only). */
export async function loadCollaboratorBoard(eventId: string): Promise<CollaboratorBoardRow[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("photo_collaborator_board", { p_event_id: eventId });
  return (data ?? []) as CollaboratorBoardRow[];
}

export type EventTeamMember = { userId: string; email: string | null; role: string };

/** Owner view: event collaborators with emails (service lookup) for the assignment UI. */
export async function loadEventTeam(eventId: string): Promise<EventTeamMember[]> {
  const supabase = await createClient();
  const { data: members } = await supabase.from("photo_event_members").select("user_id, role").eq("event_id", eventId);
  const rows = members ?? [];
  if (!rows.length || !isServiceClientConfigured()) return rows.map((m) => ({ userId: m.user_id, email: null, role: m.role }));
  const emails = await emailsFor(rows.map((m) => m.user_id));
  return rows.map((m) => ({ userId: m.user_id, email: emails.get(m.user_id) ?? null, role: m.role }));
}

/** Owner view: coverage rows (assignments + completion) for an event, keyed by athlete. */
export async function loadEventCoverage(eventId: string): Promise<Map<string, PhotoCoverageRow>> {
  const supabase = await createClient();
  const { data } = await supabase.from("photo_coverage").select("*").eq("event_id", eventId);
  return new Map((data ?? []).map((c) => [c.athlete_id, c]));
}

async function emailsFor(ids: string[]): Promise<Map<string, string>> {
  const admin = createServiceClient();
  const want = new Set(ids);
  const out = new Map<string, string>();
  for (let page = 1; page <= 10 && want.size; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error || !data?.users?.length) break;
    for (const u of data.users) {
      if (want.has(u.id)) {
        out.set(u.id, u.email ?? "");
        want.delete(u.id);
      }
    }
    if (data.users.length < 200) break;
  }
  return out;
}
