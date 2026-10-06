import "server-only";
import type { PhotoIncidentRow } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

/**
 * Owner-only reads of operational incidents (RLS: owner_id = auth.uid();
 * collaborators have no policy). Open issues first, then recently resolved
 * ones so the owner can see a problem cleared.
 */
export type IssueRow = PhotoIncidentRow & { event_name: string | null };

export const RESOLVED_WINDOW_MS = 3 * 24 * 3600_000;

export async function listIssues(now: Date = new Date()): Promise<{ open: IssueRow[]; resolved: IssueRow[] }> {
  const supabase = await createClient();
  const since = new Date(now.getTime() - RESOLVED_WINDOW_MS).toISOString();
  const [open, resolved, events] = await Promise.all([
    supabase.from("photo_incidents").select("*").eq("status", "open").order("last_seen_at", { ascending: false }).limit(100),
    supabase.from("photo_incidents").select("*").eq("status", "resolved").gte("resolved_at", since).order("resolved_at", { ascending: false }).limit(50),
    supabase.from("photo_events").select("id,name"),
  ]);
  if (open.error) throw new Error(open.error.message);
  const names = new Map((events.data ?? []).map((e) => [e.id, e.name]));
  const withName = (rows: PhotoIncidentRow[] | null) => (rows ?? []).map((r) => ({ ...r, event_name: r.event_id ? names.get(r.event_id) ?? null : null }));
  return { open: withName(open.data), resolved: withName(resolved.data) };
}

/** Open issues the owner has not marked done; drives the "N open issues" prompts. */
export async function countOpenIssues(): Promise<number> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("photo_incidents").select("*").eq("status", "open").limit(100);
  if (error || !data) return 0;
  return data.filter((r) => !r.acknowledged_at).length;
}
