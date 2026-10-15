"use server";

import { revalidatePath } from "next/cache";
import { writeAudit } from "@/lib/audit";
import { depositColumnsFor } from "@/lib/bookings/policy";
import { composeDivision, type PublicBookingDetails } from "@/lib/bookings/public-form";
import { initialBookingStatus, makePublicRef } from "@/lib/bookings/state";
import { serviceForBookingType } from "@/lib/catalog";
import { isLeadStatus } from "@/lib/leads/labels";
import { bookableAmount } from "@/lib/services/pricing";
import { requireStudioUser } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import type { Json, LeadStatus } from "@/lib/supabase/database.types";
import { isPlainObject, isUuid } from "@/lib/validation";

type Result = { ok: true } | { ok: false; error: string };

export async function setLeadStatus(id: string, status: LeadStatus): Promise<Result> {
  if (!isUuid(id)) return { ok: false, error: "Invalid lead id." };
  if (!isLeadStatus(status)) return { ok: false, error: "Unknown status." };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You are signed out." };
  if (!(await requireStudioUser()).ok) return { ok: false, error: "This action is for the studio team only." };
  const { error, count } = await supabase.from("photo_leads").update({ status }, { count: "exact" }).eq("id", id).eq("owner_id", user.id);
  if (error) return { ok: false, error: error.message };
  if (!count) return { ok: false, error: "Lead not found or you do not have access to it." };
  await writeAudit(supabase, { ownerId: user.id, actorId: user.id, entity: "lead", entityId: id, action: "lead.status", data: { status } });
  revalidatePath("/leads");
  revalidatePath("/studio");
  return { ok: true };
}

/**
 * Turn a lead into a booking the owner can work from Bookings. ONE pricing
 * decision (`bookableAmount`) with the package the lead named: a quote-mode
 * package or a quote-first service starts as an inquiry with no amount; a
 * priced package carries its price and waits for the agreement. Linked both
 * ways and race-safe: the lead is claimed with a `booking_id is null` guard
 * after the booking row exists, so two concurrent clicks end on the one
 * booking that won (the loser's row is removed). Never touches photo_athletes.
 */
export async function convertLeadToBooking(id: string): Promise<(Result & { bookingId?: string })> {
  if (!isUuid(id)) return { ok: false, error: "Invalid lead id." };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You are signed out." };
  if (!(await requireStudioUser()).ok) return { ok: false, error: "This action is for the studio team only." };
  const { data: lead } = await supabase.from("photo_leads").select("*").eq("id", id).eq("owner_id", user.id).maybeSingle();
  if (!lead) return { ok: false, error: "Lead not found or you do not have access to it." };
  if (lead.booking_id) return { ok: true, bookingId: lead.booking_id };

  const person = lead.person_id ? (await supabase.from("photo_people").select("id,full_name,email,phone").eq("id", lead.person_id).maybeSingle()).data : null;
  const org = lead.organization_id ? (await supabase.from("photo_organizations").select("id,name").eq("id", lead.organization_id).maybeSingle()).data : null;
  const details = (isPlainObject(lead.details) ? lead.details : {}) as PublicBookingDetails & { service_id?: string; service_name?: string };
  const serviceId = isUuid(details.service_id) ? details.service_id : null;
  const service = serviceId ? (await supabase.from("photo_services").select("id,name,currency,price_qr,price_mode").eq("id", serviceId).maybeSingle()).data : null;
  const customerName = person?.full_name ?? "Unknown";
  const bookingType = lead.booking_type ?? "custom";
  const price = bookableAmount(service, { quoteFirst: serviceForBookingType(bookingType).quoteFirst });

  const row = {
    owner_id: user.id,
    client_id: person?.id ?? null,
    organization_id: org?.id ?? null,
    service_id: service?.id ?? null,
    lead_id: lead.id,
    event_id: lead.event_id,
    booking_type: bookingType,
    booking_status: initialBookingStatus({ paymentMode: price.paymentMode, amountQr: price.amountQr, requiresContract: true }),
    athlete_name: details.athlete_name ?? customerName,
    customer_name: customerName,
    customer_email: person?.email ?? "",
    customer_phone: person?.phone ?? "",
    academy: details.academy ?? org?.name ?? null,
    division: composeDivision(details.age_division ?? null, details.weight_division ?? null),
    package_name: service?.name ?? details.service_name ?? "Custom",
    amount_qr: price.amountQr,
    currency: service?.currency ?? "QAR",
    payment_mode: price.paymentMode,
    details: details as Json,
    notes: lead.message,
    ...depositColumnsFor(price.amountQr),
  };
  let bookingId: string | null = null;
  for (let attempt = 0; attempt < 3 && !bookingId; attempt += 1) {
    const { data, error } = await supabase.from("photo_bookings").insert({ ...row, public_ref: makePublicRef() }).select("id").single();
    if (data) bookingId = data.id;
    else if (error?.code !== "23505") return { ok: false, error: error?.message ?? "Could not create the booking." };
  }
  if (!bookingId) return { ok: false, error: "Could not allocate a booking reference. Try again." };

  // Claim the lead only while nobody else has: a concurrent conversion that won keeps its booking and ours is withdrawn.
  const { error: linkError, count } = await supabase.from("photo_leads").update({ booking_id: bookingId, status: "converted" }, { count: "exact" }).eq("id", lead.id).eq("owner_id", user.id).is("booking_id", null);
  if (linkError || !count) {
    await supabase.from("photo_bookings").delete().eq("id", bookingId).eq("owner_id", user.id).eq("lead_id", lead.id);
    const { data: winner } = await supabase.from("photo_leads").select("booking_id").eq("id", lead.id).eq("owner_id", user.id).maybeSingle();
    if (winner?.booking_id) return { ok: true, bookingId: winner.booking_id };
    return { ok: false, error: linkError?.message ?? "The lead changed while converting it. Reload and try again." };
  }
  await writeAudit(supabase, { ownerId: user.id, actorId: user.id, entity: "booking", entityId: bookingId, action: "booking.created", data: { source: "lead", lead_id: lead.id, payment_mode: price.paymentMode, amount_qr: price.amountQr } });
  revalidatePath("/leads");
  revalidatePath("/bookings");
  revalidatePath("/studio");
  return { ok: true, bookingId };
}
