"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "./types";
import { writeAudit } from "@/lib/audit";
import { depositColumnsFor } from "@/lib/bookings/policy";
import { BOOKING_STATUS_LABEL, bookingTransitionColumns, canTransitionBooking } from "@/lib/bookings/state";
import { buildAcceptedQuote } from "@/lib/pricing/accept";
import { computeAssessmentRow, insertQueuedAssessment, loadAssessmentSource, requestFor } from "@/lib/pricing/compute";
import { assessmentFromRow } from "@/lib/pricing/engine";
import { applyRequestOverrides, pricingRequestFromJson, type RequestOverrides } from "@/lib/pricing/engine/extract";
import { requestFingerprint } from "@/lib/pricing/engine/fingerprint";
import type { CostAssumptions, PriceBand } from "@/lib/pricing/engine/types";
import { parseAssessmentEditForm, parseChosenAmount, parsePriceReferenceForm, parseQuoteInputs, validateQuoteInputs, type PriceReferenceValues, type QuoteInputs } from "@/lib/pricing/form";
import { parseReferenceImport } from "@/lib/pricing/import";
import { suggestQuote } from "@/lib/pricing/suggest";
import { requireOwner } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import type { Json, PhotoBookingRow } from "@/lib/supabase/database.types";
import { trimOrNull } from "@/lib/utils";
import { isUuid } from "@/lib/validation";

/**
 * Owner-only pricing actions. Every action starts with requireOwner(): staff
 * and client accounts are refused before any query, and RLS
 * (photo_is_owner_user) refuses them again in the database. Nothing here
 * e-mails or messages anyone: a quote is an internal suggestion until the
 * owner applies it to a booking, and even then only the booking amount and
 * lifecycle change.
 */
type Result = { ok: true } | { ok: false; error: string };

const PRICING_MAX_NOTE = 500;

type Client = Awaited<ReturnType<typeof createClient>>;
type Owner = { ok: true; supabase: Client; user: { id: string } } | { ok: false; error: string };

async function owner(): Promise<Owner> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, error: guard.error };
  const supabase = await createClient();
  return { ok: true, supabase, user: { id: guard.viewer.userId } };
}

function revalidatePricing() {
  revalidatePath("/pricing");
  revalidatePath("/pricing/quote");
  revalidatePath("/pricing/assessments");
}

/** Row columns for a parsed reference (includes as JSON). */
function referenceRow(values: PriceReferenceValues) {
  return { ...values, includes: values.includes as Json };
}

// ---------------------------------------------------------------------------
// Reference prices
// ---------------------------------------------------------------------------

export async function createPriceReference(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const o = await owner();
  if (!o.ok) return { error: o.error };
  const { supabase, user } = o;
  const { fieldErrors, values } = parsePriceReferenceForm(formData);
  if (!values) return { fieldErrors };
  const { data, error } = await supabase.from("photo_price_references").insert({ ...values, includes: values.includes as Json, owner_id: user.id }).select("id").single();
  if (error) return { error: error.message };
  await writeAudit(supabase, { ownerId: user.id, actorId: user.id, entity: "studio", entityId: data.id, action: "price_reference.created", data: { provider: values.provider, service_type: values.service_type } });
  revalidatePricing();
  redirect("/pricing");
}

export async function updatePriceReference(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!isUuid(id)) return { error: "Invalid reference id." };
  const o = await owner();
  if (!o.ok) return { error: o.error };
  const { supabase, user } = o;
  const { fieldErrors, values } = parsePriceReferenceForm(formData);
  if (!values) return { fieldErrors };
  if (trimOrNull(formData.get("mode")) === "reobserve") {
    // History is kept: the re-observation is a NEW row and the old one points at it.
    const { data: old } = await supabase.from("photo_price_references").select("id,seed_key").eq("id", id).eq("owner_id", user.id).maybeSingle();
    if (!old) return { error: "Reference not found or you do not have access to it." };
    const { data: created, error: insertError } = await supabase.from("photo_price_references").insert({ ...referenceRow(values), seed_key: null, owner_id: user.id }).select("id").single();
    if (insertError || !created) return { error: insertError?.message ?? "Could not save the new observation." };
    const { error: linkError } = await supabase.from("photo_price_references").update({ superseded_by: created.id }).eq("id", id).eq("owner_id", user.id);
    if (linkError) return { error: `The new observation was saved but the old one could not be linked: ${linkError.message}` };
    await writeAudit(supabase, { ownerId: user.id, actorId: user.id, entity: "studio", entityId: created.id, action: "price_reference.reobserved", data: { supersedes: id, provider: values.provider, observed_on: values.observed_on } });
    revalidatePricing();
    redirect("/pricing");
  }
  const { error, count } = await supabase.from("photo_price_references").update(referenceRow(values), { count: "exact" }).eq("id", id).eq("owner_id", user.id);
  if (error) return { error: error.message };
  if (!count) return { error: "Reference not found or you do not have access to it." };
  await writeAudit(supabase, { ownerId: user.id, actorId: user.id, entity: "studio", entityId: id, action: "price_reference.updated", data: { provider: values.provider, service_type: values.service_type } });
  revalidatePricing();
  revalidatePath(`/pricing/references/${id}/edit`);
  redirect("/pricing");
}

// ---------------------------------------------------------------------------
// Evidence import (JSON / CSV paste; idempotent on seed_key)
// ---------------------------------------------------------------------------

export type ImportPreviewRow = { index: number; label: string; ok: boolean; errors: Record<string, string>; seedKey: string | null; exists: boolean };
export type ImportPreview = { ok: true; format: "json" | "csv"; rows: ImportPreviewRow[]; valid: number; existing: number; invalid: number } | { ok: false; error: string };

async function existingSeedKeys(supabase: Client, ownerId: string, keys: string[]): Promise<Set<string>> {
  if (!keys.length) return new Set();
  const { data } = await supabase.from("photo_price_references").select("seed_key").eq("owner_id", ownerId).in("seed_key", keys);
  return new Set((data ?? []).map((r) => r.seed_key).filter((k): k is string => Boolean(k)));
}

export async function previewReferenceImport(text: string): Promise<ImportPreview> {
  const o = await owner();
  if (!o.ok) return { ok: false, error: o.error };
  const parsed = parseReferenceImport(typeof text === "string" ? text : "");
  if (parsed.error) return { ok: false, error: parsed.error };
  const keys = parsed.records.map((r) => r.values?.seed_key).filter((k): k is string => Boolean(k));
  const existing = await existingSeedKeys(o.supabase, o.user.id, keys);
  const rows = parsed.records.map((r) => ({ index: r.index, label: r.label, ok: r.values !== null, errors: r.fieldErrors, seedKey: r.values?.seed_key ?? null, exists: Boolean(r.values?.seed_key && existing.has(r.values.seed_key)) }));
  return { ok: true, format: parsed.format, rows, valid: rows.filter((r) => r.ok && !r.exists).length, existing: rows.filter((r) => r.exists).length, invalid: rows.filter((r) => !r.ok).length };
}

export type ImportCommit = { ok: true; inserted: number; skipped: number; invalid: number } | { ok: false; error: string };

/** Inserts every valid record whose seed_key is new (or absent); invalid rows are skipped, nothing is overwritten. */
export async function commitReferenceImport(text: string): Promise<ImportCommit> {
  const o = await owner();
  if (!o.ok) return { ok: false, error: o.error };
  const { supabase, user } = o;
  const parsed = parseReferenceImport(typeof text === "string" ? text : "");
  if (parsed.error) return { ok: false, error: parsed.error };
  const valid = parsed.records.filter((r) => r.values !== null).map((r) => r.values!);
  const existing = await existingSeedKeys(supabase, user.id, valid.map((v) => v.seed_key).filter((k): k is string => Boolean(k)));
  const toInsert = valid.filter((v) => !v.seed_key || !existing.has(v.seed_key));
  if (toInsert.length) {
    const { error } = await supabase.from("photo_price_references").insert(toInsert.map((v) => ({ ...referenceRow(v), owner_id: user.id })));
    if (error) return { ok: false, error: error.message };
  }
  await writeAudit(supabase, { ownerId: user.id, actorId: user.id, entity: "studio", action: "price_reference.imported", data: { inserted: toInsert.length, skipped: valid.length - toInsert.length, invalid: parsed.records.length - valid.length, format: parsed.format } });
  revalidatePricing();
  return { ok: true, inserted: toInsert.length, skipped: valid.length - toInsert.length, invalid: parsed.records.length - valid.length };
}

export async function deletePriceReference(id: string): Promise<Result> {
  if (!isUuid(id)) return { ok: false, error: "Invalid reference id." };
  const o = await owner();
  if (!o.ok) return { ok: false, error: o.error };
  const { supabase, user } = o;
  const { error, count } = await supabase.from("photo_price_references").delete({ count: "exact" }).eq("id", id).eq("owner_id", user.id);
  if (error) return { ok: false, error: error.message };
  if (!count) return { ok: false, error: "Reference not found or you do not have access to it." };
  await writeAudit(supabase, { ownerId: user.id, actorId: user.id, entity: "studio", entityId: id, action: "price_reference.deleted" });
  revalidatePricing();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Quotes
// ---------------------------------------------------------------------------

export type CreateQuoteResult = { ok: true; id: string } | { ok: false; error: string; fieldErrors?: Record<string, string> };

/**
 * Computes a suggestion from the owner's reference prices and stores it as a
 * draft. `inputs` is validated again here (a server action can be called with
 * anything), and the booking, when given, must be the owner's.
 */
export async function createQuote(input: { bookingId?: string | null; inputs: QuoteInputs | Record<string, unknown> }): Promise<CreateQuoteResult> {
  const o = await owner();
  if (!o.ok) return { ok: false, error: o.error };
  const { supabase, user } = o;
  const bookingId = input.bookingId ?? null;
  if (bookingId !== null && !isUuid(bookingId)) return { ok: false, error: "Invalid booking." };
  const parsed = validateQuoteInputs((input.inputs ?? {}) as Record<string, unknown>);
  if (!parsed.values) return { ok: false, error: "Check the job inputs.", fieldErrors: parsed.fieldErrors };
  const inputs = parsed.values;

  if (bookingId) {
    const { data: booking } = await supabase.from("photo_bookings").select("id").eq("id", bookingId).eq("owner_id", user.id).maybeSingle();
    if (!booking) return { ok: false, error: "Booking not found." };
  }
  const { data: refs } = await supabase.from("photo_price_references").select("*").eq("owner_id", user.id);
  const suggestion = suggestQuote(refs ?? [], inputs, new Date());
  const { data, error } = await supabase
    .from("photo_quotes")
    .insert({
      owner_id: user.id,
      booking_id: bookingId,
      status: "draft",
      inputs: inputs as unknown as Json,
      calculation: suggestion as unknown as Json,
      suggested_from: suggestion.suggestedFrom,
      suggested_to: suggestion.suggestedTo,
      currency: "QAR",
      notes: inputs.notes,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "Could not save the quote." };
  await writeAudit(supabase, { ownerId: user.id, actorId: user.id, entity: "studio", entityId: data.id, action: "quote.created", data: { booking_id: bookingId, service_type: inputs.service_type, suggested_from: suggestion.suggestedFrom, suggested_to: suggestion.suggestedTo, confidence: suggestion.confidence } });
  revalidatePricing();
  if (bookingId) revalidatePath(`/bookings/${bookingId}`);
  return { ok: true, id: data.id };
}

/** Form wrapper for the quote page: parse, create, open the breakdown. */
export async function createQuoteForm(bookingId: string | null, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const guard = await requireOwner();
  if (!guard.ok) return { error: guard.error };
  if (bookingId !== null && !isUuid(bookingId)) return { error: "Invalid booking." };
  const { fieldErrors, values } = parseQuoteInputs(formData);
  if (!values) return { fieldErrors };
  const res = await createQuote({ bookingId, inputs: values });
  if (!res.ok) return { error: res.error, fieldErrors: res.fieldErrors };
  redirect(`/pricing/quote/${res.id}`);
}

const CLOSED: readonly PhotoBookingRow["booking_status"][] = ["cancelled", "completed"];

/**
 * The owner confirms an amount: the quote becomes "applied", the booking's
 * amount_qr is set, and an inquiry moves to "quoted" (same semantics as
 * transitionBooking: guarded by the current status). Nothing is sent to the
 * customer; the owner shares the price however they choose.
 */
export async function applyQuoteToBooking(quoteId: string, chosenAmount: number | string, note?: string | null): Promise<Result> {
  if (!isUuid(quoteId)) return { ok: false, error: "Invalid quote." };
  const amount = parseChosenAmount(chosenAmount);
  if (!amount.ok) return { ok: false, error: amount.error };
  const cleanNote = (typeof note === "string" ? note.trim().slice(0, PRICING_MAX_NOTE) : "") || null;
  const o = await owner();
  if (!o.ok) return { ok: false, error: o.error };
  const { supabase, user } = o;

  const { data: quote } = await supabase.from("photo_quotes").select("*").eq("id", quoteId).eq("owner_id", user.id).maybeSingle();
  if (!quote) return { ok: false, error: "Quote not found." };
  if (quote.status === "discarded") return { ok: false, error: "This quote was discarded. Create a new one." };
  if (!quote.booking_id) return { ok: false, error: "This quote is not linked to a booking." };
  const { data: booking } = await supabase.from("photo_bookings").select("*").eq("id", quote.booking_id).eq("owner_id", user.id).maybeSingle();
  if (!booking) return { ok: false, error: "Booking not found." };
  if (CLOSED.includes(booking.booking_status)) return { ok: false, error: `This booking is ${BOOKING_STATUS_LABEL[booking.booking_status].toLowerCase()}; its amount cannot change.` };
  if (booking.status === "paid" || booking.status === "refunded") return { ok: false, error: "This booking is already paid through MyFatoorah; its amount cannot change." };

  const now = new Date();
  // The deposit split is server-side policy; once the deposit is paid only the balance moves.
  const split = booking.deposit_state === "paid"
    ? { balance_qr: Math.max(0, Math.round((amount.amount - Number(booking.deposit_qr)) * 100) / 100) }
    : depositColumnsFor(amount.amount);
  const patch: Partial<PhotoBookingRow> = { amount_qr: amount.amount, ...split };
  const moveToQuoted = booking.booking_status === "inquiry" && canTransitionBooking(booking.booking_status, "quoted");
  if (moveToQuoted) Object.assign(patch, bookingTransitionColumns(booking, "quoted", now));
  const { data: updated, error } = await supabase.from("photo_bookings").update(patch).eq("id", booking.id).eq("owner_id", user.id).eq("booking_status", booking.booking_status).select("id,client_id,booking_status").maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!updated) return { ok: false, error: "The booking changed in the meantime. Refresh and try again." };

  const { error: quoteError } = await supabase.from("photo_quotes").update({ status: "applied", chosen_amount_qr: amount.amount, notes: cleanNote ?? quote.notes }).eq("id", quoteId).eq("owner_id", user.id);
  if (quoteError) return { ok: false, error: `The booking was updated but the quote could not be marked as applied: ${quoteError.message}` };

  await writeAudit(supabase, { ownerId: user.id, actorId: user.id, entity: "booking", entityId: booking.id, action: "quote.applied", data: { quote_id: quoteId, amount_qr: amount.amount, previous_amount_qr: Number(booking.amount_qr), from: booking.booking_status, to: updated.booking_status, note: cleanNote } });
  revalidatePricing();
  revalidatePath(`/pricing/quote/${quoteId}`);
  revalidatePath("/bookings");
  revalidatePath(`/bookings/${booking.id}`);
  revalidatePath("/payments");
  revalidatePath("/studio");
  if (updated.client_id) revalidatePath(`/people/${updated.client_id}`);
  return { ok: true };
}

/** Form wrapper for the quote page's "Apply to booking" sheet. */
export async function applyQuoteForm(quoteId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const amountRaw = trimOrNull(formData.get("amount_qr"));
  const amount = parseChosenAmount(amountRaw ?? "");
  if (!amount.ok) return { fieldErrors: { amount_qr: amount.error } };
  const res = await applyQuoteToBooking(quoteId, amount.amount, trimOrNull(formData.get("note")));
  if (!res.ok) return { error: res.error };
  const o = await owner();
  const bookingId = o.ok ? (await o.supabase.from("photo_quotes").select("booking_id").eq("id", quoteId).maybeSingle()).data?.booking_id : null;
  redirect(bookingId ? `/bookings/${bookingId}` : `/pricing/quote/${quoteId}`);
}

export async function discardQuote(id: string): Promise<Result> {
  if (!isUuid(id)) return { ok: false, error: "Invalid quote." };
  const o = await owner();
  if (!o.ok) return { ok: false, error: o.error };
  const { supabase, user } = o;
  const { error, count } = await supabase.from("photo_quotes").update({ status: "discarded" }, { count: "exact" }).eq("id", id).eq("owner_id", user.id).neq("status", "applied");
  if (error) return { ok: false, error: error.message };
  if (!count) return { ok: false, error: "Quote not found, or it was already applied." };
  await writeAudit(supabase, { ownerId: user.id, actorId: user.id, entity: "studio", entityId: id, action: "quote.discarded" });
  revalidatePricing();
  revalidatePath(`/pricing/quote/${id}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Assessments
// ---------------------------------------------------------------------------

export type RecomputeResult = { ok: true; id: string; version: number; status: "ready" | "needs_detail" } | { ok: false; error: string; fieldErrors?: Record<string, string> };

export type RecomputeTarget = { bookingId?: string | null; leadId?: string | null; assessmentId?: string | null };

/**
 * Creates a NEW assessment version for a booking (or lead). The previous
 * versions and any quote drafted from them are never modified. With
 * `assessmentId` the new version starts from that version's inputs plus the
 * owner's overrides; otherwise it is extracted afresh from the booking.
 */
export async function recomputeAssessment(target: RecomputeTarget, overrides: RequestOverrides = {}, options: { costAssumptions?: Partial<CostAssumptions> | null; marginPercent?: Partial<PriceBand> | null } = {}): Promise<RecomputeResult> {
  const o = await owner();
  if (!o.ok) return { ok: false, error: o.error };
  const { supabase, user } = o;
  for (const id of [target.bookingId, target.leadId, target.assessmentId]) if (id && !isUuid(id)) return { ok: false, error: "Invalid id." };
  const now = new Date();

  let bookingId = target.bookingId ?? null;
  let leadId = target.leadId ?? null;
  let base = null as ReturnType<typeof pricingRequestFromJson>;
  if (target.assessmentId) {
    const { data: prev } = await supabase.from("photo_pricing_assessments").select("booking_id,lead_id,request_snapshot").eq("id", target.assessmentId).eq("owner_id", user.id).maybeSingle();
    if (!prev) return { ok: false, error: "Assessment not found." };
    bookingId = prev.booking_id;
    leadId = prev.lead_id;
    base = pricingRequestFromJson(prev.request_snapshot);
  }
  const loaded = await loadAssessmentSource(supabase, { ownerId: user.id, bookingId, leadId });
  if (!loaded) return { ok: false, error: "Booking or lead not found." };
  const request = applyRequestOverrides(base ?? requestFor(loaded, now), overrides);
  const fingerprint = requestFingerprint(request);
  const t = { ownerId: user.id, bookingId: loaded.bookingId, leadId: loaded.leadId };
  const queued = await insertQueuedAssessment(supabase, t, { fingerprint, request, reason: "owner_request" });
  if (!queued.ok) return { ok: false, error: queued.deduplicated ? "The same request is already queued; wait for it to finish." : (queued.error ?? "Could not create the assessment.") };
  const inserted = queued.row;
  const version = queued.version;
  let status: "ready" | "needs_detail";
  try {
    status = (await computeAssessmentRow(supabase, inserted, request, now, options)).status;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await supabase.from("photo_pricing_assessments").update({ status: "failed", error: message }).eq("id", inserted.id).eq("owner_id", user.id);
    return { ok: false, error: `The assessment could not be computed: ${message}` };
  }
  await writeAudit(supabase, { ownerId: user.id, actorId: user.id, entity: "studio", entityId: inserted.id, action: "assessment.created", data: { booking_id: t.bookingId, lead_id: t.leadId, version, status, overrides: Object.keys(overrides) } });
  revalidatePricing();
  revalidatePath(`/pricing/assessments/${inserted.id}`);
  if (t.bookingId) revalidatePath(`/bookings/${t.bookingId}`);
  revalidatePath("/leads");
  return { ok: true, id: inserted.id, version, status };
}

/** Form wrapper: the owner edits the inputs / assumptions / margins and gets a new version. */
export async function recomputeAssessmentForm(assessmentId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!isUuid(assessmentId)) return { error: "Invalid assessment." };
  const guard = await requireOwner();
  if (!guard.ok) return { error: guard.error };
  const { fieldErrors, values } = parseAssessmentEditForm(formData);
  if (!values) return { fieldErrors };
  const res = await recomputeAssessment({ assessmentId }, values.overrides, { costAssumptions: values.costAssumptions, marginPercent: values.marginPercent });
  if (!res.ok) return { error: res.error, fieldErrors: res.fieldErrors };
  redirect(`/pricing/assessments/${res.id}`);
}

export type AcceptResult = { ok: true; quoteId: string } | { ok: false; error: string };

/**
 * The owner accepts an assessment: a photo_quotes DRAFT linked to the
 * booking is created (or an existing draft from the same assessment is
 * refreshed). The amount is applied through the existing apply flow; nothing
 * is issued or e-mailed here.
 */
export async function acceptAssessment(assessmentId: string): Promise<AcceptResult> {
  if (!isUuid(assessmentId)) return { ok: false, error: "Invalid assessment." };
  const o = await owner();
  if (!o.ok) return { ok: false, error: o.error };
  const { supabase, user } = o;
  const { data: row } = await supabase.from("photo_pricing_assessments").select("*").eq("id", assessmentId).eq("owner_id", user.id).maybeSingle();
  if (!row) return { ok: false, error: "Assessment not found." };
  if (!row.booking_id) return { ok: false, error: "This assessment is for a lead without a booking. Convert the lead first." };
  if (row.status !== "ready" && row.status !== "needs_detail") return { ok: false, error: `This assessment is ${row.status.replace("_", " ")}; it cannot be accepted yet.` };
  const snapshot = assessmentFromRow(row);
  if (!snapshot) return { ok: false, error: "The stored assessment could not be read. Recompute it." };
  const built = buildAcceptedQuote(snapshot, { id: row.id, version: row.version });
  const { data: existing } = await supabase.from("photo_quotes").select("id").eq("assessment_id", row.id).eq("owner_id", user.id).eq("status", "draft").limit(1).maybeSingle();
  let quoteId: string;
  if (existing) {
    const { error } = await supabase.from("photo_quotes").update({ inputs: built.inputs as unknown as Json, calculation: built.calculation as unknown as Json, suggested_from: built.suggested_from, suggested_to: built.suggested_to }).eq("id", existing.id).eq("owner_id", user.id);
    if (error) return { ok: false, error: error.message };
    quoteId = existing.id;
  } else {
    const { data, error } = await supabase
      .from("photo_quotes")
      .insert({ owner_id: user.id, booking_id: row.booking_id, assessment_id: row.id, status: "draft", inputs: built.inputs as unknown as Json, calculation: built.calculation as unknown as Json, suggested_from: built.suggested_from, suggested_to: built.suggested_to, currency: "QAR", notes: null })
      .select("id")
      .single();
    if (error || !data) return { ok: false, error: error?.message ?? "Could not create the quote draft." };
    quoteId = data.id;
  }
  await writeAudit(supabase, { ownerId: user.id, actorId: user.id, entity: "studio", entityId: quoteId, action: "assessment.accepted", data: { assessment_id: row.id, version: row.version, booking_id: row.booking_id, suggested_from: built.suggested_from, suggested_to: built.suggested_to } });
  revalidatePricing();
  revalidatePath(`/pricing/quote/${quoteId}`);
  revalidatePath(`/pricing/assessments/${row.id}`);
  revalidatePath(`/bookings/${row.booking_id}`);
  return { ok: true, quoteId };
}

/**
 * Explicitly marks a quote as issued to the client (issued_at). The owner
 * shares the price themselves; this records that they did. Nothing is sent.
 */
export async function issueQuote(quoteId: string): Promise<Result> {
  if (!isUuid(quoteId)) return { ok: false, error: "Invalid quote." };
  const o = await owner();
  if (!o.ok) return { ok: false, error: o.error };
  const { supabase, user } = o;
  const { data: quote } = await supabase.from("photo_quotes").select("id,booking_id,status,issued_at").eq("id", quoteId).eq("owner_id", user.id).maybeSingle();
  if (!quote) return { ok: false, error: "Quote not found." };
  if (quote.status === "discarded") return { ok: false, error: "A discarded quote cannot be issued." };
  if (!quote.booking_id) return { ok: false, error: "Link the quote to a booking before issuing it." };
  if (quote.issued_at) return { ok: true };
  const issuedAt = new Date().toISOString();
  const { error } = await supabase.from("photo_quotes").update({ issued_at: issuedAt }).eq("id", quoteId).eq("owner_id", user.id).is("issued_at", null);
  if (error) return { ok: false, error: error.message };
  await writeAudit(supabase, { ownerId: user.id, actorId: user.id, entity: "booking", entityId: quote.booking_id, action: "quote.issued", data: { quote_id: quoteId, issued_at: issuedAt } });
  revalidatePricing();
  revalidatePath(`/pricing/quote/${quoteId}`);
  revalidatePath(`/bookings/${quote.booking_id}`);
  return { ok: true };
}
