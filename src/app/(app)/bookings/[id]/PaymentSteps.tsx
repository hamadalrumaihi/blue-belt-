import Link from "next/link";
import type { ReactNode } from "react";
import { CheckIcon, FileTextIcon, ImageIcon } from "@/components/icons";
import type { BookingDetail } from "@/lib/bookings/queries";
import { formatQr, isShootComplete, PAYMENT_METHOD_LABEL, PAYMENT_REQUEST_BLOCKER_LABEL, paymentRequestBlocker } from "@/lib/bookings/state";
import { DOCUMENT_STATUS_LABEL } from "@/lib/documents/state";
import { GALLERY_STATUS_LABEL } from "@/lib/galleries/state";
import { isWebsitePayUrl } from "@/lib/payments/pay-token";
import type { BookingStatus } from "@/lib/supabase/database.types";
import { formatStamp } from "@/lib/time";
import { cn } from "@/lib/utils";
import { FinalAmountForm } from "../FinalAmountForm";
import { ManualPaymentForm } from "../ManualPaymentForm";
import { PaymentBadge } from "../PaymentBadge";
import { PaymentRequestPanel } from "../PaymentRequestPanel";
import { ShootCompleteButton } from "../ShootCompleteButton";
import { DeletePaymentButton } from "./DeletePaymentButton";

type StepState = "done" | "current" | "todo" | "skipped";

type Step = { key: string; title: string; state: StepState; meta?: string | null; body: ReactNode };

const PRE_CONFIRMATION: readonly BookingStatus[] = ["inquiry", "quoted", "awaiting_contract", "awaiting_payment"];

function metadataOf(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/**
 * The booking's money flow as one ordered list with the current step
 * highlighted: confirm, agreement, shoot done, final amount, payment link,
 * payment status, gallery. Booking status and payment status stay separate;
 * nothing here moves the lifecycle except "Mark shoot complete".
 */
export function PaymentSteps({ detail, paymentsEnabled }: { detail: BookingDetail; paymentsEnabled: boolean }) {
  const { booking, documents, gallery, paymentRecords, payment } = detail;
  const id = booking.id;
  const meta = metadataOf(booking.metadata);
  const cancelled = booking.booking_status === "cancelled";
  const confirmed = !PRE_CONFIRMATION.includes(booking.booking_status) && !cancelled;
  const shootDone = isShootComplete(booking);
  const finalRecorded = typeof meta.final_amount_recorded_at === "string";
  const finalNote = typeof meta.final_amount_note === "string" ? meta.final_amount_note : null;
  const requestedAt = typeof meta.payment_requested_at === "string" ? meta.payment_requested_at : null;
  const payUrl = isWebsitePayUrl(booking.payment_url) ? booking.payment_url : null;
  const requested = Boolean(payUrl && requestedAt);
  const blocker = paymentRequestBlocker(booking);
  const providerPaid = booking.status === "paid";
  const paid = payment.state === "paid";
  const signed = documents.find((d) => d.status === "signed") ?? null;
  const contractPending = booking.booking_status === "awaiting_contract" || documents.some((d) => d.status === "sent" || d.status === "viewed");
  const mismatch = metadataOf(meta.payment_mismatch);
  const galleryOpen = gallery && (gallery.status === "ready" || gallery.status === "delivered");
  const priced = Number(booking.amount_qr) > 0;

  const steps: Step[] = [
    {
      key: "confirm",
      title: "Confirm booking",
      state: confirmed ? "done" : cancelled ? "skipped" : "current",
      meta: booking.confirmed_at ? `Confirmed ${formatStamp(booking.confirmed_at)}` : cancelled ? "Cancelled" : null,
      body: confirmed ? null : cancelled ? <p className="text-sm text-muted">This booking is cancelled. Reopen it under Next step if it is back on.</p> : <p className="text-sm text-muted">Review the request and use <a href="#actions-h" className="font-semibold text-primary hover:underline">Next step</a> to confirm it. No payment is needed to book.</p>,
    },
    {
      key: "agreement",
      title: "Agreement",
      state: signed ? "done" : contractPending ? "current" : "skipped",
      meta: signed ? `Signed ${signed.signed_at ? formatStamp(signed.signed_at) : ""}` : contractPending ? "Waiting for signature" : "Optional",
      body: (
        <div>
          {documents.length > 0 && (
            <ul className="space-y-1.5 text-sm">
              {documents.map((doc) => (
                <li key={doc.id}>
                  <Link href={`/documents/${doc.id}`} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-page">
                    <span className="truncate font-semibold text-ink">{doc.title}</span>
                    <span className="shrink-0 text-xs text-muted">{DOCUMENT_STATUS_LABEL[doc.status]}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {!cancelled && <Link href={`/documents/new?booking=${id}`} className="btn-secondary mt-2 min-h-11"><FileTextIcon size={16} /> {documents.length ? "New agreement" : "Send an agreement"}</Link>}
          {!documents.length && <p className="mt-2 text-xs text-muted">Only when this booking needs a signed agreement.</p>}
        </div>
      ),
    },
    {
      key: "shoot",
      title: "Mark shoot complete",
      state: shootDone ? "done" : cancelled ? "skipped" : confirmed ? "current" : "todo",
      meta: booking.coverage_done_at ? `Shoot done ${formatStamp(booking.coverage_done_at)}` : null,
      body: shootDone ? null : <ShootCompleteButton bookingId={id} label={`${booking.customer_name}${booking.athlete_name && booking.athlete_name !== booking.customer_name ? ` (${booking.athlete_name})` : ""}`} disabledReason={cancelled ? "Cancelled bookings cannot be marked complete." : !confirmed ? "Confirm the booking first." : null} />,
    },
    {
      key: "amount",
      title: "Final amount",
      state: providerPaid || (finalRecorded && priced) ? "done" : shootDone && !cancelled ? "current" : "todo",
      meta: finalRecorded && typeof meta.final_amount_recorded_at === "string" ? `${formatQr(booking.amount_qr)} recorded ${formatStamp(meta.final_amount_recorded_at)}` : priced ? `${formatQr(booking.amount_qr)} from the booking` : "No amount yet",
      body: cancelled ? null : (
        <div>
          <p className="text-2xl font-black text-ink">{formatQr(booking.amount_qr)}</p>
          {finalNote && <p className="mb-2 text-xs text-muted">{finalNote}</p>}
          <div className="mt-2">
            <FinalAmountForm bookingId={id} amountQr={Number(booking.amount_qr) || 0} currency={booking.currency} note={finalNote} locked={providerPaid || booking.status === "refunded" || booking.status === "disputed"} />
          </div>
          {!shootDone && <p className="mt-2 text-xs text-muted">You can adjust it now; the client is asked to pay only after the shoot is marked complete.</p>}
        </div>
      ),
    },
    {
      key: "request",
      title: "Payment link",
      state: paid ? (requested ? "done" : "skipped") : requested ? "done" : blocker === null ? "current" : "todo",
      meta: requestedAt ? `Link created ${formatStamp(requestedAt)}` : paid ? "Not needed" : null,
      body: <PaymentRequestPanel bookingId={id} paymentsEnabled={paymentsEnabled} payUrl={payUrl} canRequest={blocker === null} blockerLabel={blocker ? PAYMENT_REQUEST_BLOCKER_LABEL[blocker] : null} providerInvoiceId={booking.provider_invoice_id} hasEmail={Boolean(booking.customer_email)} />,
    },
    {
      key: "status",
      title: "Payment status",
      state: paid ? "done" : payment.state === "refunded" ? "skipped" : requested || payment.state === "partial" ? "current" : "todo",
      meta: providerPaid ? `Verified by MyFatoorah${booking.paid_at ? ` on ${formatStamp(booking.paid_at)}` : ""}` : paid ? `Recorded by you${booking.manual_paid_at ? ` on ${formatStamp(booking.manual_paid_at)}` : ""}` : payment.state === "partial" ? `${formatQr(payment.paidQr)} received, ${formatQr(payment.dueQr)} due` : payment.state === "refunded" ? "Refunded" : priced ? `${formatQr(payment.dueQr)} due` : "No charge",
      body: (
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <PaymentBadge payment={payment} amountQr={booking.amount_qr} detailed />
            {booking.provider_invoice_id && <span className="text-xs text-muted">MyFatoorah invoice {booking.provider_invoice_id} · provider status {booking.status}</span>}
          </div>
          {providerPaid && <p className="mt-2 rounded-lg bg-success-soft px-3 py-2 text-xs font-semibold text-success">Paid online. Verified by MyFatoorah{booking.paid_at ? ` on ${formatStamp(booking.paid_at)}` : ""}.</p>}
          {booking.status === "refunded" && <p className="mt-2 rounded-lg bg-page px-3 py-2 text-xs font-semibold text-muted">Refunded through MyFatoorah{booking.refunded_at ? ` on ${formatStamp(booking.refunded_at)}` : ""}.</p>}
          {Object.keys(mismatch).length > 0 && !providerPaid && (
            <p className="mt-2 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-xs font-semibold text-danger" role="alert">
              MyFatoorah reported a payment of {String(mismatch.amount)} {String(mismatch.currency ?? "")} for invoice {String(mismatch.invoice_id)}, but this booking expects {formatQr(Number(mismatch.expected))}. It was not marked paid. Check the MyFatoorah portal and record it by hand if it is genuine.
            </p>
          )}
          {paymentRecords.length > 0 && (
            <ul className="mt-3 divide-y divide-line rounded-xl border border-line text-sm">
              {paymentRecords.map((r) => (
                <li key={r.id} className="flex items-center gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-ink">{formatQr(r.amount_qr)} <span className="font-normal text-muted">· {PAYMENT_METHOD_LABEL[r.method]} · {r.kind === "provider" ? "verified by MyFatoorah" : "recorded by you"}</span></p>
                    <p className="truncate text-xs text-muted">{formatStamp(r.paid_at)}{r.note ? ` · ${r.note}` : ""}</p>
                  </div>
                  {r.kind === "manual" && <DeletePaymentButton recordId={r.id} summary={`${formatQr(r.amount_qr)} · ${PAYMENT_METHOD_LABEL[r.method]}`} />}
                </li>
              ))}
            </ul>
          )}
          {!cancelled && (
            <div className="mt-3">
              <p className="mb-2 text-xs text-muted">Cash, bank transfer or Fawran received outside the website:</p>
              <ManualPaymentForm bookingId={id} providerPaid={providerPaid} dueQr={payment.dueQr} currency={booking.currency} />
            </div>
          )}
        </div>
      ),
    },
    {
      key: "gallery",
      title: "Gallery",
      state: galleryOpen ? "done" : gallery ? "current" : paid ? "current" : "todo",
      meta: gallery ? `${GALLERY_STATUS_LABEL[gallery.status]}${gallery.delivered_at ? ` · ${formatStamp(gallery.delivered_at)}` : gallery.ready_at ? ` · ready ${formatStamp(gallery.ready_at)}` : ""}` : "No gallery linked yet",
      body: gallery ? (
        <Link href={`/galleries/${gallery.id}`} className="block rounded-lg px-2 py-1.5 hover:bg-page">
          <p className="truncate font-semibold text-ink">{gallery.name}</p>
          <p className="text-xs text-muted">Open gallery</p>
        </Link>
      ) : (
        <Link href={`/galleries/new?booking=${id}`} className="btn-secondary min-h-11"><ImageIcon size={16} /> Add gallery</Link>
      ),
    },
  ];

  // Exactly one highlighted step: the first one that is "current".
  let highlighted = false;
  return (
    <ol className="space-y-2">
      {steps.map((s, i) => {
        const isCurrent = s.state === "current" && !highlighted;
        if (isCurrent) highlighted = true;
        const done = s.state === "done";
        return (
          <li key={s.key} className={cn("rounded-xl border p-3 sm:p-4", isCurrent ? "border-primary bg-lightblue/30" : "border-line", s.state === "skipped" && "opacity-70")} aria-current={isCurrent ? "step" : undefined}>
            <div className="flex items-start gap-3">
              <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold", done ? "bg-success text-white" : isCurrent ? "bg-primary text-white" : "bg-page text-muted border border-line")} aria-hidden>
                {done ? <CheckIcon size={16} /> : i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                  <h3 className={cn("text-sm font-extrabold", done ? "text-ink" : isCurrent ? "text-primary" : "text-ink")}>{s.title}</h3>
                  {s.meta && <p className="text-xs text-muted">{s.meta}</p>}
                </div>
                {s.body && <div className="mt-2">{s.body}</div>}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
