import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

/**
 * CONTRACT between the request flow (workstream A) and pricing intelligence
 * (workstream D). After a lead/booking is durably saved, the request flow
 * calls this to enqueue a private pricing assessment. It must never throw,
 * never block or fail the submission, never read customer identifiers into a
 * research job, and never expose anything to the visitor. Deduplicated per
 * booking + request fingerprint by the implementation.
 */
export type AssessmentTrigger = { ownerId: string; bookingId: string | null; leadId: string | null; reason: "public_submission" | "lead_update" | "owner_request" };

export type AssessmentEnqueueResult = { ok: true; assessmentId: string | null; deduplicated: boolean } | { ok: false; error: string };

export async function enqueuePricingAssessment(_supabase: SupabaseClient<Database>, _trigger: AssessmentTrigger): Promise<AssessmentEnqueueResult> {
  return { ok: true, assessmentId: null, deduplicated: false };
}
