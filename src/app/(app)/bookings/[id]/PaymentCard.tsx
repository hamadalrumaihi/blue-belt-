import { CheckIcon } from "@/components/icons";
import type { BookingDetail } from "@/lib/bookings/queries";
import { formatQr, manualPaymentStages, PAYMENT_METHOD_LABEL, stageLabel } from "@/lib/bookings/state";
import { latestRequestFor, STAGE_REQUEST_BLOCKER_LABEL, stageRequestBlocker } from "@/lib/payments/requests";
import type { PaymentStage, PhotoBookingPaymentRequestRow } from "@/lib/supabase/database.types";
import { formatStamp } from "@/lib/time";
import { cn } from "@/lib/utils";
import { FinalAmountForm } from "../FinalAmountForm";
import { ManualPaymentForm } from "../ManualPaymentForm";
import { DeletePaymentButton } from "./DeletePaymentButton";
import { StageRequestPanel, type StageRequestView } from "./StageRequestPanel";

function metadataOf(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function requestView(r: PhotoBookingPaymentRequestRow | null, providerStatus: string | null): StageRequestView | null {
  if (!r) return null;
  const meta = metadataOf(r.metadata);
  const mismatch = metadataOf(meta.payment_mismatch);
  return {
    id: r.id,
    status: r.status,
    provider: r.provider,
    payUrl: r.payment_url,
    createdAt: r.created_at,
    sentAt: r.sent_at,
    paidAt: r.paid_at ? formatStamp(r.paid_at) : null,
    generation: r.generation,
    providerInvoiceId: r.provider_invoice_id,
    providerStatus: r.provider_invoice_id ? providerStatus : null,
    providerError: r.error_message ?? (Object.keys(mismatch).length ? `mismatch: ${String(mismatch.reason ?? "")}` : null) ?? (r.error_code ? r.error_code : null),
  };
}

/**
 * The owner's money card: total, deposit 50% and remaining 50% with their
 * states, one request block per stage (create / copy / send / regenerate),
 * provider details (owner only), payment records and the manual payment
 * sheet. Amounts are the booking row's; nothing here is typed by the owner
 * except the total.
 */
export function PaymentCard({ detail, paymentsEnabled }: { detail: BookingDetail; paymentsEnabled: boolean }) {
  const { booking, paymentRecords, paymentRequests, payment } = detail;
  const id = booking.id;
  const meta = metadataOf(booking.metadata);
  const finalNote = typeof meta.final_amount_note === "string" ? meta.final_amount_note : null;
  const cancelled = booking.booking_status === "cancelled";
  const priced = Number(booking.amount_qr) > 0;
  const fullyPaid = payment.state === "paid";
  const mismatch = metadataOf(meta.payment_mismatch);
  const providerStatus = booking.provider_invoice_id ? booking.status : null;
  const stages = manualPaymentStages(booking, paymentRequests);

  const stageBlock = (stage: PaymentStage) => {
    const latest = latestRequestFor(paymentRequests, stage);
    const blocker = stageRequestBlocker(booking, stage);
    const amount = stage === "deposit" ? booking.deposit_qr : booking.balance_qr;
    const state = stage === "deposit" ? booking.deposit_state : booking.balance_state;
    const paidAt = stage === "deposit" ? booking.deposit_paid_at : booking.balance_paid_at;
    const stateLabel =
      stage === "deposit"
        ? state === "paid"
          ? "Paid"
          : state === "pending"
            ? "Pending"
            : state === "waived"
              ? "Waived"
              : "Not required"
        : state === "paid"
          ? "Paid"
          : state === "due"
            ? "Due"
            : state === "waived"
              ? "Not required"
              : "Not due";
    const tone = state === "paid" ? "text-success" : state === "pending" || state === "due" ? "text-warning" : "text-muted";
    const beforeDelivery = stage === "balance" && state === "not_due";
    return (
      <div key={stage} className="rounded-xl border border-line p-3 sm:p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <p className="text-sm font-extrabold text-ink">{stageLabel(booking, stage)}</p>
          <p className="text-sm font-black tabular-nums text-ink">{formatQr(amount)}</p>
        </div>
        <p className={cn("mt-0.5 flex items-center gap-1 text-xs font-semibold", tone)}>
          {state === "paid" && <CheckIcon size={12} />}
          {stateLabel}
          {state === "paid" && paidAt ? ` · ${formatStamp(paidAt)}` : ""}
          {stage === "balance" && state === "due" && booking.balance_due_at ? ` · since ${formatStamp(booking.balance_due_at)}` : ""}
        </p>
        <div className="mt-3">
          {beforeDelivery ? (
            <p className="text-sm text-muted">Not due until delivery. Deliver the gallery first; the final balance then becomes due and you create its link here.</p>
          ) : state === "paid" ? (
            latest?.status === "paid" ? <p className="text-xs text-muted">Paid online{latest.paid_at ? ` on ${formatStamp(latest.paid_at)}` : ""}{latest.provider_invoice_id ? ` · MyFatoorah invoice ${latest.provider_invoice_id}` : ""}.</p> : <p className="text-xs text-muted">Recorded by you{paidAt ? ` on ${formatStamp(paidAt)}` : ""}.</p>
          ) : (
            <StageRequestPanel
              bookingId={id}
              stage={stage}
              request={requestView(latest, providerStatus)}
              canRequest={blocker === null && !cancelled}
              blockerLabel={blocker ? STAGE_REQUEST_BLOCKER_LABEL[blocker] : null}
              paymentsEnabled={paymentsEnabled}
              hasEmail={Boolean(booking.customer_email)}
              createdLabel={latest ? formatStamp(latest.created_at) : null}
              sentLabel={latest?.sent_at ? formatStamp(latest.sent_at) : null}
            />
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-xs font-semibold text-muted">Total</p>
          <p className="text-2xl font-black text-ink">{priced ? formatQr(booking.amount_qr) : "Not set"}</p>
          {finalNote && <p className="text-xs text-muted">{finalNote}</p>}
        </div>
        <p className="text-xs text-muted">{fullyPaid ? "Paid in full" : priced ? `${formatQr(payment.dueQr)} still to collect` : "Set the price to split the 50% deposit and the balance."}</p>
      </div>
      {!cancelled && !fullyPaid && (
        <details className="rounded-xl border border-line p-3" open={!priced}>
          <summary className="cursor-pointer text-sm font-semibold text-ink">{priced ? "Change the price" : "Set the price"}</summary>
          <div className="mt-3">
            <FinalAmountForm bookingId={id} amountQr={Number(booking.amount_qr) || 0} currency={booking.currency} note={finalNote} locked={false} depositPaid={booking.deposit_state === "paid"} />
          </div>
        </details>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {stageBlock("deposit")}
        {stageBlock("balance")}
      </div>

      {Object.keys(mismatch).length > 0 && !fullyPaid && (
        <p className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-xs font-semibold text-danger" role="alert">
          MyFatoorah reported a payment of {String(mismatch.amount)} {String(mismatch.currency ?? "")} for invoice {String(mismatch.invoice_id)}, but the {mismatch.stage === "balance" ? "balance" : "deposit"} request expects {formatQr(Number(mismatch.expected))}. It was not marked paid. Check the MyFatoorah portal and record it by hand if it is genuine.
        </p>
      )}
      {booking.status === "refunded" && <p className="rounded-lg bg-page px-3 py-2 text-xs font-semibold text-muted">Refunded through MyFatoorah{booking.refunded_at ? ` on ${formatStamp(booking.refunded_at)}` : ""}.</p>}

      {paymentRecords.length > 0 && (
        <ul className="divide-y divide-line rounded-xl border border-line text-sm">
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
      {!cancelled && !fullyPaid && priced && (
        <div>
          <p className="mb-2 text-xs text-muted">Cash, bank transfer or Fawran received by hand (say which stage it settles):</p>
          <ManualPaymentForm bookingId={id} providerPaid={false} currency={booking.currency} stages={stages.map((s) => ({ ...s, amountQr: Number(s.stage === "deposit" ? booking.deposit_qr : booking.balance_qr) || 0 }))} />
        </div>
      )}
    </div>
  );
}
