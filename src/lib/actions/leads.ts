"use server";

import { revalidatePath } from "next/cache";
import { writeAudit } from "@/lib/audit";
import { composeDivision, type PublicBookingDetails } from "@/lib/bookings/public-form";
import { makePublicRef } from "@/lib/bookings/state";
import { isLeadStatus } from "@/lib/leads/labels";
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
  const { error, count } = await supabase.from("photo_leads").update({ status }, { count: "exact" }).eq("id", id).eq("owner_id", user.id);
  if (error) return { ok: false, error: error.message };
  if (!count) return { ok: false, error: "Lead not found or you do not have access to it." };
  await writeAudit(supabase, { ownerId: user.id, actorId: user.id, entity: "lead", entityId: id, action: "lead.status", data: { status } });
  revalidatePath("/leads");
  revalidatePath("/studio");
  return { ok: true };
}

/**
 * Turn a lead into a booking the owner can work from Bookings. Starts as an
 * inquiry with a quote (no amount, no payment), linked both ways. Never
 * touches photo_athletes.
 */
export async function convertLeadToBooking(id: string): Promise<(Result & { bookingId?: string })> {
  if (!isUuid(id)) return { ok: false, error: "Invalid lead id." };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You are signed out." };
  const { data: lead } = await supabase.from("photo_leads").select("*").eq("id", id).eq("owner_id", user.id).maybeSingle();
  if (!lead) return { ok: false, error: "Lead not found or you do not have access to it." };
  if (lead.booking_id) return { ok: true, bookingId: lead.booking_id };

  const person = lead.person_id ? (await supabase.from("photo_people").select("id,full_name,email,phone").eq("id", lead.person_id).maybeSingle()).data : null;
  const org = lead.organization_id ? (await supabase.from("photo_organizations").select("id,name").eq("id", lead.organization_id).maybeSingle()).data : null;
  const details = (isPlainObject(lead.details) ? lead.details : {}) as PublicBookingDetails & { service_id?: string; service_name?: string };
  const serviceId = isUuid(details.service_id) ? details.service_id : null;
  const service = serviceId ? (await supabase.from("photo_services").select("id,name,currency").eq("id", serviceId).maybeSingle()).data : null;
  const customerName = person?.full_name ?? "Unknown";
  const bookingType = lead.booking_type ?? "custom";

  const row = {
    owner_id: user.id,
    client_id: person?.id ?? null,
    organization_id: org?.id ?? null,
    service_id: service?.id ?? null,
    lead_id: lead.id,
    event_id: lead.event_id,
    booking_type: bookingType,
    booking_status: "inquiry" as const,
    athlete_name: details.athlete_name ?? customerName,
    customer_name: customerName,
    customer_email: person?.email ?? "",
    customer_phone: person?.phone ?? "",
    academy: details.academy ?? org?.name ?? null,
    division: composeDivision(details.age_division ?? null, details.weight_division ?? null),
    package_name: service?.name ?? details.service_name ?? "Custom",
    amount_qr: 0,
    currency: service?.currency ?? "QAR",
    payment_mode: "quote" as const,
    details: details as Json,
    notes: lead.message,
  };
  let bookingId: string | null = null;
  for (let attempt = 0; attempt < 3 && !bookingId; attempt += 1) {
    const { data, error } = await supabase.from("photo_bookings").insert({ ...row, public_ref: makePublicRef() }).select("id").single();
    if (data) bookingId = data.id;
    else if (error?.code !== "23505") return { ok: false, error: error?.message ?? "Could not create the booking." };
  }
  if (!bookingId) return { ok: false, error: "Could not allocate a booking reference. Try again." };
  await supabase.from("photo_leads").update({ booking_id: bookingId, status: "converted" }).eq("id", lead.id).eq("owner_id", user.id);
  await writeAudit(supabase, { ownerId: user.id, actorId: user.id, entity: "booking", entityId: bookingId, action: "booking.created", data: { source: "lead", lead_id: lead.id } });
  revalidatePath("/leads");
  revalidatePath("/bookings");
  revalidatePath("/studio");
  return { ok: true, bookingId };
}
