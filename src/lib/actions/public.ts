"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { writeAudit } from "@/lib/audit";
import { composeDivision, parseContactForm, parsePublicBookingForm, summarizePublicBooking } from "@/lib/bookings/public-form";
import { BOOKING_TYPE_LABEL, initialBookingStatus, makePublicRef } from "@/lib/bookings/state";
import { createLogger } from "@/lib/log";
import { enqueueClientEmail } from "@/lib/notifications/email/outbox";
import { buildEmail } from "@/lib/notifications/email/templates";
import { enqueueOwnerTelegram } from "@/lib/notifications/owner";
import { findOrCreatePerson } from "@/lib/people/match";
import { RULES, rateLimit } from "@/lib/rate-limit";
import { listPublicEvents } from "@/lib/studio/public-events";
import { loadPublicStudio, siteUrl } from "@/lib/studio/queries";
import { createServiceClient } from "@/lib/supabase/service";
import { todayInZone } from "@/lib/time";
import type { Database, Json, PaymentMode } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;

export type PublicFormState = { error?: string; fieldErrors?: Record<string, string> } | null;

const GENERIC_ERROR = "Something went wrong on our side. Please try again, or message us on WhatsApp.";
const RATE_LIMITED = "Too many requests from your connection. Please wait a few minutes and try again.";

async function clientIp(): Promise<string> {
  const h = await headers();
  const fwd = h.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  return h.get("x-real-ip")?.trim() || "unknown";
}

/** Postgres LIKE pattern for an exact, case-insensitive name match. */
function likeExact(name: string): string {
  return name.replace(/[\\%_]/g, (c) => `\\${c}`);
}

async function upsertOrganization(supabase: Client, ownerId: string, name: string, contact: { personId: string; email: string; phone: string; instagram: string | null }): Promise<string | null> {
  const { data: existing } = await supabase.from("photo_organizations").select("id").eq("owner_id", ownerId).ilike("name", likeExact(name)).limit(1).maybeSingle();
  if (existing) return existing.id;
  const { data } = await supabase
    .from("photo_organizations")
    .insert({ owner_id: ownerId, name, kind: "club", primary_contact_id: contact.personId, email: contact.email, phone: contact.phone, instagram: contact.instagram })
    .select("id")
    .single();
  return data?.id ?? null;
}

/**
 * The website booking wizard. The owner is the studio that opened public
 * booking; prices come from the service row the visitor picked; nothing is
 * charged and no payment link is sent — the owner confirms first.
 */
export async function submitPublicBooking(_prev: PublicFormState, fd: FormData): Promise<PublicFormState> {
  const log = createLogger({ route: "public/book" });
  const ip = await clientIp();
  if (!rateLimit(`public-form:${ip}`, RULES.publicFormPerIp).ok) return { error: RATE_LIMITED };

  const pub = await loadPublicStudio();
  if (!pub) return { error: "Booking is not open yet." };
  const { studio, services } = pub;
  const ownerId = studio.owner_id;

  let publicRef: string;
  try {
    const supabase = createServiceClient();
    const events = await listPublicEvents(ownerId, supabase);
    const { fieldErrors, values } = parsePublicBookingForm(fd, { events, services, today: todayInZone() });
    if (!values) return { fieldErrors };

    const isClub = values.booking_type === "club";
    const person = await findOrCreatePerson(supabase, ownerId, {
      fullName: values.full_name,
      email: values.email,
      phone: values.phone,
      instagram: values.instagram,
      kind: isClub ? "club_contact" : values.details.booked_for === "child" ? "parent" : values.details.booked_for === "athlete" ? "coach" : "person",
      source: "website",
    });
    if (!person.ok) {
      log.error("public.booking.person_failed", { reason: person.error });
      return { error: GENERIC_ERROR };
    }
    const personId = person.found.person.id;
    const organizationId = isClub && values.club_name ? await upsertOrganization(supabase, ownerId, values.club_name, { personId, email: values.email, phone: values.phone, instagram: values.instagram }) : null;

    const service = values.service_id ? services.find((s) => s.id === values.service_id) ?? null : null;
    const quoteOnly = isClub || values.booking_type === "custom" || !service || service.price_qr === null;
    const paymentMode: PaymentMode = quoteOnly ? "quote" : "link_later";
    const amountQr = quoteOnly ? 0 : Number(service.price_qr);
    const now = new Date();

    const { data: lead, error: leadError } = await supabase
      .from("photo_leads")
      .insert({
        owner_id: ownerId,
        person_id: personId,
        organization_id: organizationId,
        event_id: values.event_id,
        booking_type: values.booking_type,
        status: "new",
        source: "website",
        message: values.notes,
        details: { ...values.details, service_id: values.service_id, service_name: service?.name ?? null } as Json,
      })
      .select("id")
      .single();
    if (leadError || !lead) {
      log.error("public.booking.lead_failed", { reason: leadError?.message });
      return { error: GENERIC_ERROR };
    }

    const bookingRow = {
      owner_id: ownerId,
      client_id: personId,
      organization_id: organizationId,
      service_id: service?.id ?? null,
      lead_id: lead.id,
      event_id: values.event_id,
      booking_type: values.booking_type,
      athlete_name: values.athlete_name,
      customer_name: values.full_name,
      customer_email: values.email,
      customer_phone: values.phone,
      academy: values.academy ?? values.club_name,
      division: composeDivision(values.age_division, values.weight_division),
      package_name: service?.name ?? "Custom",
      amount_qr: amountQr,
      currency: service?.currency ?? "QAR",
      payment_mode: paymentMode,
      booking_status: initialBookingStatus({ paymentMode, amountQr, requiresContract: false }),
      details: { ...values.details, consent_accepted_at: now.toISOString() } as Json,
      notes: values.notes,
    };

    let bookingId: string | null = null;
    let ref = "";
    for (let attempt = 0; attempt < 3 && !bookingId; attempt += 1) {
      ref = makePublicRef();
      const { data, error } = await supabase.from("photo_bookings").insert({ ...bookingRow, public_ref: ref }).select("id").single();
      if (data) bookingId = data.id;
      else if (error?.code !== "23505") {
        log.error("public.booking.insert_failed", { reason: error?.message });
        return { error: GENERIC_ERROR };
      }
    }
    if (!bookingId) {
      log.error("public.booking.ref_exhausted");
      return { error: GENERIC_ERROR };
    }
    publicRef = ref;

    await supabase.from("photo_leads").update({ booking_id: bookingId }).eq("id", lead.id).eq("owner_id", ownerId);

    const audit = await writeAudit(supabase, { ownerId, actorKind: "public", entity: "booking", entityId: bookingId, action: "booking.created", data: { source: "website", booking_type: values.booking_type, lead_id: lead.id, public_ref: ref, payment_mode: paymentMode } });
    if (!audit.ok) log.warn("public.booking.audit_failed", { reason: audit.error });

    const summary = summarizePublicBooking(values, services);
    const pick = (label: string) => summary.find(([k]) => k === label)?.[1] ?? null;
    const tg = await enqueueOwnerTelegram(supabase, {
      ownerId,
      kind: "BOOKING_NEW",
      alertKey: `booking:${bookingId}:new`,
      title: "New booking request",
      lines: [
        BOOKING_TYPE_LABEL[values.booking_type],
        isClub ? `${values.club_name ?? ""} — ${values.full_name}` : values.athlete_name,
        [pick("Event"), pick("Date") ?? pick("Preferred date")].filter(Boolean).join(" · ") || null,
        service ? `${service.name}${service.price_qr === null ? " (quote)" : ""}` : "Custom (quote)",
        `Phone: ${values.phone}`,
        `Ref ${ref}`,
      ],
      url: `${siteUrl()}/bookings/${bookingId}`,
      now,
    });
    if (!tg.ok) log.warn("public.booking.telegram_failed", { reason: tg.error });

    const email = await enqueueClientEmail(supabase, {
      ownerId,
      kind: "BOOKING_RECEIVED",
      alertKey: `email:booking:${bookingId}:received`,
      personId,
      bookingId,
      now,
      draft: buildEmail(values.email, {
        kind: "BOOKING_RECEIVED",
        subject: `We received your booking request (${ref})`,
        greeting: `Hi ${values.full_name},`,
        paragraphs: [
          `Thanks for booking with ${studio.business_name}. We will look at the details and confirm within 24 hours.`,
          quoteOnly ? "This request is quoted individually: we will send you a price before anything is booked." : "Once confirmed, a payment link follows by e-mail or WhatsApp. Nothing has been charged.",
        ],
        facts: [["Reference", ref], ...summary.filter(([k]) => !["Name", "Phone", "E-mail", "Instagram", "Notes"].includes(k))],
        cta: { label: "View my bookings", url: `${siteUrl()}/client` },
        businessName: studio.business_name,
      }),
    });
    if (!email.ok) log.warn("public.booking.email_failed", { reason: email.error });

    log.info("public.booking.created", { bookingId, bookingType: values.booking_type, paymentMode });
  } catch (err) {
    log.error("public.booking.unhandled", { reason: err instanceof Error ? err.message : String(err) });
    return { error: GENERIC_ERROR };
  }
  redirect(`/book/done?ref=${encodeURIComponent(publicRef)}`);
}

/** The contact form: a lead for the owner, nothing else. */
export async function submitContact(_prev: PublicFormState, fd: FormData): Promise<PublicFormState> {
  const log = createLogger({ route: "public/contact" });
  const ip = await clientIp();
  if (!rateLimit(`public-form:${ip}`, RULES.publicFormPerIp).ok) return { error: RATE_LIMITED };

  const pub = await loadPublicStudio();
  if (!pub) return { error: "The contact form is not open yet. Please reach us on Instagram." };
  const ownerId = pub.studio.owner_id;

  const { fieldErrors, values } = parseContactForm(fd);
  if (!values) return { fieldErrors };

  try {
    const supabase = createServiceClient();
    const person = await findOrCreatePerson(supabase, ownerId, { fullName: values.full_name, email: values.email, phone: values.phone, source: "website" });
    if (!person.ok) {
      log.error("public.contact.person_failed", { reason: person.error });
      return { error: GENERIC_ERROR };
    }
    const { data: lead, error } = await supabase
      .from("photo_leads")
      .insert({ owner_id: ownerId, person_id: person.found.person.id, status: "new", source: "website", message: values.message, details: { form: "contact" } as Json })
      .select("id")
      .single();
    if (error || !lead) {
      log.error("public.contact.lead_failed", { reason: error?.message });
      return { error: GENERIC_ERROR };
    }
    const audit = await writeAudit(supabase, { ownerId, actorKind: "public", entity: "lead", entityId: lead.id, action: "lead.created", data: { source: "website", form: "contact" } });
    if (!audit.ok) log.warn("public.contact.audit_failed", { reason: audit.error });
    const tg = await enqueueOwnerTelegram(supabase, {
      ownerId,
      kind: "LEAD_NEW",
      alertKey: `lead:${lead.id}:new`,
      title: "New website message",
      lines: [values.full_name, values.message.length > 240 ? `${values.message.slice(0, 240)}…` : values.message],
      url: `${siteUrl()}/leads`,
    });
    if (!tg.ok) log.warn("public.contact.telegram_failed", { reason: tg.error });
    log.info("public.contact.created", { leadId: lead.id });
  } catch (err) {
    log.error("public.contact.unhandled", { reason: err instanceof Error ? err.message : String(err) });
    return { error: GENERIC_ERROR };
  }
  redirect("/contact?sent=1");
}
