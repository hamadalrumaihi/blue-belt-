"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "./types";
import { writeAudit } from "@/lib/audit";
import { depositColumnsFor } from "@/lib/bookings/policy";
import { BOOKING_STATUS_LABEL, bookingTransitionColumns, canTransitionBooking } from "@/lib/bookings/state";
import { parseChosenAmount, parsePriceReferenceForm, parseQuoteInputs, validateQuoteInputs, type QuoteInputs } from "@/lib/pricing/form";
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
  const { error, count } = await supabase.from("photo_price_references").update({ ...values, includes: values.includes as Json }, { count: "exact" }).eq("id", id).eq("owner_id", user.id);
  if (error) return { error: error.message };
  if (!count) return { error: "Reference not found or you do not have access to it." };
  await writeAudit(supabase, { ownerId: user.id, actorId: user.id, entity: "studio", entityId: id, action: "price_reference.updated", data: { provider: values.provider, service_type: values.service_type } });
  revalidatePricing();
  revalidatePath(`/pricing/references/${id}/edit`);
  redirect("/pricing");
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
