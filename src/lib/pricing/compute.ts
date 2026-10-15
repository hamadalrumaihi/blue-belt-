import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json, PhotoPricingAssessmentRow } from "@/lib/supabase/database.types";
import { findCapacityConflicts } from "./capacity";
import { assess, assessmentColumns, statusFor } from "./engine";
import { extractPricingRequest, type ExtractSource } from "./engine/extract";
import type { CostAssumptions, PriceBand, PricingRequest } from "./engine/types";

/**
 * Shared by the submission hook, the cron processor and the owner's
 * recompute action: load the public-scope source of a booking or lead,
 * compute one assessment and store it on an existing row. Works with the
 * owner's RLS client and with the service client alike; the caller decides
 * which. Nothing here reads a customer identifier into the engine.
 */
type Client = SupabaseClient<Database>;

export type AssessmentTarget = { ownerId: string; bookingId: string | null; leadId: string | null };

export type LoadedSource = { source: ExtractSource; ownerId: string; bookingId: string | null; leadId: string | null };

export async function loadAssessmentSource(supabase: Client, target: AssessmentTarget): Promise<LoadedSource | null> {
  if (target.bookingId) {
    const { data: b } = await supabase.from("photo_bookings").select("id,owner_id,booking_type,details,session_at,session_end_at,service_id,usage_type,event_id,lead_id").eq("id", target.bookingId).eq("owner_id", target.ownerId).maybeSingle();
    if (!b) return null;
    const [service, event] = await Promise.all([
      b.service_id ? supabase.from("photo_services").select("includes_video,duration_minutes").eq("id", b.service_id).maybeSingle() : Promise.resolve({ data: null }),
      b.event_id ? supabase.from("photo_events").select("event_date").eq("id", b.event_id).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    return {
      ownerId: b.owner_id,
      bookingId: b.id,
      leadId: b.lead_id ?? target.leadId ?? null,
      source: { bookingType: b.booking_type, details: b.details, sessionAt: b.session_at, sessionEndAt: b.session_end_at, service: service.data ?? null, usageType: b.usage_type, eventDate: event.data?.event_date ?? null },
    };
  }
  if (target.leadId) {
    const { data: l } = await supabase.from("photo_leads").select("id,owner_id,booking_type,details,event_id,booking_id").eq("id", target.leadId).eq("owner_id", target.ownerId).maybeSingle();
    if (!l) return null;
    const event = l.event_id ? (await supabase.from("photo_events").select("event_date").eq("id", l.event_id).maybeSingle()).data : null;
    return { ownerId: l.owner_id, bookingId: l.booking_id ?? null, leadId: l.id, source: { bookingType: l.booking_type, details: l.details, eventDate: event?.event_date ?? null } };
  }
  return null;
}

export function requestFor(loaded: LoadedSource, now: Date): PricingRequest {
  return extractPricingRequest(loaded.source, now);
}

export type ComputeOptions = { costAssumptions?: Partial<CostAssumptions> | null; marginPercent?: Partial<PriceBand> | null };

/** Computes the snapshot for `row` and stores it. Throws on a database error so the caller can decide (hook: swallow; cron: mark failed). */
export async function computeAssessmentRow(supabase: Client, row: Pick<PhotoPricingAssessmentRow, "id" | "owner_id" | "booking_id" | "lead_id">, request: PricingRequest, now: Date, options: ComputeOptions = {}): Promise<{ status: "ready" | "needs_detail" }> {
  const [{ data: refs }, capacity] = await Promise.all([
    supabase.from("photo_price_references").select("*").eq("owner_id", row.owner_id).limit(1000),
    findCapacityConflicts(supabase, row.owner_id, request.eventDate, row.booking_id),
  ]);
  const snapshot = assess({ request, references: refs ?? [], costAssumptions: options.costAssumptions ?? null, marginPercent: options.marginPercent ?? null, capacity, now });
  const status = statusFor(snapshot);
  const cols = assessmentColumns(snapshot);
  const { error } = await supabase
    .from("photo_pricing_assessments")
    .update({ status, error: null, request_snapshot: cols.request_snapshot as unknown as Json, reference_ids: cols.reference_ids, cost_assumptions: cols.cost_assumptions as unknown as Json, market: cols.market as unknown as Json, cost_floor: cols.cost_floor as unknown as Json, recommendation: cols.recommendation as unknown as Json, missing_inputs: cols.missing_inputs, confidence: cols.confidence, computed_at: cols.computed_at })
    .eq("id", row.id)
    .eq("owner_id", row.owner_id);
  if (error) throw new Error(error.message);
  return { status };
}

export type QueuedInsert = { ok: true; row: Pick<PhotoPricingAssessmentRow, "id" | "owner_id" | "booking_id" | "lead_id">; version: number } | { ok: false; deduplicated: boolean; error: string | null };

/**
 * Inserts a `queued` row with version max+1. Two unique indexes can fire on
 * 23505: the queued-fingerprint index (the same request is already queued →
 * a dedupe) and the (owner, booking, version) index (a concurrent insert of a
 * DIFFERENT request took this version → re-read the version and retry once).
 * Postgres names the violated index in the message; an unnamed violation is
 * retried once and then reported as a dedupe.
 */
export async function insertQueuedAssessment(supabase: Client, target: AssessmentTarget, input: { fingerprint: string; request: PricingRequest; reason: string }): Promise<QueuedInsert> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const version = await nextAssessmentVersion(supabase, target);
    const { data, error } = await supabase
      .from("photo_pricing_assessments")
      .insert({ owner_id: target.ownerId, booking_id: target.bookingId, lead_id: target.leadId, version, status: "queued", request_fingerprint: input.fingerprint, request_snapshot: input.request as unknown as Json, trigger_reason: input.reason })
      .select("id,owner_id,booking_id,lead_id")
      .single();
    if (data && !error) return { ok: true, row: data, version };
    if (error?.code !== "23505") return { ok: false, deduplicated: false, error: error?.message ?? "Could not queue the assessment." };
    const message = error.message ?? "";
    if (/fingerprint/i.test(message)) return { ok: false, deduplicated: true, error: null };
    const versionClash = /_version_idx/i.test(message) || !/_idx|constraint/i.test(message);
    if (!versionClash || attempt === 1) return { ok: false, deduplicated: true, error: null };
    // Version taken by a concurrent insert: loop once more with a fresh version.
  }
  return { ok: false, deduplicated: true, error: null };
}

/** Next version number for a booking (or a lead without a booking). */
export async function nextAssessmentVersion(supabase: Client, target: AssessmentTarget): Promise<number> {
  let q = supabase.from("photo_pricing_assessments").select("version").eq("owner_id", target.ownerId);
  q = target.bookingId ? q.eq("booking_id", target.bookingId) : q.is("booking_id", null).eq("lead_id", target.leadId as string);
  const { data } = await q.order("version", { ascending: false }).limit(1).maybeSingle();
  return (data?.version ?? 0) + 1;
}
