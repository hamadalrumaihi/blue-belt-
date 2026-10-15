import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { BookingType, PhotoBookingRow, PhotoPriceReferenceRow, PhotoPricingAssessmentRow, PhotoQuoteRow, PriceConfidence, PriceRegion } from "@/lib/supabase/database.types";
import { referenceNeedsReverification } from "./form";

/**
 * Owner reads for the pricing area. Always the signed-in user's client: RLS
 * (photo_is_owner_user) returns nothing for staff or client accounts, and the
 * pages call requireOwner() before rendering anyway.
 */

export type ReferenceFilter = {
  serviceType?: BookingType | null;
  confidence?: PriceConfidence | null;
  region?: PriceRegion | null;
  /** "active" (default): not excluded, not superseded; "excluded": excluded only; "all": everything including history. */
  show?: "active" | "excluded" | "all" | "reverify";
  limit?: number;
};

export type ReferenceListRow = PhotoPriceReferenceRow & { reverify: string | null };

export async function listPriceReferences(opts: ReferenceFilter = {}, now: Date = new Date()): Promise<ReferenceListRow[]> {
  const supabase = await createClient();
  let q = supabase.from("photo_price_references").select("*");
  if (opts.serviceType) q = q.eq("service_type", opts.serviceType);
  if (opts.confidence) q = q.eq("confidence", opts.confidence);
  if (opts.region) q = q.eq("region", opts.region);
  const show = opts.show ?? "active";
  if (show === "active" || show === "reverify") q = q.eq("excluded", false).is("superseded_by", null);
  if (show === "excluded") q = q.eq("excluded", true);
  const { data } = await q.order("service_type", { ascending: true }).order("observed_on", { ascending: false, nullsFirst: false }).order("provider", { ascending: true }).limit(opts.limit ?? 300);
  const rows = (data ?? []).map((r) => ({ ...r, reverify: referenceNeedsReverification(r, now) }));
  return show === "reverify" ? rows.filter((r) => r.reverify !== null) : rows;
}

export async function getPriceReference(id: string): Promise<PhotoPriceReferenceRow | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("photo_price_references").select("*").eq("id", id).maybeSingle();
  return data ?? null;
}

export type QuoteListRow = PhotoQuoteRow & { booking: Pick<PhotoBookingRow, "id" | "public_ref" | "customer_name" | "booking_status"> | null };

export async function listQuotes(opts: { bookingId?: string | null; limit?: number } = {}): Promise<QuoteListRow[]> {
  const supabase = await createClient();
  let q = supabase.from("photo_quotes").select("*");
  if (opts.bookingId) q = q.eq("booking_id", opts.bookingId);
  const { data } = await q.order("created_at", { ascending: false }).limit(opts.limit ?? 50);
  const rows = data ?? [];
  const ids = [...new Set(rows.map((r) => r.booking_id).filter((v): v is string => Boolean(v)))];
  const bookings = new Map<string, QuoteListRow["booking"]>();
  if (ids.length) {
    const { data: found } = await supabase.from("photo_bookings").select("id,public_ref,customer_name,booking_status").in("id", ids);
    for (const b of found ?? []) bookings.set(b.id, b);
  }
  return rows.map((r) => ({ ...r, booking: (r.booking_id && bookings.get(r.booking_id)) || null }));
}

export async function getQuote(id: string): Promise<QuoteListRow | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("photo_quotes").select("*").eq("id", id).maybeSingle();
  if (!data) return null;
  let booking: QuoteListRow["booking"] = null;
  if (data.booking_id) {
    const { data: b } = await supabase.from("photo_bookings").select("id,public_ref,customer_name,booking_status").eq("id", data.booking_id).maybeSingle();
    booking = b ?? null;
  }
  return { ...data, booking };
}

// ---------------------------------------------------------------------------
// Assessments
// ---------------------------------------------------------------------------

export type AssessmentListRow = PhotoPricingAssessmentRow & { booking: Pick<PhotoBookingRow, "id" | "public_ref" | "customer_name" | "booking_status"> | null };

export async function listAssessments(opts: { bookingId?: string | null; leadId?: string | null; limit?: number } = {}): Promise<AssessmentListRow[]> {
  const supabase = await createClient();
  let q = supabase.from("photo_pricing_assessments").select("*");
  if (opts.bookingId) q = q.eq("booking_id", opts.bookingId);
  if (opts.leadId) q = q.eq("lead_id", opts.leadId);
  const { data } = await q.order("created_at", { ascending: false }).limit(opts.limit ?? 50);
  const rows = data ?? [];
  const ids = [...new Set(rows.map((r) => r.booking_id).filter((v): v is string => Boolean(v)))];
  const bookings = new Map<string, AssessmentListRow["booking"]>();
  if (ids.length) {
    const { data: found } = await supabase.from("photo_bookings").select("id,public_ref,customer_name,booking_status").in("id", ids);
    for (const b of found ?? []) bookings.set(b.id, b);
  }
  return rows.map((r) => ({ ...r, booking: (r.booking_id && bookings.get(r.booking_id)) || null }));
}

export async function getAssessment(id: string): Promise<AssessmentListRow | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("photo_pricing_assessments").select("*").eq("id", id).maybeSingle();
  if (!data) return null;
  let booking: AssessmentListRow["booking"] = null;
  if (data.booking_id) {
    const { data: b } = await supabase.from("photo_bookings").select("id,public_ref,customer_name,booking_status").eq("id", data.booking_id).maybeSingle();
    booking = b ?? null;
  }
  return { ...data, booking };
}

/** Every version for the same booking (or lead), newest first. */
export async function listAssessmentVersions(a: Pick<PhotoPricingAssessmentRow, "booking_id" | "lead_id">): Promise<Pick<PhotoPricingAssessmentRow, "id" | "version" | "status" | "created_at" | "confidence">[]> {
  const supabase = await createClient();
  let q = supabase.from("photo_pricing_assessments").select("id,version,status,created_at,confidence");
  q = a.booking_id ? q.eq("booking_id", a.booking_id) : q.is("booking_id", null).eq("lead_id", a.lead_id as string);
  const { data } = await q.order("version", { ascending: false }).limit(50);
  return data ?? [];
}

export async function latestAssessmentForBooking(bookingId: string): Promise<PhotoPricingAssessmentRow | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("photo_pricing_assessments").select("*").eq("booking_id", bookingId).order("version", { ascending: false }).limit(1).maybeSingle();
  return data ?? null;
}

export type LeadAssessmentBadge = Pick<PhotoPricingAssessmentRow, "id" | "status" | "version" | "confidence">;

/** Latest assessment per lead (by lead_id or by the lead's booking), for the leads list badge. */
export async function latestAssessmentsForLeads(leads: Array<Pick<PhotoBookingRow, "id"> & { booking_id?: string | null }>): Promise<Map<string, LeadAssessmentBadge>> {
  const out = new Map<string, LeadAssessmentBadge>();
  const ids = leads.map((l) => l.id);
  if (!ids.length) return out;
  const supabase = await createClient();
  const { data } = await supabase.from("photo_pricing_assessments").select("id,status,version,confidence,lead_id,booking_id").in("lead_id", ids).order("version", { ascending: false }).limit(500);
  for (const row of data ?? []) {
    if (row.lead_id && !out.has(row.lead_id)) out.set(row.lead_id, { id: row.id, status: row.status, version: row.version, confidence: row.confidence });
  }
  return out;
}

/** The quote drafted from an assessment, if the owner accepted it. */
export async function quoteForAssessment(assessmentId: string): Promise<PhotoQuoteRow | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("photo_quotes").select("*").eq("assessment_id", assessmentId).neq("status", "discarded").order("created_at", { ascending: false }).limit(1).maybeSingle();
  return data ?? null;
}
