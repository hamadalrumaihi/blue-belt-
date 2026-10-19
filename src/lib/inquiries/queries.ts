import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { InquiryCategory, InquiryStatus, PhotoInquiryRow } from "@/lib/supabase/database.types";
import { OPEN_INQUIRY_STATUSES } from "./labels";

export type InquiryFilter = { status?: InquiryStatus | "open" | "all"; category?: InquiryCategory | null; q?: string | null; limit?: number };

/** Pure: the search term as PostgREST may see it (no `,` `(` `)` which break the `or` filter). */
export function inquirySearchTerm(raw: string | null | undefined): string | null {
  const t = (raw ?? "").replace(/[^\p{L}\p{N}\s.@#'+-]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  return t.length >= 2 ? t : null;
}

/** Owner's inquiries, newest first; RLS scopes everything. */
export async function listInquiries(filter: InquiryFilter = {}): Promise<PhotoInquiryRow[]> {
  const supabase = await createClient();
  let q = supabase.from("photo_inquiries").select("*").order("created_at", { ascending: false }).limit(filter.limit ?? 200);
  const status = filter.status ?? "open";
  if (status === "open") q = q.in("status", [...OPEN_INQUIRY_STATUSES]);
  else if (status !== "all") q = q.eq("status", status);
  if (filter.category) q = q.eq("category", filter.category);
  const term = inquirySearchTerm(filter.q);
  if (term) {
    const like = `%${term}%`;
    q = q.or(`reference.ilike.${like},full_name.ilike.${like},email.ilike.${like},subject.ilike.${like},booking_reference.ilike.${like},message.ilike.${like}`);
  }
  const { data } = await q;
  return data ?? [];
}

export async function getInquiry(id: string): Promise<PhotoInquiryRow | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("photo_inquiries").select("*").eq("id", id).maybeSingle();
  return data ?? null;
}

export type InquiryStats = {
  total: number;
  new: number;
  open: number;
  quoted: number;
  converted: number;
  byCategory: Array<{ category: InquiryCategory; count: number }>;
  byStatus: Array<{ status: InquiryStatus; count: number }>;
};

/** Pure: counts from already-loaded rows (the metrics page and tests share it). */
export function summariseInquiries(rows: Array<Pick<PhotoInquiryRow, "status" | "category">>): InquiryStats {
  const byCategory = new Map<InquiryCategory, number>();
  const byStatus = new Map<InquiryStatus, number>();
  for (const r of rows) {
    byCategory.set(r.category, (byCategory.get(r.category) ?? 0) + 1);
    byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + 1);
  }
  return {
    total: rows.length,
    new: byStatus.get("new") ?? 0,
    open: rows.filter((r) => OPEN_INQUIRY_STATUSES.includes(r.status)).length,
    quoted: byStatus.get("quoted") ?? 0,
    converted: byStatus.get("converted") ?? 0,
    byCategory: [...byCategory.entries()].map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count || a.category.localeCompare(b.category)),
    byStatus: [...byStatus.entries()].map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count || a.status.localeCompare(b.status)),
  };
}

export async function loadInquiryStats(): Promise<InquiryStats> {
  const supabase = await createClient();
  const { data } = await supabase.from("photo_inquiries").select("status,category").limit(5000);
  return summariseInquiries(data ?? []);
}

/** Open inquiry count for the Overview card. */
export async function countOpenInquiries(): Promise<number> {
  const supabase = await createClient();
  const { count } = await supabase.from("photo_inquiries").select("id", { count: "exact", head: true }).in("status", [...OPEN_INQUIRY_STATUSES]);
  return count ?? 0;
}
