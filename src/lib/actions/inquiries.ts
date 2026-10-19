"use server";

import { revalidatePath } from "next/cache";
import { writeAudit } from "@/lib/audit";
import { depositColumnsFor } from "@/lib/bookings/policy";
import { initialBookingStatus, makePublicRef } from "@/lib/bookings/state";
import { bookingTypeForCategory, INQUIRY_NOTE_MAX, isInquiryStatus, readInquiryNotes, type InquiryNote } from "@/lib/inquiries/labels";
import { requireStudioUser } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import type { InquiryStatus, Json } from "@/lib/supabase/database.types";
import { isUuid } from "@/lib/validation";

/**
 * Owner-side inquiry actions (status, private notes, conversion). Guarded by
 * requireStudioUser and again by RLS; every change is audited and the
 * inquiries board, the overview and the metrics are revalidated.
 */
type Result = { ok: true } | { ok: false; error: string };

const PATHS = ["/inquiries", "/studio", "/studio/metrics"];

async function guard(id: string): Promise<{ ok: true; supabase: Awaited<ReturnType<typeof createClient>>; userId: string } | { ok: false; error: string }> {
  if (!isUuid(id)) return { ok: false, error: "Invalid inquiry id." };
  const user = await requireStudioUser();
  if (!user.ok) return { ok: false, error: user.error };
  return { ok: true, supabase: await createClient(), userId: user.viewer.userId };
}

export async function setInquiryStatus(id: string, status: InquiryStatus): Promise<Result> {
  if (!isInquiryStatus(status)) return { ok: false, error: "Unknown status." };
  const g = await guard(id);
  if (!g.ok) return g;
  const { error, count } = await g.supabase.from("photo_inquiries").update({ status }, { count: "exact" }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  if (!count) return { ok: false, error: "Inquiry not found or you do not have access to it." };
  await writeAudit(g.supabase, { ownerId: g.userId, actorId: g.userId, entity: "inquiry", entityId: id, action: "inquiry.status", data: { status } });
  for (const p of PATHS) revalidatePath(p);
  return { ok: true };
}

/** Appends one private note; the note list lives on the row so it is read with the inquiry. */
export async function addInquiryNote(id: string, text: string): Promise<Result> {
  const body = (text ?? "").trim().slice(0, INQUIRY_NOTE_MAX);
  if (!body) return { ok: false, error: "Write a note first." };
  const g = await guard(id);
  if (!g.ok) return g;
  const { data: row } = await g.supabase.from("photo_inquiries").select("notes").eq("id", id).maybeSingle();
  if (!row) return { ok: false, error: "Inquiry not found or you do not have access to it." };
  const note: InquiryNote = { at: new Date().toISOString(), by: g.userId, text: body };
  const notes = [...readInquiryNotes(row.notes), note].slice(-50);
  const { error, count } = await g.supabase.from("photo_inquiries").update({ notes: notes as unknown as Json }, { count: "exact" }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  if (!count) return { ok: false, error: "Inquiry not found or you do not have access to it." };
  await writeAudit(g.supabase, { ownerId: g.userId, actorId: g.userId, entity: "inquiry", entityId: id, action: "inquiry.note", data: { length: body.length } });
  revalidatePath("/inquiries");
  return { ok: true };
}

/**
 * Turns an inquiry into a quote-first booking the owner can price from
 * Bookings (no amount, status inquiry, agreement required), linked both
 * ways and race-safe: the inquiry is claimed with a `booking_id is null`
 * guard after the booking row exists, so two concurrent clicks end on one
 * booking. The CRM person is reused when the inquiry matched one.
 */
export async function convertInquiryToBooking(id: string): Promise<Result & { bookingId?: string }> {
  const g = await guard(id);
  if (!g.ok) return g;
  const { supabase, userId } = g;
  const { data: inquiry } = await supabase.from("photo_inquiries").select("*").eq("id", id).maybeSingle();
  if (!inquiry) return { ok: false, error: "Inquiry not found or you do not have access to it." };
  if (inquiry.booking_id) return { ok: true, bookingId: inquiry.booking_id };

  const person = inquiry.person_id ? (await supabase.from("photo_people").select("id,full_name,email,phone").eq("id", inquiry.person_id).maybeSingle()).data : null;
  const bookingType = bookingTypeForCategory(inquiry.category);
  const row = {
    owner_id: userId,
    client_id: person?.id ?? null,
    booking_type: bookingType,
    booking_status: initialBookingStatus({ paymentMode: "quote", amountQr: 0, requiresContract: true }),
    athlete_name: inquiry.full_name,
    customer_name: person?.full_name ?? inquiry.full_name,
    customer_email: person?.email ?? inquiry.email,
    customer_phone: person?.phone ?? "",
    package_name: "Custom",
    amount_qr: 0,
    currency: "QAR",
    payment_mode: "quote" as const,
    details: { source: "inquiry", inquiry_id: inquiry.id, inquiry_reference: inquiry.reference, inquiry_category: inquiry.category, subject: inquiry.subject, customer_reference: inquiry.booking_reference } as Json,
    notes: `${inquiry.subject}\n\n${inquiry.message}`,
    requires_contract: true,
    contract_state: "required" as const,
    ...depositColumnsFor(0),
  };
  let bookingId: string | null = null;
  for (let attempt = 0; attempt < 3 && !bookingId; attempt += 1) {
    const { data, error } = await supabase.from("photo_bookings").insert({ ...row, public_ref: makePublicRef() }).select("id").single();
    if (data) bookingId = data.id;
    else if (error?.code !== "23505") return { ok: false, error: error?.message ?? "Could not create the booking." };
  }
  if (!bookingId) return { ok: false, error: "Could not allocate a booking reference. Try again." };

  const { error: linkError, count } = await supabase.from("photo_inquiries").update({ booking_id: bookingId, status: "converted" }, { count: "exact" }).eq("id", inquiry.id).is("booking_id", null);
  if (linkError || !count) {
    await supabase.from("photo_bookings").delete().eq("id", bookingId).eq("owner_id", userId);
    const { data: winner } = await supabase.from("photo_inquiries").select("booking_id").eq("id", inquiry.id).maybeSingle();
    if (winner?.booking_id) return { ok: true, bookingId: winner.booking_id };
    return { ok: false, error: linkError?.message ?? "The inquiry changed while converting it. Reload and try again." };
  }
  await writeAudit(supabase, { ownerId: userId, actorId: userId, entity: "booking", entityId: bookingId, action: "booking.created", data: { source: "inquiry", inquiry_id: inquiry.id, inquiry_reference: inquiry.reference, payment_mode: "quote", amount_qr: 0 } });
  await writeAudit(supabase, { ownerId: userId, actorId: userId, entity: "inquiry", entityId: inquiry.id, action: "inquiry.converted", data: { booking_id: bookingId } });
  for (const p of [...PATHS, "/bookings"]) revalidatePath(p);
  return { ok: true, bookingId };
}
