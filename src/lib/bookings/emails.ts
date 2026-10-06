/**
 * Client e-mails about one booking. Pure: builds drafts from a booking row
 * and a few facts, so the server actions, the MyFatoorah webhook and tests
 * all produce the same wording. Nothing here sends anything.
 */
import { BOOKING_STATUS_CLIENT_LABEL, BOOKING_TYPE_LABEL, formatQr } from "@/lib/bookings/state";
import type { ClientNotificationKind } from "@/lib/notifications/email/kinds";
import { buildEmail, type EmailContent, type EmailDraft } from "@/lib/notifications/email/templates";
import type { PhotoBookingRow } from "@/lib/supabase/database.types";
import { formatDateTime, zoneLabel } from "@/lib/time";

export type BookingEmailBooking = Pick<PhotoBookingRow, "id" | "public_ref" | "booking_type" | "booking_status" | "customer_name" | "customer_email" | "amount_qr" | "session_at" | "location" | "package_name" | "athlete_name" | "payment_url" | "cancel_reason">;

export type BookingEmailOptions = {
  businessName: string;
  /** Absolute link to the client's booking page in the portal. */
  portalUrl: string;
  /** PAYMENT_RECEIVED: what arrived and how. */
  payment?: { amountQr: number; methodLabel: string; dueQr: number } | null;
  /** BOOKING_CHANGED: what the previous schedule was. */
  previous?: { session_at: string | null; location: string | null } | null;
  now?: Date;
};

export const BOOKING_EMAIL_KINDS = ["BOOKING_RECEIVED", "BOOKING_CONFIRMED", "PAYMENT_REQUESTED", "PAYMENT_RECEIVED", "BOOKING_CHANGED", "BOOKING_CANCELLED", "DELIVERY_COMPLETE"] as const satisfies readonly ClientNotificationKind[];
export type BookingEmailKind = (typeof BOOKING_EMAIL_KINDS)[number];

function firstName(fullName: string): string {
  const first = fullName.trim().split(/\s+/)[0];
  return first || "there";
}

function when(b: BookingEmailBooking): string {
  return b.session_at ? `${formatDateTime(b.session_at)} ${zoneLabel()}` : "To be confirmed";
}

/** Facts every booking mail shows: reference, what, when, where, amount. */
export function bookingFacts(b: BookingEmailBooking): Array<[string, string]> {
  const facts: Array<[string, string]> = [];
  if (b.public_ref) facts.push(["Reference", b.public_ref]);
  facts.push(["Service", b.package_name || BOOKING_TYPE_LABEL[b.booking_type]]);
  if (b.athlete_name) facts.push(["Athlete", b.athlete_name]);
  facts.push(["When", when(b)]);
  if (b.location) facts.push(["Where", b.location]);
  if (Number(b.amount_qr) > 0) facts.push(["Amount", formatQr(b.amount_qr)]);
  return facts;
}

/** Subject + body for one booking e-mail kind. Null when the booking has no e-mail address. */
export function bookingEmailContent(kind: BookingEmailKind, b: BookingEmailBooking, o: BookingEmailOptions): EmailContent {
  const greeting = `Hi ${firstName(b.customer_name)},`;
  const ref = b.public_ref ? ` (${b.public_ref})` : "";
  const portal = { label: "View your booking", url: o.portalUrl };
  const base = { kind, greeting, businessName: o.businessName, facts: bookingFacts(b) };
  switch (kind) {
    case "BOOKING_RECEIVED":
      return {
        ...base,
        subject: `We received your booking request${ref}`,
        paragraphs: [`Thank you — your request for ${b.package_name || BOOKING_TYPE_LABEL[b.booking_type].toLowerCase()} is with us.`, `We will confirm the details shortly. Current status: ${BOOKING_STATUS_CLIENT_LABEL[b.booking_status]}.`],
        cta: portal,
      };
    case "BOOKING_CONFIRMED":
      return {
        ...base,
        subject: `Your booking is confirmed${ref}`,
        paragraphs: ["Your booking is confirmed. The details are below; reply to this e-mail if anything needs to change.", "See you there."],
        cta: portal,
      };
    case "PAYMENT_REQUESTED":
      return {
        ...base,
        subject: `Payment link for your booking${ref}`,
        paragraphs: [`To confirm your booking, please pay ${formatQr(b.amount_qr)} using the secure link below.`, "The link opens MyFatoorah, where you can pay by card. Your booking is confirmed as soon as the payment goes through."],
        cta: b.payment_url ? { label: "Pay securely", url: b.payment_url } : portal,
      };
    case "PAYMENT_RECEIVED": {
      const p = o.payment;
      const line = p ? `We received ${formatQr(p.amountQr)} by ${p.methodLabel.toLowerCase()}.` : "We received your payment.";
      const balance = p && p.dueQr > 0 ? `Remaining balance: ${formatQr(p.dueQr)}.` : "Your booking is fully paid — thank you.";
      return { ...base, subject: `Payment received${ref}`, paragraphs: [line, balance], cta: portal };
    }
    case "BOOKING_CHANGED": {
      const prev = o.previous;
      const was = prev ? [prev.session_at ? `${formatDateTime(prev.session_at)} ${zoneLabel()}` : null, prev.location].filter(Boolean).join(" · ") : "";
      return {
        ...base,
        subject: `Your booking has changed${ref}`,
        paragraphs: [`The date, time or place of your booking has been updated.${was ? ` It was: ${was}.` : ""}`, "The new details are below. Reply to this e-mail if they do not work for you."],
        cta: portal,
      };
    }
    case "BOOKING_CANCELLED":
      return {
        ...base,
        subject: `Your booking was cancelled${ref}`,
        paragraphs: [`Your booking has been cancelled.${b.cancel_reason ? ` Reason: ${b.cancel_reason}` : ""}`, "If this is unexpected, reply to this e-mail and we will sort it out."],
        cta: null,
      };
    case "DELIVERY_COMPLETE":
      return {
        ...base,
        subject: `Your photos and videos are delivered${ref}`,
        paragraphs: ["Everything from your session has been delivered. Open your booking to find the gallery link.", "Thank you for shooting with us — tag us when you share them."],
        cta: portal,
      };
  }
}

export function bookingEmailDraft(kind: BookingEmailKind, b: BookingEmailBooking, o: BookingEmailOptions): EmailDraft | null {
  if (!b.customer_email) return null;
  return buildEmail(b.customer_email, bookingEmailContent(kind, b, o));
}

/** Dedupe key: one mail per booking per kind, except kinds that legitimately repeat (payments, changes). */
export function bookingEmailAlertKey(kind: BookingEmailKind, bookingId: string, suffix?: string | null): string {
  const tail: Record<BookingEmailKind, string> = {
    BOOKING_RECEIVED: "received",
    BOOKING_CONFIRMED: "confirmed",
    PAYMENT_REQUESTED: "payment-requested",
    PAYMENT_RECEIVED: "paid",
    BOOKING_CHANGED: "changed",
    BOOKING_CANCELLED: "cancelled",
    DELIVERY_COMPLETE: "delivered",
  };
  return `email:booking:${bookingId}:${tail[kind]}${suffix ? `:${suffix}` : ""}`;
}
