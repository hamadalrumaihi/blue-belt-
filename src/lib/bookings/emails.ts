/**
 * Client e-mails about one booking. Pure: builds drafts from a booking row
 * and a few facts, so the server actions, the payment webhook and tests all
 * produce the same wording. Nothing here sends anything.
 *
 * Customer copy rules: no vendor names, no em dashes, short direct sentences.
 * The payment story is "secure online payment": a 50% deposit online once
 * the agreement is signed, the remaining 50% after delivery.
 */
import { BOOKING_STATUS_CLIENT_LABEL, BOOKING_TYPE_LABEL, effectivePayment, formatMoney, formatQr, stageWords } from "@/lib/bookings/state";
import type { ClientNotificationKind } from "@/lib/notifications/email/kinds";
import { buildEmail, type EmailContent, type EmailDraft } from "@/lib/notifications/email/templates";
import { isWebsitePayUrl } from "@/lib/payments/pay-token";
import type { PaymentStage, PhotoBookingRow } from "@/lib/supabase/database.types";
import { formatDateTime, zoneLabel } from "@/lib/time";

export type BookingEmailBooking = Pick<
  PhotoBookingRow,
  | "id"
  | "public_ref"
  | "booking_type"
  | "booking_status"
  | "customer_name"
  | "customer_email"
  | "amount_qr"
  | "currency"
  | "session_at"
  | "location"
  | "package_name"
  | "athlete_name"
  | "payment_url"
  | "cancel_reason"
  | "status"
  | "amount_paid_qr"
  | "manual_paid_at"
  | "deposit_percent"
  | "deposit_qr"
  | "balance_qr"
  | "deposit_state"
  | "balance_state"
>;

/** House wording for the payment story in every booking mail that mentions money. */
export const SECURE_PAYMENT_STORY = "Once we confirm availability and price, you sign the agreement and secure the booking with a 50% deposit paid online. The remaining 50% is due after delivery.";

export type BookingEmailOptions = {
  businessName: string;
  /** Absolute link to the client's booking page in the portal. */
  portalUrl: string;
  /** PAYMENT_RECEIVED: what arrived and how. */
  payment?: { amountQr: number; methodLabel: string; dueQr: number; stage?: PaymentStage | null } | null;
  /** PAYMENT_REQUESTED: the stage request being sent (our pay page or a pasted provider link). */
  request?: { stage: PaymentStage; amountQr: number; currency: string; payUrl: string } | null;
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
  const payment = effectivePayment(b);
  const priced = Number(b.amount_qr) > 0;
  const balanceLeft = Number(b.balance_qr) > 0 && b.balance_state !== "paid" && b.balance_state !== "waived";
  switch (kind) {
    case "BOOKING_RECEIVED":
      return {
        ...base,
        subject: `We received your booking request${ref}`,
        paragraphs: [`Thank you. Your request for ${b.package_name || BOOKING_TYPE_LABEL[b.booking_type].toLowerCase()} is with us.`, `We will confirm availability and price shortly. Current status: ${BOOKING_STATUS_CLIENT_LABEL[b.booking_status]}.`, SECURE_PAYMENT_STORY],
        cta: portal,
      };
    case "BOOKING_CONFIRMED":
      return {
        ...base,
        subject: `Your booking is confirmed${ref}`,
        paragraphs: [
          "Your booking is confirmed. The details are below; reply to this e-mail if anything needs to change.",
          !priced ? "There is nothing to pay for this booking." : balanceLeft ? `Your deposit is paid. The remaining balance of ${formatMoney(b.balance_qr, b.currency)} is due after delivery. We will send you a payment link then.` : payment.state === "paid" ? "Your booking is fully paid. Thank you." : "Your deposit has been received.",
          "See you there.",
        ],
        cta: portal,
      };
    case "PAYMENT_REQUESTED": {
      const r = o.request;
      if (r) {
        return {
          ...base,
          subject: `Complete your online payment${ref}`,
          paragraphs: [
            `The ${stageWords(b, r.stage)} for your booking is ${formatMoney(r.amountQr, r.currency)}.`,
            "Open your payment link below to pay online. The page shows the amount and your booking reference before you pay.",
            r.stage === "deposit" ? "Your booking is confirmed as soon as the payment is confirmed." : "Your booking is marked paid in full as soon as the payment is confirmed.",
            "If anything looks wrong, reply to this e-mail before paying.",
          ],
          cta: { label: "Open your payment link", url: r.payUrl },
        };
      }
      const due = payment.state === "partial" ? payment.dueQr : Number(b.amount_qr);
      const website = isWebsitePayUrl(b.payment_url);
      return {
        ...base,
        subject: `Complete your online payment${ref}`,
        paragraphs: [`The amount due for your booking is ${formatMoney(due, b.currency)}.`, "Open your payment link below to pay online. The page shows the amount and your booking reference before you pay.", "Your booking is updated as soon as the payment is confirmed. If anything looks wrong, reply to this e-mail before paying."],
        cta: website && b.payment_url ? { label: "Open your payment link", url: b.payment_url } : portal,
      };
    }
    case "PAYMENT_RECEIVED": {
      const p = o.payment;
      const what = p?.stage ? ` for the ${stageWords(b, p.stage)}` : "";
      const line = p ? `We received ${formatMoney(p.amountQr, b.currency)}${what}${p.methodLabel ? ` by ${p.methodLabel.toLowerCase()}` : ""}.` : "We received your payment.";
      const balance = p && p.dueQr > 0 ? `Remaining balance: ${formatMoney(p.dueQr, b.currency)}, due after delivery.` : "Your booking is fully paid. Thank you.";
      return { ...base, subject: `Your payment was received${ref}`, paragraphs: [line, balance], cta: portal };
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
        paragraphs: [
          "Everything from your session has been delivered. Open your booking to find your private gallery link.",
          ...(b.balance_state === "due" && Number(b.balance_qr) > 0 ? [`The remaining balance of ${formatMoney(b.balance_qr, b.currency)} is now due. You will receive a payment link for it.`] : []),
          "Thank you for shooting with us. Tag us when you share them.",
        ],
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
