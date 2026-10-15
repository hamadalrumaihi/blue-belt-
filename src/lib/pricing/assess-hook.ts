import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { computeAssessmentRow, loadAssessmentSource, nextAssessmentVersion, requestFor } from "./compute";
import { requestFingerprint } from "./engine/fingerprint";

/**
 * CONTRACT between the request flow (workstream A) and pricing intelligence
 * (workstream D). After a lead/booking is durably saved, the request flow
 * calls this to enqueue a private pricing assessment. It must never throw,
 * never block or fail the submission, never read customer identifiers into a
 * research job, and never expose anything to the visitor. Deduplicated per
 * booking + request fingerprint.
 *
 * Implementation: extract the PUBLIC-scope request, fingerprint it, skip
 * when the same request is already assessed or queued, otherwise insert a
 * `queued` row and compute it right away (no research is involved, so it is
 * cheap). A failure after the insert leaves the row queued for the cron
 * processor; a failure before it is reported in the result and nothing
 * else happens. The caller passes whichever client it holds: the service
 * client from the public form (RLS bypass, owner_id from the booking) or the
 * owner's client from a studio action.
 */
export type AssessmentTrigger = { ownerId: string; bookingId: string | null; leadId: string | null; reason: "public_submission" | "lead_update" | "owner_request" };

export type AssessmentEnqueueResult = { ok: true; assessmentId: string | null; deduplicated: boolean } | { ok: false; error: string };

export async function enqueuePricingAssessment(supabase: SupabaseClient<Database>, trigger: AssessmentTrigger, now: Date = new Date()): Promise<AssessmentEnqueueResult> {
  try {
    if (!trigger.bookingId && !trigger.leadId) return { ok: false, error: "No booking or lead to assess." };
    const loaded = await loadAssessmentSource(supabase, trigger);
    if (!loaded) return { ok: false, error: "Booking or lead not found." };
    const request = requestFor(loaded, now);
    const fingerprint = requestFingerprint(request);
    const target = { ownerId: loaded.ownerId, bookingId: loaded.bookingId, leadId: loaded.leadId };

    // Dedupe: the same request for the same booking (or lead) is assessed once.
    let existingQ = supabase.from("photo_pricing_assessments").select("id,status").eq("owner_id", target.ownerId).eq("request_fingerprint", fingerprint).neq("status", "failed");
    existingQ = target.bookingId ? existingQ.eq("booking_id", target.bookingId) : existingQ.is("booking_id", null).eq("lead_id", target.leadId as string);
    const { data: existing } = await existingQ.order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (existing) return { ok: true, assessmentId: existing.id, deduplicated: true };

    const version = await nextAssessmentVersion(supabase, target);
    const { data: inserted, error } = await supabase
      .from("photo_pricing_assessments")
      .insert({ owner_id: target.ownerId, booking_id: target.bookingId, lead_id: target.leadId, version, status: "queued", request_fingerprint: fingerprint, request_snapshot: request as unknown as Json, trigger_reason: trigger.reason })
      .select("id,owner_id,booking_id,lead_id")
      .single();
    if (error || !inserted) {
      // A concurrent insert of the same request (partial unique index) is a dedupe, not a failure.
      if (error?.code === "23505") return { ok: true, assessmentId: null, deduplicated: true };
      return { ok: false, error: error?.message ?? "Could not queue the assessment." };
    }

    try {
      await computeAssessmentRow(supabase, inserted, request, now);
    } catch (err) {
      // Left queued; the cron processor retries. The row keeps the error for the owner.
      await supabase.from("photo_pricing_assessments").update({ error: err instanceof Error ? err.message : String(err) }).eq("id", inserted.id);
    }
    return { ok: true, assessmentId: inserted.id, deduplicated: false };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
