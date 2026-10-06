import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { LeadStatus, PhotoLeadRow } from "@/lib/supabase/database.types";

export { LEAD_STATUSES, LEAD_STATUS_LABEL, isLeadStatus } from "./labels";

export type LeadView = PhotoLeadRow & {
  person: { id: string; full_name: string; email: string | null; phone: string | null; instagram: string | null } | null;
  organization: { id: string; name: string } | null;
  event: { id: string; name: string } | null;
};

/**
 * Owner's leads, newest first, with the person / club / event they point at.
 * Three small queries instead of a joined select so the hand-written
 * Database type (no Relationships) stays accurate. RLS scopes everything.
 */
export async function listLeads(filter: { status?: LeadStatus | "open" } = {}): Promise<LeadView[]> {
  const supabase = await createClient();
  let q = supabase.from("photo_leads").select("*").order("created_at", { ascending: false }).limit(200);
  if (filter.status === "open") q = q.in("status", ["new", "contacted", "quoted"]);
  else if (filter.status) q = q.eq("status", filter.status);
  const { data: leads } = await q;
  const rows = leads ?? [];
  const personIds = [...new Set(rows.map((l) => l.person_id).filter((v): v is string => Boolean(v)))];
  const orgIds = [...new Set(rows.map((l) => l.organization_id).filter((v): v is string => Boolean(v)))];
  const eventIds = [...new Set(rows.map((l) => l.event_id).filter((v): v is string => Boolean(v)))];
  const [people, orgs, events] = await Promise.all([
    personIds.length ? supabase.from("photo_people").select("id,full_name,email,phone,instagram").in("id", personIds) : Promise.resolve({ data: [] as Array<{ id: string; full_name: string; email: string | null; phone: string | null; instagram: string | null }> }),
    orgIds.length ? supabase.from("photo_organizations").select("id,name").in("id", orgIds) : Promise.resolve({ data: [] as Array<{ id: string; name: string }> }),
    eventIds.length ? supabase.from("photo_events").select("id,name").in("id", eventIds) : Promise.resolve({ data: [] as Array<{ id: string; name: string }> }),
  ]);
  const personById = new Map((people.data ?? []).map((p) => [p.id, p]));
  const orgById = new Map((orgs.data ?? []).map((o) => [o.id, o]));
  const eventById = new Map((events.data ?? []).map((e) => [e.id, e]));
  return rows.map((l) => ({
    ...l,
    person: l.person_id ? personById.get(l.person_id) ?? null : null,
    organization: l.organization_id ? orgById.get(l.organization_id) ?? null : null,
    event: l.event_id ? eventById.get(l.event_id) ?? null : null,
  }));
}

export async function countLeads(): Promise<{ open: number; total: number }> {
  const supabase = await createClient();
  const [open, total] = await Promise.all([
    supabase.from("photo_leads").select("id", { count: "exact", head: true }).in("status", ["new", "contacted", "quoted"]),
    supabase.from("photo_leads").select("id", { count: "exact", head: true }),
  ]);
  return { open: open.count ?? 0, total: total.count ?? 0 };
}
