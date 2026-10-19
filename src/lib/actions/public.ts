"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { writeAudit } from "@/lib/audit";
import { depositColumnsFor } from "@/lib/bookings/policy";
import { HONEYPOT_FIELD, SERVICE_LABEL, composeDivision, mediaChoiceLabel, parsePublicBookingForm, summarizePublicBooking, toPublicServiceOption, type PublicBookingValues } from "@/lib/bookings/public-form";
import { parseInquiryForm } from "@/lib/inquiries/form";
import { INQUIRY_CATEGORY_LABEL, makeInquiryRef } from "@/lib/inquiries/labels";
import { BOOKING_TYPE_LABEL, initialBookingStatus } from "@/lib/bookings/state";
import { serviceByKey } from "@/lib/catalog";
import { PRIVACY_VERSION, TERMS_VERSION } from "@/lib/legal/versions";
import { localized } from "@/lib/i18n/locale";
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
              "Once you approve the price you sign the agreement and make the payment stated in your quotation, a deposit or a full advance payment, online to secure the date. Any remaining balance follows the accepted quote.",
            ]
          : [
              `Thanks for your request to ${studio.business_name}. We confirm the date and the price with you by e-mail. Then you sign the agreement and make the payment stated in your quotation, a deposit or a full advance payment, online to secure the date. Any remaining balance follows the accepted quote.`,
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


/**
 * The Contact & Inquiries form. Validated and sanitised by `parseInquiryForm`,
 * stored as one `photo_inquiries` row with a unique IQ- reference (retried
 * on a collision; replayed on the same idempotency key), then the owner is
 * pinged on Telegram and the customer gets an acknowledgment e-mail when the
 * e-mail channel is configured. The success page is reached only after the
 * row exists; a notification failure after that is logged, never surfaced,
 * because the queue is idempotent and the runner retries.
 */
export async function submitInquiry(_prev: PublicFormState, fd: FormData): Promise<PublicFormState> {
  const log = createLogger({ route: "public/inquiry" });
  const ip = await clientIp();
  if (!rateLimit(`public-form:${ip}`, RULES.publicFormPerIp).ok) return { error: RATE_LIMITED };

  const pub = await loadPublicStudio();
  if (!pub) return { error: "The inquiry form is not open yet. Please reach us on Instagram." };
  const ownerId = pub.studio.owner_id;

  const { fieldErrors, values } = parseInquiryForm(fd);
  if (!values) {
    if (fieldErrors[HONEYPOT_FIELD]) return { error: fieldErrors[HONEYPOT_FIELD] };
    return { fieldErrors };
  }

  let ref: string | null = null;
  try {
    const supabase = createServiceClient();
    const now = new Date();
    // The CRM person: matched by e-mail only (never by phone from a public form) and never rewritten.
    const person = await findOrCreatePerson(supabase, ownerId, { fullName: values.full_name, email: values.email, source: "website" }, { trusted: false });
    if (!person.ok) log.warn("public.inquiry.person_failed", { reason: person.error });
    const personId = person.ok ? person.found.person.id : null;

    // A retried submission (double click, reload after a slow response) finds its own row by key.
    if (values.idempotency_key) {
      const { data: existing } = await supabase.from("photo_inquiries").select("id,reference").eq("owner_id", ownerId).eq("idempotency_key", values.idempotency_key).maybeSingle();
      if (existing) {
        log.info("public.inquiry.idempotent_replay", { inquiryId: existing.id });
        ref = existing.reference;
      }
    }

    let inquiryId: string | null = null;
    for (let attempt = 0; attempt < 3 && !ref; attempt += 1) {
      const candidate = makeInquiryRef();
      const { data, error } = await supabase
        .from("photo_inquiries")
        .insert({
          owner_id: ownerId,
          reference: candidate,
          person_id: personId,
          full_name: values.full_name,
          email: values.email,
          category: values.category,
          subject: values.subject,
          message: values.message,
          booking_reference: values.booking_reference,
          source_page: values.source_page,
          idempotency_key: values.idempotency_key,
          details: { form: "contact-inquiries" } as Json,
        })
        .select("id")
        .single();
      if (data) {
        inquiryId = data.id;
        ref = candidate;
      } else if (error?.code === "23505") {
        // Either the reference collided (retry with a new one) or the key already exists (replay): re-read.
        if (values.idempotency_key) {
          const { data: again } = await supabase.from("photo_inquiries").select("id,reference").eq("owner_id", ownerId).eq("idempotency_key", values.idempotency_key).maybeSingle();
          if (again) {
            inquiryId = again.id;
            ref = again.reference;
          }
        }
      } else {
        log.error("public.inquiry.insert_failed", { reason: error?.message, code: error?.code });
        return { error: GENERIC_ERROR };
      }
    }
    if (!ref) {
      log.error("public.inquiry.ref_exhausted");
      return { error: GENERIC_ERROR };
    }

    // From here on the inquiry exists; nothing below may change the outcome.
    if (inquiryId) {
      const audit = await writeAudit(supabase, { ownerId, actorKind: "public", entity: "inquiry", entityId: inquiryId, action: "inquiry.created", data: { source: "website", category: values.category, source_page: values.source_page, reference: ref } });
      if (!audit.ok) log.warn("public.inquiry.audit_failed", { reason: audit.error });
    }
    const category = localized(INQUIRY_CATEGORY_LABEL[values.category], "en");
    const tg = await enqueueOwnerTelegram(supabase, {
      ownerId,
      kind: "INQUIRY_NEW",
      alertKey: `inquiry:${ref}:new`,
      title: `New inquiry: ${category}`,
      lines: [
        `${values.full_name} · ${values.subject}`,
        values.message.length > 240 ? `${values.message.slice(0, 240)}...` : values.message,
        values.booking_reference ? `Customer reference: ${values.booking_reference}` : null,
        values.source_page ? `From ${values.source_page}` : null,
        `Ref ${ref}`,
      ],
      url: `${siteUrl()}/inquiries`,
      now,
    });
    if (!tg.ok) log.warn("public.inquiry.telegram_failed", { reason: tg.error });

    const email = await enqueueClientEmail(supabase, {
      ownerId,
      kind: "INQUIRY_RECEIVED",
      alertKey: `email:inquiry:${ref}:received`,
      personId,
      now,
      draft: buildEmail(values.email, {
        kind: "INQUIRY_RECEIVED",
        subject: `We received your inquiry (${ref})`,
        greeting: `Hi ${values.full_name},`,
        paragraphs: [
          `Thanks for writing to ${pub.studio.business_name}. Your message about "${values.subject}" is with us and we reply by e-mail as soon as we can.`,
          "Sending an inquiry does not require any payment. If your request leads to a booking, we confirm the scope and the price in writing first; a deposit or full advance payment may then be required as stated in your quotation.",
        ],
        facts: [["Reference", ref], ["Inquiry type", category], ...(values.booking_reference ? [["Your reference", values.booking_reference] as [string, string]] : [])],
        cta: null,
        footer: `${pub.studio.business_name} · This message confirms we received your inquiry.`,
        businessName: pub.studio.business_name,
      }),
    });
    if (!email.ok) log.warn("public.inquiry.email_failed", { reason: email.error });
    log.info("public.inquiry.created", { inquiryId, category: values.category, sourcePage: values.source_page });
  } catch (err) {
    log.error("public.inquiry.unhandled", { reason: err instanceof Error ? err.message : String(err) });
    if (!ref) return { error: GENERIC_ERROR };
  }
  redirect(`/contact?sent=${encodeURIComponent(ref)}`);
}
