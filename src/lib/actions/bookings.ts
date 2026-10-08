"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { writeAudit } from "@/lib/audit";
import { requireOwnedAthlete, requireOwnedEvent } from "@/lib/authz";
import { bookingEmailAlertKey, bookingEmailDraft, type BookingEmailKind, type BookingEmailOptions } from "@/lib/bookings/emails";
import { parseBookingForm, parseFinalAmount, parseManualPayment } from "@/lib/bookings/form";
import { BOOKING_STATUS_LABEL, BOOKING_TYPE_LABEL, bookingTransitionColumns, canTransitionBooking, effectivePayment, formatQr, initialBookingStatus, isBookingStatus, makePublicRef, PAYMENT_METHOD_LABEL, PAYMENT_REQUEST_BLOCKER_LABEL, paymentRequestBlocker } from "@/lib/bookings/state";
import { parseClientForm } from "@/lib/client-form";
import { createLogger } from "@/lib/log";
import { enqueueClientEmail } from "@/lib/notifications/email/outbox";
import { enqueueOwnerTelegram } from "@/lib/notifications/owner";
import { findOrCreatePerson } from "@/lib/people/match";
import { isPaymentsEnabled } from "@/lib/payments/config";
import { MYFATOORAH_PROVIDER } from "@/lib/payments/myfatoorah/client";
import { createPayToken, isWebsitePayUrl, payPageUrl } from "@/lib/payments/pay-token";
import { rateLimit, RULES } from "@/lib/rate-limit";
import { DEFAULT_STUDIO, loadStudio, siteUrl } from "@/lib/studio/queries";
import { requireStudioUser } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import type { BookingStatus, Json, PhotoBookingRow } from "@/lib/supabase/database.types";
import { formatDateTime, zoneLabel } from "@/lib/time";
import { isUuid } from "@/lib/validation";

/**
 * Owner actions for the booking lifecycle. Every write goes through the
 * user client (RLS = the owner's rows only). `photo_bookings.status` is the
 * PROVIDER payment status and is never written here: a manual payment
 * updates the manual summary columns and the lifecycle, the webhook owns
 * the rest. Nothing here creates a tracked athlete except the explicit
 * createAthleteFromBooking / linkBookingToAthlete owner actions.
 */
export type BookingFormState = { error?: string; fieldErrors?: Record<string, string>; saved?: boolean } | null;
export type BookingActionResult = { ok: true } | { ok: false; error: string };

type Client = Awaited<ReturnType<typeof createClient>>;

const PUBLIC_REF_ATTEMPTS = 5;
const PG_UNIQUE_VIOLATION = "23505";
const PRE_CONFIRMATION: readonly BookingStatus[] = ["inquiry", "quoted", "awaiting_contract", "awaiting_payment"];

async function owner() {
  const supabase = await createClient();
  // Studio team only: a client-portal account gets `user: null` here, which every
  // caller turns into a clear error. RLS (photo_is_studio_user) enforces the same.
  const guard = await requireStudioUser();
  const user = guard.ok ? ({ id: guard.viewer.userId, email: guard.viewer.email } as { id: string; email: string | null }) : null;
  return { supabase, user };
}

async function ownedBooking(supabase: Client, id: string): Promise<PhotoBookingRow | null> {
  const { data } = await supabase.from("photo_bookings").select("*").eq("id", id).maybeSingle();
  return data ?? null;
}

function revalidateBooking(id: string, personId?: string | null) {
  revalidatePath("/bookings");
  revalidatePath(`/bookings/${id}`);
  revalidatePath("/payments");
  revalidatePath("/studio");
  if (personId) revalidatePath(`/people/${personId}`);
}

async function emailOptions(): Promise<Pick<BookingEmailOptions, "businessName">> {
  const studio = await loadStudio().catch(() => null);
  return { businessName: studio?.business_name ?? DEFAULT_STUDIO.business_name };
}

/** Queues one client e-mail about a booking; never throws, never blocks the action. */
async function sendBookingEmail(supabase: Client, booking: PhotoBookingRow, kind: BookingEmailKind, extra: Partial<BookingEmailOptions> & { suffix?: string | null } = {}): Promise<void> {
  if (!booking.customer_email) return;
  try {
    const base = await emailOptions();
    const draft = bookingEmailDraft(kind, booking, { ...base, portalUrl: `${siteUrl()}/client/bookings/${booking.id}`, ...extra });
    if (!draft) return;
    await enqueueClientEmail(supabase, { ownerId: booking.owner_id, kind, alertKey: bookingEmailAlertKey(kind, booking.id, extra.suffix), draft, personId: booking.client_id, bookingId: booking.id });
  } catch (err) {
    createLogger({ route: "actions/bookings" }).warn("booking.email_enqueue_failed", { bookingId: booking.id, kind, error: err instanceof Error ? err.message : "unknown" });
  }
}

function bookingLabel(b: Pick<PhotoBookingRow, "customer_name" | "public_ref" | "package_name">): string {
  return `${b.customer_name}${b.public_ref ? ` · ${b.public_ref}` : ""} · ${b.package_name}`;
}

function sessionLine(b: Pick<PhotoBookingRow, "session_at" | "location">): string | null {
  if (!b.session_at && !b.location) return null;
  return [b.session_at ? `${formatDateTime(b.session_at)} ${zoneLabel()}` : null, b.location].filter(Boolean).join(" · ");
}

// ---------------------------------------------------------------------------
// Create / update
// ---------------------------------------------------------------------------

export async function createBooking(_prev: BookingFormState, formData: FormData): Promise<BookingFormState> {
  const { supabase, user } = await owner();
  if (!user) return { error: "You are signed out." };
  const { fieldErrors, values } = parseBookingForm(formData);
  if (Object.keys(fieldErrors).length) return { fieldErrors };

  // Who is this for: an existing CRM person, or a new contact (matched by e-mail / phone first).
  let person;
  if (values.client_id) {
    const { data } = await supabase.from("photo_people").select("*").eq("id", values.client_id).maybeSingle();
    if (!data) return { fieldErrors: { client_id: "That client was not found." } };
    person = data;
  } else {
    const found = await findOrCreatePerson(supabase, user.id, { fullName: values.customer_name!, email: values.customer_email, phone: values.customer_phone, instagram: values.instagram, source: "manual" });
    if (!found.ok) return { error: found.error };
    person = found.found.person;
  }

  if (values.organization_id) {
    const { data } = await supabase.from("photo_organizations").select("id").eq("id", values.organization_id).maybeSingle();
    if (!data) return { fieldErrors: { organization_id: "That team or club was not found." } };
  }
  let service = null;
  if (values.service_id) {
    const { data } = await supabase.from("photo_services").select("*").eq("id", values.service_id).maybeSingle();
    if (!data) return { fieldErrors: { service_id: "That service was not found." } };
    service = data;
  }
  if (values.event_id) {
    const ev = await requireOwnedEvent(supabase, values.event_id);
    if (!ev.ok) return { fieldErrors: { event_id: ev.error } };
  }

  const amountQr = values.amount_qr ?? service?.price_qr ?? 0;
  const bookingStatus = initialBookingStatus({ paymentMode: values.payment_mode, amountQr, requiresContract: values.requires_contract });
  const now = new Date();
  const lifecycle = bookingTransitionColumns({ quoted_at: null, confirmed_at: null, delivered_at: null, completed_at: null, cancelled_at: null }, bookingStatus, now);
  const sessionEnd = values.session_at && service?.duration_minutes ? new Date(new Date(values.session_at).getTime() + service.duration_minutes * 60_000).toISOString() : null;

  let booking: PhotoBookingRow | null = null;
  let lastError: string | null = null;
  for (let attempt = 0; attempt < PUBLIC_REF_ATTEMPTS && !booking; attempt += 1) {
    const { data, error } = await supabase
      .from("photo_bookings")
      .insert({
        owner_id: user.id,
        event_id: values.event_id,
        athlete_name: values.athlete_name ?? "",
        customer_name: person.full_name,
        customer_email: person.email ?? values.customer_email ?? "",
        customer_phone: person.phone ?? values.customer_phone ?? "",
        academy: values.details.academy ?? null,
        package_name: service?.name ?? BOOKING_TYPE_LABEL[values.booking_type],
        amount_qr: amountQr,
        currency: service?.currency ?? "QAR",
        status: "pending",
        provider: MYFATOORAH_PROVIDER,
        booking_type: values.booking_type,
        booking_status: bookingStatus,
        client_id: person.id,
        organization_id: values.organization_id,
        service_id: values.service_id,
        session_at: values.session_at,
        session_end_at: sessionEnd,
        location: values.location,
        payment_mode: values.payment_mode,
        notes: values.notes,
        details: values.details as Json,
        public_ref: makePublicRef(),
        ...lifecycle,
      })
      .select("*")
      .single();
    if (data) booking = data;
    else if (error?.code === PG_UNIQUE_VIOLATION && /public_ref/.test(error.message)) continue;
    else {
      lastError = error?.message ?? "Could not save the booking.";
      break;
    }
  }
  if (!booking) return { error: lastError ?? "Could not allocate a booking reference. Try again." };

  await writeAudit(supabase, { ownerId: user.id, actorId: user.id, entity: "booking", entityId: booking.id, action: "booking.created", data: { booking_type: booking.booking_type, booking_status: booking.booking_status, amount_qr: amountQr, source: "manual" } });
  await sendBookingEmail(supabase, booking, "BOOKING_RECEIVED");
  revalidateBooking(booking.id, person.id);
  redirect(`/bookings/${booking.id}`);
}

export async function updateBooking(id: string, _prev: BookingFormState, formData: FormData): Promise<BookingFormState> {
  if (!isUuid(id)) return { error: "Invalid booking." };
  const { supabase, user } = await owner();
  if (!user) return { error: "You are signed out." };
  const { fieldErrors, values } = parseBookingForm(formData);
  if (Object.keys(fieldErrors).length) return { fieldErrors };
  const booking = await ownedBooking(supabase, id);
  if (!booking) return { error: "Booking not found." };

  let clientId = booking.client_id;
  let customer: Pick<PhotoBookingRow, "customer_name" | "customer_email" | "customer_phone"> = booking;
  if (values.client_id && values.client_id !== booking.client_id) {
    const { data } = await supabase.from("photo_people").select("*").eq("id", values.client_id).maybeSingle();
    if (!data) return { fieldErrors: { client_id: "That client was not found." } };
    clientId = data.id;
    customer = { customer_name: data.full_name, customer_email: data.email ?? "", customer_phone: data.phone ?? "" };
  } else if (!values.client_id && values.customer_name) {
    const found = await findOrCreatePerson(supabase, user.id, { fullName: values.customer_name, email: values.customer_email, phone: values.customer_phone, instagram: values.instagram, source: "manual" });
    if (!found.ok) return { error: found.error };
    clientId = found.found.person.id;
    customer = { customer_name: found.found.person.full_name, customer_email: found.found.person.email ?? values.customer_email ?? "", customer_phone: found.found.person.phone ?? values.customer_phone ?? "" };
  }
  if (values.organization_id) {
    const { data } = await supabase.from("photo_organizations").select("id").eq("id", values.organization_id).maybeSingle();
    if (!data) return { fieldErrors: { organization_id: "That team or club was not found." } };
  }
  let service = null;
  if (values.service_id) {
    const { data } = await supabase.from("photo_services").select("*").eq("id", values.service_id).maybeSingle();
    if (!data) return { fieldErrors: { service_id: "That service was not found." } };
    service = data;
  }
  if (values.event_id) {
    const ev = await requireOwnedEvent(supabase, values.event_id);
    if (!ev.ok) return { fieldErrors: { event_id: ev.error } };
  }

  const amountQr = values.amount_qr ?? (service && values.service_id !== booking.service_id ? service.price_qr : null) ?? booking.amount_qr;
  const sessionEnd = values.session_at && service?.duration_minutes ? new Date(new Date(values.session_at).getTime() + service.duration_minutes * 60_000).toISOString() : values.session_at ? booking.session_end_at : null;
  const patch: Partial<PhotoBookingRow> = {
    booking_type: values.booking_type,
    event_id: values.event_id,
    athlete_name: values.athlete_name ?? "",
    academy: values.details.academy ?? null,
    package_name: service?.name ?? booking.package_name,
    amount_qr: amountQr,
    client_id: clientId,
    customer_name: customer.customer_name,
    customer_email: customer.customer_email,
    customer_phone: customer.customer_phone,
    organization_id: values.organization_id,
    service_id: values.service_id,
    session_at: values.session_at,
    session_end_at: sessionEnd,
    location: values.location,
    payment_mode: values.payment_mode,
    notes: values.notes,
    details: values.details as Json,
  };
  const { data: updated, error } = await supabase.from("photo_bookings").update(patch).eq("id", id).eq("owner_id", user.id).select("*").maybeSingle();
  if (error) return { error: error.message };
  if (!updated) return { error: "Booking not found." };

  const changed = (Object.keys(patch) as Array<keyof PhotoBookingRow>).filter((k) => JSON.stringify(booking[k] ?? null) !== JSON.stringify(updated[k] ?? null));
  await writeAudit(supabase, { ownerId: user.id, actorId: user.id, entity: "booking", entityId: id, action: "booking.updated", data: { changed } });
  const scheduleChanged = booking.session_at !== updated.session_at || (booking.location ?? null) !== (updated.location ?? null);
  if (scheduleChanged && updated.booking_status === "confirmed") {
    await sendBookingEmail(supabase, updated, "BOOKING_CHANGED", { previous: { session_at: booking.session_at, location: booking.location }, suffix: String(Date.now()) });
  }
  revalidateBooking(id, clientId);
  redirect(`/bookings/${id}`);
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export async function transitionBooking(id: string, to: string, reason?: string | null): Promise<BookingActionResult> {
  if (!isUuid(id)) return { ok: false, error: "Invalid booking." };
  if (!isBookingStatus(to)) return { ok: false, error: "Unknown booking status." };
  const { supabase, user } = await owner();
  if (!user) return { ok: false, error: "You are signed out." };
  const booking = await ownedBooking(supabase, id);
  if (!booking) return { ok: false, error: "Booking not found." };
  if (!canTransitionBooking(booking.booking_status, to)) return { ok: false, error: `A booking that is ${BOOKING_STATUS_LABEL[booking.booking_status].toLowerCase()} cannot move to ${BOOKING_STATUS_LABEL[to].toLowerCase()}.` };

  const now = new Date();
  const cols = bookingTransitionColumns(booking, to, now);
  const cancelReason = (reason ?? "").trim().slice(0, 500) || null;
  if (to === "cancelled") cols.cancel_reason = cancelReason;
  const { data: updated, error } = await supabase.from("photo_bookings").update(cols).eq("id", id).eq("owner_id", user.id).eq("booking_status", booking.booking_status).select("*").maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!updated) return { ok: false, error: "The booking changed in the meantime. Refresh and try again." };

  await writeAudit(supabase, { ownerId: user.id, actorId: user.id, entity: "booking", entityId: id, action: "booking.status", data: { from: booking.booking_status, to, reason: cancelReason } });
  const url = `${siteUrl()}/bookings/${id}`;
  if (to === "confirmed") await sendBookingEmail(supabase, updated, "BOOKING_CONFIRMED");
  if (to === "cancelled") {
    await sendBookingEmail(supabase, updated, "BOOKING_CANCELLED", { suffix: String(now.getTime()) });
    await enqueueOwnerTelegram(supabase, { ownerId: user.id, kind: "BOOKING_CANCELLED", alertKey: `booking:${id}:cancelled:${now.getTime()}`, title: `Booking cancelled — ${updated.customer_name}`, lines: [bookingLabel(updated), cancelReason ? `Reason: ${cancelReason}` : null], url, now });
  }
  if (to === "delivered") {
    await sendBookingEmail(supabase, updated, "DELIVERY_COMPLETE");
    await enqueueOwnerTelegram(supabase, { ownerId: user.id, kind: "DELIVERY_SENT", alertKey: `booking:${id}:delivered`, title: `Delivered — ${updated.customer_name}`, lines: [bookingLabel(updated), sessionLine(updated)], url, now });
  }
  revalidateBooking(id, updated.client_id);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// After the shoot: mark complete, record the final amount, request payment
// ---------------------------------------------------------------------------

function metadataOf(booking: Pick<PhotoBookingRow, "metadata">): Record<string, unknown> {
  return booking.metadata && typeof booking.metadata === "object" && !Array.isArray(booking.metadata) ? (booking.metadata as Record<string, unknown>) : {};
}

/**
 * The shoot happened. Stamps coverage_done_at once and moves a confirmed
 * booking to "in progress" through the normal transition rules. Payment is
 * not touched: it becomes requestable, nothing more.
 */
export async function markShootComplete(id: string): Promise<BookingActionResult> {
  if (!isUuid(id)) return { ok: false, error: "Invalid booking." };
  const { supabase, user } = await owner();
  if (!user) return { ok: false, error: "You are signed out." };
  const booking = await ownedBooking(supabase, id);
  if (!booking) return { ok: false, error: "Booking not found." };
  if (booking.booking_status === "cancelled") return { ok: false, error: "This booking is cancelled." };
  if (PRE_CONFIRMATION.includes(booking.booking_status)) return { ok: false, error: "Confirm the booking before marking the shoot complete." };
  if (booking.coverage_done_at) return { ok: true };

  const now = new Date();
  const cols: Partial<PhotoBookingRow> = { coverage_done_at: now.toISOString() };
  const moved = booking.booking_status === "confirmed" && canTransitionBooking(booking.booking_status, "in_progress");
  if (moved) Object.assign(cols, bookingTransitionColumns(booking, "in_progress", now));
  const { data: updated, error } = await supabase.from("photo_bookings").update(cols).eq("id", id).eq("owner_id", user.id).eq("booking_status", booking.booking_status).is("coverage_done_at", null).select("*").maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!updated) return { ok: false, error: "The booking changed in the meantime. Refresh and try again." };

  await writeAudit(supabase, { ownerId: user.id, actorId: user.id, entity: "booking", entityId: id, action: "booking.shoot_complete", data: { coverage_done_at: cols.coverage_done_at, from: booking.booking_status, to: updated.booking_status } });
  if (moved) await writeAudit(supabase, { ownerId: user.id, actorId: user.id, entity: "booking", entityId: id, action: "booking.status", data: { from: booking.booking_status, to: "in_progress", reason: "shoot complete" } });
  revalidateBooking(id, updated.client_id);
  return { ok: true };
}

/**
 * The amount the client pays after the shoot. Refused once MyFatoorah has
 * verified a payment (the money already moved); an unpaid provider invoice
 * from an earlier attempt stays linked, and the webhook's amount check plus
 * the next checkout attempt (which creates a fresh invoice) handle the rest.
 */
export async function recordFinalAmount(id: string, _prev: BookingFormState, formData: FormData): Promise<BookingFormState> {
  if (!isUuid(id)) return { error: "Invalid booking." };
  const { supabase, user } = await owner();
  if (!user) return { error: "You are signed out." };
  const { fieldErrors, values } = parseFinalAmount(formData);
  if (Object.keys(fieldErrors).length) return { fieldErrors };
  const booking = await ownedBooking(supabase, id);
  if (!booking) return { error: "Booking not found." };
  if (booking.booking_status === "cancelled") return { error: "This booking is cancelled." };
  if (booking.status === "paid" || booking.status === "disputed") return { error: "This booking is already paid through MyFatoorah; the amount cannot change." };
  if (booking.status === "refunded") return { error: "This booking was refunded through MyFatoorah; record a new booking instead." };

  const now = new Date().toISOString();
  const metadata = metadataOf(booking);
  const patch: Partial<PhotoBookingRow> = {
    amount_qr: values.amount_qr,
    currency: values.currency,
    metadata: { ...metadata, final_amount_recorded_at: now, final_amount_note: values.note, final_amount_previous: Number(booking.amount_qr) } as Json,
  };
  const { data: updated, error } = await supabase.from("photo_bookings").update(patch).eq("id", id).eq("owner_id", user.id).select("*").maybeSingle();
  if (error) return { error: error.message };
  if (!updated) return { error: "Booking not found." };

  await writeAudit(supabase, { ownerId: user.id, actorId: user.id, entity: "booking", entityId: id, action: "booking.final_amount", data: { amount_qr: values.amount_qr, previous_qr: Number(booking.amount_qr), currency: values.currency, note: values.note } });
  revalidateBooking(id, updated.client_id);
  return { saved: true };
}

export type PaymentRequestResult = { ok: true; payUrl: string; emailQueued: boolean } | { ok: false; error: string };

/**
 * Creates the website pay link for a booking (explicit owner action). Only
 * after the shoot is marked complete and a final amount exists. The link is
 * `/pay/<token>`: the token's hash and creation time go into the booking's
 * metadata, the link itself into payment_url (the client portal shows it);
 * an earlier provider URL moves to metadata.provider_payment_url. A new
 * link replaces the previous one. The lifecycle is NOT changed: payment and
 * booking status stay separate. The client is e-mailed ONLY when
 * `notifyClient` is ticked; the owner always gets a Telegram notice.
 */
export async function createPaymentRequest(id: string, opts: { notifyClient?: boolean } = {}): Promise<PaymentRequestResult> {
  const notifyClient = opts.notifyClient === true;
  if (!isUuid(id)) return { ok: false, error: "Invalid booking." };
  if (!isPaymentsEnabled()) return { ok: false, error: "Online payments (MyFatoorah) are not enabled yet. Record cash or bank payments by hand." };
  const { supabase, user } = await owner();
  if (!user) return { ok: false, error: "You are signed out." };
  const limit = rateLimit(`payment-request:${user.id}`, RULES.providerActionPerUser);
  if (!limit.ok) return { ok: false, error: `Too many payment links in a short time. Try again in ${limit.retryAfterSeconds}s.` };
  const booking = await ownedBooking(supabase, id);
  if (!booking) return { ok: false, error: "Booking not found." };
  const blocker = paymentRequestBlocker(booking);
  if (blocker) return { ok: false, error: PAYMENT_REQUEST_BLOCKER_LABEL[blocker] };

  const now = new Date();
  const { token, hash } = createPayToken();
  const payUrl = payPageUrl(siteUrl(), token);
  const metadata = metadataOf(booking);
  const providerUrl = booking.payment_url && !isWebsitePayUrl(booking.payment_url) ? booking.payment_url : (metadata.provider_payment_url as string | undefined) ?? null;
  const patch: Partial<PhotoBookingRow> = {
    payment_url: payUrl,
    payment_mode: "link_later",
    provider: booking.provider ?? MYFATOORAH_PROVIDER,
    metadata: { ...metadata, pay_token_hash: hash, pay_token_created_at: now.toISOString(), payment_requested_at: now.toISOString(), ...(providerUrl ? { provider_payment_url: providerUrl } : {}) } as Json,
  };
  const { data: updated, error } = await supabase.from("photo_bookings").update(patch).eq("id", id).eq("owner_id", user.id).select("*").maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!updated) return { ok: false, error: "Booking not found." };

  const payment = effectivePayment(updated);
  await writeAudit(supabase, { ownerId: user.id, actorId: user.id, entity: "booking", entityId: id, action: "booking.payment_requested", data: { amount_qr: Number(updated.amount_qr), due_qr: payment.dueQr, notify_client: notifyClient, token_hash_prefix: hash.slice(0, 8) } });
  await enqueueOwnerTelegram(supabase, {
    ownerId: user.id,
    kind: "BOOKING_PAYMENT_REQUESTED",
    alertKey: `booking:${id}:payment-requested:${hash.slice(0, 8)}`,
    title: `Payment link ready: ${updated.customer_name}`,
    lines: [bookingLabel(updated), `${formatQr(payment.dueQr)} due`, `Pay: ${payUrl}`, notifyClient ? "Sent to the client by e-mail." : "Not sent to the client. Share the link yourself, or tick \"Send to client by e-mail\" next time."],
    url: `${siteUrl()}/bookings/${id}`,
    now,
  });
  let emailQueued = false;
  if (notifyClient && updated.customer_email) {
    await sendBookingEmail(supabase, updated, "PAYMENT_REQUESTED", { suffix: hash.slice(0, 8) });
    emailQueued = true;
  }
  revalidateBooking(id, updated.client_id);
  return { ok: true, payUrl, emailQueued };
}

/** Sum of manual records → booking summary columns. Returns the refreshed row. */
async function refreshManualSummary(supabase: Client, booking: PhotoBookingRow, method: PhotoBookingRow["payment_method"]): Promise<PhotoBookingRow | null> {
  const { data: records } = await supabase.from("photo_payment_records").select("amount_qr,paid_at").eq("booking_id", booking.id).eq("kind", "manual");
  const rows = records ?? [];
  const total = Math.round(rows.reduce((sum, r) => sum + Number(r.amount_qr), 0) * 100) / 100;
  const latest = rows.map((r) => r.paid_at).sort().pop() ?? null;
  const { data } = await supabase
    .from("photo_bookings")
    .update({ amount_paid_qr: total, manual_paid_at: latest, payment_method: rows.length ? method : null })
    .eq("id", booking.id)
    .eq("owner_id", booking.owner_id)
    .select("*")
    .maybeSingle();
  return data ?? null;
}

/**
 * Records cash / bank transfer / Fawran received by hand. Never touches the
 * provider status: a booking MyFatoorah has verified as paid is refused.
 */
export async function recordManualPayment(id: string, _prev: BookingFormState, formData: FormData): Promise<BookingFormState> {
  if (!isUuid(id)) return { error: "Invalid booking." };
  const { supabase, user } = await owner();
  if (!user) return { error: "You are signed out." };
  const { fieldErrors, values } = parseManualPayment(formData);
  if (Object.keys(fieldErrors).length) return { fieldErrors };
  const booking = await ownedBooking(supabase, id);
  if (!booking) return { error: "Booking not found." };
  if (booking.status === "paid") return { error: "Already paid through MyFatoorah." };
  if (booking.status === "refunded") return { error: "This booking was refunded through MyFatoorah; record a new booking instead." };

  const { data: record, error } = await supabase
    .from("photo_payment_records")
    .insert({ owner_id: user.id, booking_id: id, kind: "manual", method: values.method, amount_qr: values.amount_qr, currency: booking.currency, paid_at: values.paid_at, note: values.note, recorded_by: user.id })
    .select("*")
    .single();
  if (error || !record) return { error: error?.message ?? "Could not save the payment." };

  const refreshed = (await refreshManualSummary(supabase, booking, values.method)) ?? booking;
  await writeAudit(supabase, { ownerId: user.id, actorId: user.id, entity: "booking", entityId: id, action: "payment.manual", data: { record_id: record.id, method: values.method, amount_qr: values.amount_qr, note: values.note, paid_at: values.paid_at } });

  const payment = effectivePayment(refreshed);
  let confirmed: PhotoBookingRow | null = null;
  if (payment.state === "paid" && PRE_CONFIRMATION.includes(refreshed.booking_status)) {
    const cols = bookingTransitionColumns(refreshed, "confirmed", new Date());
    const { data } = await supabase.from("photo_bookings").update(cols).eq("id", id).eq("owner_id", user.id).eq("booking_status", refreshed.booking_status).select("*").maybeSingle();
    if (data) {
      confirmed = data;
      await writeAudit(supabase, { ownerId: user.id, actorId: user.id, entity: "booking", entityId: id, action: "booking.status", data: { from: refreshed.booking_status, to: "confirmed", reason: "manual payment" } });
    }
  }
  const current = confirmed ?? refreshed;
  await enqueueOwnerTelegram(supabase, {
    ownerId: user.id,
    kind: "BOOKING_PAID",
    alertKey: `booking:${id}:manual:${record.id}`,
    title: `${payment.state === "paid" ? "Booking paid" : "Payment recorded"} — ${current.customer_name}`,
    lines: [bookingLabel(current), `${formatQr(values.amount_qr)} by ${PAYMENT_METHOD_LABEL[values.method]}${values.note ? ` · ${values.note}` : ""}`, payment.dueQr > 0 ? `Still due: ${formatQr(payment.dueQr)}` : null],
    url: `${siteUrl()}/bookings/${id}`,
  });
  await sendBookingEmail(supabase, current, "PAYMENT_RECEIVED", { payment: { amountQr: values.amount_qr, methodLabel: PAYMENT_METHOD_LABEL[values.method], dueQr: payment.dueQr }, suffix: record.id });
  if (confirmed) await sendBookingEmail(supabase, confirmed, "BOOKING_CONFIRMED");
  revalidateBooking(id, current.client_id);
  return { saved: true };
}

export async function deleteManualPayment(recordId: string): Promise<BookingActionResult> {
  if (!isUuid(recordId)) return { ok: false, error: "Invalid payment record." };
  const { supabase, user } = await owner();
  if (!user) return { ok: false, error: "You are signed out." };
  const { data: record } = await supabase.from("photo_payment_records").select("*").eq("id", recordId).maybeSingle();
  if (!record) return { ok: false, error: "Payment record not found." };
  if (record.kind !== "manual") return { ok: false, error: "Provider payments cannot be deleted; they are the provider's record." };
  const { error, count } = await supabase.from("photo_payment_records").delete({ count: "exact" }).eq("id", recordId).eq("owner_id", user.id).eq("kind", "manual");
  if (error) return { ok: false, error: error.message };
  if (!count) return { ok: false, error: "Payment record not found." };
  if (record.booking_id) {
    const booking = await ownedBooking(supabase, record.booking_id);
    if (booking) await refreshManualSummary(supabase, booking, booking.payment_method);
    await writeAudit(supabase, { ownerId: user.id, actorId: user.id, entity: "booking", entityId: record.booking_id, action: "payment.manual_deleted", data: { record_id: recordId, method: record.method, amount_qr: Number(record.amount_qr) } });
    revalidateBooking(record.booking_id, booking?.client_id);
  } else {
    revalidatePath("/payments");
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Coverage + tournament link
// ---------------------------------------------------------------------------

export async function assignBookingCoverage(id: string, input: { photographerId?: string | null; videographerId?: string | null }): Promise<BookingActionResult> {
  if (!isUuid(id)) return { ok: false, error: "Invalid booking." };
  const { supabase, user } = await owner();
  if (!user) return { ok: false, error: "You are signed out." };
  const patch: Partial<PhotoBookingRow> = {};
  if (input.photographerId !== undefined) {
    if (input.photographerId !== null && !isUuid(input.photographerId)) return { ok: false, error: "Invalid assignee." };
    patch.assigned_photographer_id = input.photographerId;
  }
  if (input.videographerId !== undefined) {
    if (input.videographerId !== null && !isUuid(input.videographerId)) return { ok: false, error: "Invalid assignee." };
    patch.assigned_videographer_id = input.videographerId;
  }
  if (!Object.keys(patch).length) return { ok: true };
  const { data, error } = await supabase.from("photo_bookings").update(patch).eq("id", id).eq("owner_id", user.id).select("id,client_id").maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Booking not found." };
  await writeAudit(supabase, { ownerId: user.id, actorId: user.id, entity: "booking", entityId: id, action: "booking.coverage_assigned", data: { photographer_id: patch.assigned_photographer_id ?? null, videographer_id: patch.assigned_videographer_id ?? null } });
  revalidateBooking(id, data.client_id);
  return { ok: true };
}

/** Explicit owner action: point the booking at a tracked athlete in the same event. Never creates one. */
export async function linkBookingToAthlete(bookingId: string, athleteId: string): Promise<BookingActionResult> {
  if (!isUuid(bookingId)) return { ok: false, error: "Invalid booking." };
  if (!isUuid(athleteId)) return { ok: false, error: "Invalid athlete." };
  const { supabase, user } = await owner();
  if (!user) return { ok: false, error: "You are signed out." };
  const booking = await ownedBooking(supabase, bookingId);
  if (!booking) return { ok: false, error: "Booking not found." };
  const athlete = await requireOwnedAthlete(supabase, athleteId);
  if (!athlete.ok) return { ok: false, error: athlete.error };
  if (booking.event_id && athlete.eventId !== booking.event_id) return { ok: false, error: "That athlete is tracked in a different event than this booking." };
  const { error } = await supabase.from("photo_bookings").update({ watcher_athlete_id: athleteId }).eq("id", bookingId).eq("owner_id", user.id);
  if (error) return { ok: false, error: error.message };
  await writeAudit(supabase, { ownerId: user.id, actorId: user.id, entity: "booking", entityId: bookingId, action: "booking.athlete_linked", data: { athlete_id: athleteId } });
  revalidateBooking(bookingId, booking.client_id);
  revalidatePath(`/clients/${athleteId}`);
  return { ok: true };
}

export async function unlinkBookingAthlete(bookingId: string): Promise<BookingActionResult> {
  if (!isUuid(bookingId)) return { ok: false, error: "Invalid booking." };
  const { supabase, user } = await owner();
  if (!user) return { ok: false, error: "You are signed out." };
  const booking = await ownedBooking(supabase, bookingId);
  if (!booking) return { ok: false, error: "Booking not found." };
  const { error } = await supabase.from("photo_bookings").update({ watcher_athlete_id: null }).eq("id", bookingId).eq("owner_id", user.id);
  if (error) return { ok: false, error: error.message };
  await writeAudit(supabase, { ownerId: user.id, actorId: user.id, entity: "booking", entityId: bookingId, action: "booking.athlete_unlinked", data: { athlete_id: booking.watcher_athlete_id } });
  revalidateBooking(bookingId, booking.client_id);
  return { ok: true };
}

/**
 * EXPLICIT owner action from the booking page: creates a tracked athlete
 * (photo_athletes) from the prefilled form and links the booking to it.
 * Same validation as the Athletes module (parseClientForm). This is the only
 * path from a booking to a tracked athlete; webhooks and payments never take it.
 */
export async function createAthleteFromBooking(bookingId: string, _prev: BookingFormState, formData: FormData): Promise<BookingFormState> {
  if (!isUuid(bookingId)) return { error: "Invalid booking." };
  const { supabase, user } = await owner();
  if (!user) return { error: "You are signed out." };
  const booking = await ownedBooking(supabase, bookingId);
  if (!booking) return { error: "Booking not found." };
  const { fieldErrors, values } = parseClientForm(formData, { requireSourceUrl: false });
  if (Object.keys(fieldErrors).length) return { fieldErrors };
  if (booking.event_id && values.event_id !== booking.event_id) return { fieldErrors: { event_id: "The athlete must be tracked in this booking's event." } };
  const event = await requireOwnedEvent(supabase, values.event_id!);
  if (!event.ok) return { fieldErrors: { event_id: event.error } };

  const { data: athlete, error } = await supabase.from("photo_athletes").insert({ ...values, owner_id: user.id }).select("id").single();
  if (error || !athlete) return { error: error?.message ?? "Could not create the athlete." };
  const { error: linkError } = await supabase.from("photo_bookings").update({ watcher_athlete_id: athlete.id, event_id: booking.event_id ?? values.event_id }).eq("id", bookingId).eq("owner_id", user.id);
  if (linkError) return { error: `The athlete was created but could not be linked: ${linkError.message}` };
  await writeAudit(supabase, { ownerId: user.id, actorId: user.id, entity: "booking", entityId: bookingId, action: "booking.athlete_created", data: { athlete_id: athlete.id, event_id: values.event_id } });
  revalidateBooking(bookingId, booking.client_id);
  revalidatePath("/clients");
  revalidatePath(`/events/${values.event_id}`);
  redirect(`/bookings/${bookingId}`);
}
