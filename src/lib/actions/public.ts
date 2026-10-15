"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { writeAudit } from "@/lib/audit";
import { depositColumnsFor } from "@/lib/bookings/policy";
import { HONEYPOT_FIELD, SERVICE_LABEL, composeDivision, mediaChoiceLabel, parseContactForm, parsePublicBookingForm, summarizePublicBooking, toPublicServiceOption, type PublicBookingValues } from "@/lib/bookings/public-form";
import { BOOKING_TYPE_LABEL, initialBookingStatus } from "@/lib/bookings/state";
import { serviceByKey } from "@/lib/catalog";
import { PRIVACY_VERSION, TERMS_VERSION } from "@/lib/legal/versions";
import { createLogger } from "@/lib/log";
import { enqueueClientEmail } from "@/lib/notifications/email/outbox";
import { buildEmail } from "@/lib/notifications/email/templates";
import { enqueueOwnerTelegram } from "@/lib/notifications/owner";
import { findOrCreatePerson, normalizeInstagram } from "@/lib/people/match";
import { enqueuePricingAssessment } from "@/lib/pricing/assess-hook";
import { RULES, rateLimit } from "@/lib/rate-limit";
import { bookableAmount } from "@/lib/services/pricing";
import { listPublicEvents } from "@/lib/studio/public-events";
import { loadPublicStudio, siteUrl } from "@/lib/studio/queries";
import { createServiceClient } from "@/lib/supabase/service";
import { todayInZone } from "@/lib/time";
import type { Json, PersonKind } from "@/lib/supabase/database.types";
import { isPlainObject, isUuid } from "@/lib/validation";

export type PublicFormState = { error?: string; fieldErrors?: Record<string, string> } | null;

type Outcome = { ref: string } | { error: string } | { fieldErrors: Record<string, string> };

const GENERIC_ERROR = "Something went wrong on our side. Your request was not saved. Please try again in a minute, or e-mail us.";
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

async function userAgent(): Promise<string | null> {
  const h = await headers();
  const ua = h.get("user-agent")?.trim();
  return ua ? ua.slice(0, 512) : null;
}

function personKindFor(v: PublicBookingValues): PersonKind {
  if (v.booking_type === "club" || v.client_type === "club_team" || v.client_type === "company_brand" || v.client_type === "event_organiser") return "club_contact";
  if (v.client_type === "parent_guardian") return "parent";
  return "person";
}

type SubmissionResult = { booking_id: string; lead_id: string | null; person_id: string | null; public_ref: string; replay: boolean };

/** The RPC's jsonb result, checked field by field (never trusted blindly). */
function readSubmissionResult(data: unknown): SubmissionResult | null {
  if (!isPlainObject(data)) return null;
  const bookingId = data.booking_id;
  const ref = data.public_ref;
  if (!isUuid(bookingId) || typeof ref !== "string" || !ref) return null;
  return {
    booking_id: bookingId,
    lead_id: isUuid(data.lead_id) ? data.lead_id : null,
    person_id: isUuid(data.person_id) ? data.person_id : null,
    public_ref: ref,
    replay: data.replay === true,
  };
}

/**
 * The website request wizard. The owner is the studio that opened public
 * booking; the amount comes from ONE pricing decision (`bookableAmount`) on
 * the package the visitor picked, so a quote-mode package never books at a
 * price; the deposit split is computed here. Person, organisation, lead,
 * booking and audit rows are written by `photo_submit_public_booking` in one
 * transaction keyed by the wizard's idempotency key; only after that
 * returns are the owner and the client notified and the private pricing
 * assessment queued, and none of those can change the outcome. Nothing is
 * charged, no payment request and no document is created: the owner reviews
 * first. The done page is reached only after the booking row exists.
 */
export async function submitPublicBooking(_prev: PublicFormState, fd: FormData): Promise<PublicFormState> {
  const log = createLogger({ route: "public/book" });
  const ip = await clientIp();
  if (!rateLimit(`public-form:${ip}`, RULES.publicFormPerIp).ok) return { error: RATE_LIMITED };

  const pub = await loadPublicStudio();
  if (!pub) return { error: "Booking is not open yet." };
  const { studio, services } = pub;
  const ownerId = studio.owner_id;

  const run = async (): Promise<Outcome> => {
    const supabase = createServiceClient();
    const events = await listPublicEvents(ownerId, supabase);
    const offered = services.map(toPublicServiceOption);
    const { fieldErrors, values } = parsePublicBookingForm(fd, { events, services: offered, today: todayInZone() });
    if (!values) {
      if (fieldErrors[HONEYPOT_FIELD]) return { error: fieldErrors[HONEYPOT_FIELD] };
      return { fieldErrors };
    }

    const isClub = values.booking_type === "club";
    const catalog = serviceByKey(values.service_key);
    const service = values.service_id ? services.find((s) => s.id === values.service_id) ?? null : null;
    const price = bookableAmount(service, { quoteFirst: catalog.quoteFirst });
    const { quoteOnly, amountQr, paymentMode } = price;
    const now = new Date();
    const nowIso = now.toISOString();
    const ua = await userAgent();

    const legalAcceptance = {
      terms_version: TERMS_VERSION,
      privacy_version: PRIVACY_VERSION,
      accepted_at: nowIso,
      ip,
      user_agent: ua,
      consents: values.consents,
    };
    const guardian = values.guardian ? { name: values.guardian.name, email: values.guardian.email, phone: values.guardian.phone, consent_at: nowIso } : null;
    const deposit = depositColumnsFor(amountQr);

    const bookingRow = {
      service_id: service?.id ?? null,
      event_id: values.event_id,
      booking_type: values.booking_type,
      athlete_name: values.athlete_name,
      customer_name: values.full_name,
      customer_email: values.email,
      customer_phone: values.phone,
      academy: values.academy ?? values.club_name,
      division: composeDivision(values.age_division, values.weight_division),
      location: values.location,
      package_name: service?.name ?? "Custom",
      amount_qr: amountQr,
      currency: service?.currency ?? "QAR",
      payment_mode: paymentMode,
      booking_status: initialBookingStatus({ paymentMode, amountQr, requiresContract: true }),
      details: { ...values.details, consent_accepted_at: nowIso },
      notes: values.notes,
      client_type: values.client_type,
      usage_type: values.usage_type,
      subject_is_minor: values.subject_is_minor,
      guardian,
      legal_acceptance: legalAcceptance,
      requires_contract: true,
      requires_guardian_release: values.subject_is_minor,
      contract_state: "required",
      ...deposit,
    };

    const audit: Array<{ action: string; data: Record<string, Json> }> = [
      { action: "booking.created", data: { source: "website", booking_type: values.booking_type, service_key: values.service_key, service_kind: values.service_kind, media_scope: values.media_scope, client_type: values.client_type, usage_type: values.usage_type, subject_is_minor: values.subject_is_minor, payment_mode: paymentMode, price_mode: price.priceMode, amount_qr: amountQr, deposit_qr: deposit.deposit_qr, balance_qr: deposit.balance_qr } },
      { action: "legal.accepted", data: { terms_version: TERMS_VERSION, privacy_version: PRIVACY_VERSION, accepted_at: nowIso, consents: values.consents, ip, user_agent: ua } },
    ];
    if (values.guardian) audit.push({ action: "guardian.consent", data: { guardian_name: values.guardian.name, consent_at: nowIso, ip, user_agent: ua } });

    const { data, error } = await supabase.rpc("photo_submit_public_booking", {
      p_owner_id: ownerId,
      p_idempotency_key: values.idempotency_key,
      p_person: { full_name: values.full_name, email: values.email, phone: values.phone, instagram: normalizeInstagram(values.instagram), kind: personKindFor(values), source: "website" },
      p_organization: isClub && values.club_name ? { name: values.club_name, kind: "club", email: values.email, phone: values.phone, instagram: values.instagram } : null,
      p_lead: { event_id: values.event_id, booking_type: values.booking_type, status: "new", source: "website", message: values.notes, details: { ...values.details, service_id: values.service_id, service_name: service?.name ?? null } },
      p_booking: bookingRow as unknown as Json,
      p_audit: audit as unknown as Json,
    });
    if (error) {
      log.error("public.booking.submit_failed", { reason: error.message, code: error.code });
      return { error: GENERIC_ERROR };
    }
    const result = readSubmissionResult(data);
    if (!result) {
      log.error("public.booking.submit_malformed");
      return { error: GENERIC_ERROR };
    }
    const { booking_id: bookingId, public_ref: ref } = result;
    // A retry, a double click or a reload after a slow response: same key, same booking. The notices
    // below are keyed by alert_key, so re-enqueueing them is idempotent and repairs a first attempt
    // that committed but died before notifying.
    if (result.replay) log.info("public.booking.idempotent_replay", { bookingId });

    // From here on the booking exists; nothing below may change the outcome.
    const summary = summarizePublicBooking(values, offered);
    const pick = (label: string) => summary.find(([k]) => k === label)?.[1] ?? null;
    const tg = await enqueueOwnerTelegram(supabase, {
      ownerId,
      kind: "BOOKING_NEW",
      alertKey: `booking:${bookingId}:new`,
      title: "New booking request",
      lines: [
        `${BOOKING_TYPE_LABEL[values.booking_type]}: ${SERVICE_LABEL[values.service_key].title}, ${mediaChoiceLabel(values.media_scope).toLowerCase()}`,
        isClub ? `${values.club_name ?? ""}, contact ${values.full_name}` : values.athlete_name,
        [pick("Event"), pick("Date") ?? pick("Preferred date")].filter(Boolean).join(" · ") || null,
        service ? `${service.name} (${quoteOnly ? "quote" : offered.find((s) => s.id === service.id)?.price_label ?? "priced"})` : "No package (quote)",
        pick("Budget") ? `Budget: ${pick("Budget")}` : null,
        values.subject_is_minor ? `Under 18, guardian: ${values.guardian?.name ?? "?"}` : null,
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
      personId: result.person_id,
      bookingId,
      now,
      draft: buildEmail(values.email, {
        kind: "BOOKING_RECEIVED",
        subject: `We received your booking request (${ref})`,
        greeting: `Hi ${values.full_name},`,
        paragraphs: quoteOnly
          ? [
              `Thanks for your request to ${studio.business_name}. This request is quoted individually: we send you a price first, by e-mail, and nothing is due until you approve it.`,
              "Once you approve the price you sign the agreement and pay the 50% deposit online to secure the date. The remaining 50% is due after your gallery is delivered.",
            ]
          : [
              `Thanks for your request to ${studio.business_name}. We confirm the date and the price with you by e-mail. Then you sign the agreement and pay the 50% deposit online to secure the date. The remaining 50% is due after your gallery is delivered.`,
              "Nothing is due until we have confirmed availability and the price with you.",
            ],
        facts: [["Reference", ref], ...summary.filter(([k]) => !["Name", "Phone", "E-mail", "Instagram", "Notes"].includes(k))],
        cta: { label: "View my bookings", url: `${siteUrl()}/client` },
        businessName: studio.business_name,
      }),
    });
    if (!email.ok) log.warn("public.booking.email_failed", { reason: email.error });

    try {
      const assessment = await enqueuePricingAssessment(supabase, { ownerId, bookingId, leadId: result.lead_id, reason: "public_submission" });
      if (!assessment.ok) log.warn("public.booking.assessment_failed", { reason: assessment.error });
    } catch (err) {
      log.warn("public.booking.assessment_failed", { reason: err instanceof Error ? err.message : String(err) });
    }

    log.info("public.booking.created", { bookingId, bookingType: values.booking_type, serviceKey: values.service_key, mediaScope: values.media_scope, paymentMode, minor: values.subject_is_minor });
    return { ref };
  };

  let outcome: Outcome;
  try {
    outcome = await run();
  } catch (err) {
    log.error("public.booking.unhandled", { reason: err instanceof Error ? err.message : String(err) });
    return { error: GENERIC_ERROR };
  }
  if ("ref" in outcome) redirectToDone(outcome.ref);
  return outcome;
}

/** The done page is reached only with a reference that exists in the database. `redirect()` throws, so it runs outside the try block. */
function redirectToDone(ref: string): never {
  redirect(`/book/done?ref=${encodeURIComponent(ref)}`);
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
  if (!values) {
    if (fieldErrors[HONEYPOT_FIELD]) return { error: fieldErrors[HONEYPOT_FIELD] };
    return { fieldErrors };
  }

  try {
    const supabase = createServiceClient();
    const person = await findOrCreatePerson(supabase, ownerId, { fullName: values.full_name, email: values.email, phone: values.phone, source: "website" }, { trusted: false });
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
      lines: [values.full_name, values.message.length > 240 ? `${values.message.slice(0, 240)}...` : values.message],
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
