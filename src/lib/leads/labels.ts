import type { LeadStatus } from "@/lib/supabase/database.types";

/** Lead statuses and labels, shared by the server (queries, actions) and the client row (no server-only imports). */
export const LEAD_STATUSES = ["new", "contacted", "quoted", "converted", "lost"] as const satisfies readonly LeadStatus[];

export const LEAD_STATUS_LABEL: Record<LeadStatus, string> = { new: "New", contacted: "Contacted", quoted: "Quoted", converted: "Converted", lost: "Lost" };

export function isLeadStatus(v: unknown): v is LeadStatus {
  return typeof v === "string" && (LEAD_STATUSES as readonly string[]).includes(v);
}
