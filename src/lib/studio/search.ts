import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { BookingStatus, LeadStatus } from "@/lib/supabase/database.types";

/**
 * Universal private search across the workspace, read with the caller's own
 * client so RLS decides what is visible. Six small queries instead of a
 * search view, so nothing new is needed in the database. Results are
 * grouped by kind; each group is capped.
 */
export type SearchGroupKey = "people" | "organizations" | "bookings" | "leads" | "inquiries" | "events" | "athletes";

export type SearchHit = { id: string; href: string; title: string; subtitle: string; badge?: string };
export type SearchGroup = { key: SearchGroupKey; label: string; hits: SearchHit[] };

export const SEARCH_GROUP_LABEL: Record<SearchGroupKey, string> = { people: "Clients", organizations: "Teams & clubs", bookings: "Bookings", leads: "Leads", inquiries: "Inquiries", events: "Events", athletes: "Athletes" };

const PER_GROUP = 8;

/** Pure: the term as it is sent to PostgREST (letters, digits, a few symbols; never `,` `(` `)` which break the `or` filter). */
export function normalizeSearchTerm(raw: string | null | undefined): string | null {
  const t = (raw ?? "").replace(/[^\p{L}\p{N}\s.@'+-]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  return t.length >= 2 ? t : null;
}

export async function searchWorkspace(raw: string | null | undefined): Promise<{ term: string | null; groups: SearchGroup[] }> {
  const term = normalizeSearchTerm(raw);
  if (!term) return { term: null, groups: [] };
  const supabase = await createClient();
  const like = `%${term}%`;
  const [people, orgs, bookings, events, athletes, inquiries] = await Promise.all([
    supabase.from("photo_people").select("id,full_name,email,phone,instagram,kind").or(`full_name.ilike.${like},email.ilike.${like},phone.ilike.${like},instagram.ilike.${like}`).limit(PER_GROUP),
    supabase.from("photo_organizations").select("id,name,kind,instagram").or(`name.ilike.${like},instagram.ilike.${like}`).limit(PER_GROUP),
    supabase.from("photo_bookings").select("id,public_ref,customer_name,athlete_name,package_name,booking_status,session_at").or(`public_ref.ilike.${like},customer_name.ilike.${like},athlete_name.ilike.${like},customer_email.ilike.${like}`).order("created_at", { ascending: false }).limit(PER_GROUP),
    supabase.from("photo_events").select("id,name,venue,event_date").or(`name.ilike.${like},venue.ilike.${like}`).order("event_date", { ascending: false, nullsFirst: false }).limit(PER_GROUP),
    supabase.from("photo_athletes").select("id,name,academy,division,event_id").or(`name.ilike.${like},academy.ilike.${like}`).limit(PER_GROUP),
    supabase.from("photo_inquiries").select("id,reference,full_name,email,subject,status,category").or(`reference.ilike.${like},full_name.ilike.${like},email.ilike.${like},subject.ilike.${like},booking_reference.ilike.${like}`).order("created_at", { ascending: false }).limit(PER_GROUP),
  ]);
  // Leads carry no name: match on the person found above, or on the message.
  const personIds = (people.data ?? []).map((p) => p.id);
  const leadsByPerson = personIds.length ? await supabase.from("photo_leads").select("id,status,source,created_at,person_id,message").in("person_id", personIds).order("created_at", { ascending: false }).limit(PER_GROUP) : { data: [] };
  const leadsByMessage = await supabase.from("photo_leads").select("id,status,source,created_at,person_id,message").ilike("message", like).order("created_at", { ascending: false }).limit(PER_GROUP);
  const leadRows = [...(leadsByPerson.data ?? []), ...(leadsByMessage.data ?? [])].filter((l, i, a) => a.findIndex((x) => x.id === l.id) === i).slice(0, PER_GROUP);
  const personName = new Map((people.data ?? []).map((p) => [p.id, p.full_name]));

  const groups: SearchGroup[] = [
    { key: "people", label: SEARCH_GROUP_LABEL.people, hits: (people.data ?? []).map((p) => ({ id: p.id, href: `/people/${p.id}`, title: p.full_name, subtitle: [p.email, p.phone, p.instagram ? `@${p.instagram}` : null].filter(Boolean).join(" · "), badge: p.kind })) },
    { key: "organizations", label: SEARCH_GROUP_LABEL.organizations, hits: (orgs.data ?? []).map((o) => ({ id: o.id, href: `/clubs/${o.id}`, title: o.name, subtitle: o.instagram ? `@${o.instagram}` : "", badge: o.kind })) },
    { key: "bookings", label: SEARCH_GROUP_LABEL.bookings, hits: (bookings.data ?? []).map((b) => ({ id: b.id, href: `/bookings/${b.id}`, title: `${b.customer_name}${b.athlete_name && b.athlete_name !== b.customer_name ? ` · ${b.athlete_name}` : ""}`, subtitle: [b.public_ref, b.package_name].filter(Boolean).join(" · "), badge: b.booking_status as BookingStatus })) },
    { key: "leads", label: SEARCH_GROUP_LABEL.leads, hits: leadRows.map((l) => ({ id: l.id, href: `/leads?status=${l.status}`, title: (l.person_id && personName.get(l.person_id)) || "Lead", subtitle: [`via ${l.source}`, l.message ? l.message.slice(0, 80) : null].filter(Boolean).join(" · "), badge: l.status as LeadStatus })) },
    { key: "inquiries", label: SEARCH_GROUP_LABEL.inquiries, hits: (inquiries.data ?? []).map((i) => ({ id: i.id, href: `/inquiries?q=${encodeURIComponent(i.reference)}&status=all`, title: `${i.full_name} · ${i.subject}`, subtitle: [i.reference, i.email, i.category.replace(/_/g, " ")].join(" · "), badge: i.status })) },
    { key: "events", label: SEARCH_GROUP_LABEL.events, hits: (events.data ?? []).map((e) => ({ id: e.id, href: `/events/${e.id}`, title: e.name, subtitle: [e.event_date, e.venue].filter(Boolean).join(" · ") })) },
    { key: "athletes", label: SEARCH_GROUP_LABEL.athletes, hits: (athletes.data ?? []).map((a) => ({ id: a.id, href: `/clients/${a.id}`, title: a.name, subtitle: [a.academy, a.division].filter(Boolean).join(" · ") })) },
  ];
  return { term, groups: groups.filter((g) => g.hits.length > 0) };
}
