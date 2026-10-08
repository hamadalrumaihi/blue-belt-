import { CheckIcon } from "@/components/icons";
import type { BookingDetail } from "@/lib/bookings/queries";
import { formatStamp } from "@/lib/time";
import { cn } from "@/lib/utils";

type Step = { key: string; title: string; at: string | null; done: boolean; note?: string | null };

function earliest(values: Array<string | null | undefined>): string | null {
  const v = values.filter((x): x is string => Boolean(x)).sort();
  return v[0] ?? null;
}

/**
 * The booking's journey with timestamps, derived from the booking columns,
 * the document rows and the payment requests. Missing steps show as pending
 * so the owner sees what is left.
 */
export function bookingTimelineSteps(detail: BookingDetail): Step[] {
  const { booking, documents, paymentRequests, audit, gallery } = detail;
  const sentDoc = earliest(documents.map((d) => d.sent_at));
  const signedDocs = documents.filter((d) => d.status === "signed");
  const allSigned = booking.contract_state === "signed";
  const signedAt = allSigned ? signedDocs.map((d) => d.signed_at).filter(Boolean).sort().pop() ?? null : null;
  const depositRequested = earliest(paymentRequests.filter((r) => r.stage === "deposit").map((r) => r.created_at));
  const balanceRequested = earliest(paymentRequests.filter((r) => r.stage === "balance").map((r) => r.created_at));
  const priceSet = audit.filter((a) => a.action === "booking.price_set" || a.action === "booking.final_amount" || a.action === "quote.applied").map((a) => a.created_at).sort()[0] ?? null;
  const priced = Number(booking.amount_qr) > 0;
  const depositRequired = booking.deposit_state === "pending" || booking.deposit_state === "paid";
  const balanceExpected = Number(booking.balance_qr) > 0 && booking.balance_state !== "waived";
  const contractRequired = booking.requires_contract && booking.contract_state !== "not_required";
  const editing = booking.coverage_done_at && (booking.booking_status === "in_progress" || booking.booking_status === "delivered" || booking.booking_status === "completed");
  return [
    { key: "received", title: "Request received", at: booking.created_at, done: true },
    { key: "priced", title: booking.quoted_at ? "Quote approved" : "Price set", at: booking.quoted_at ?? priceSet, done: priced && Boolean(booking.quoted_at ?? priceSet) },
    { key: "sent", title: "Agreement sent", at: sentDoc, done: Boolean(sentDoc), note: contractRequired ? null : "Not required" },
    { key: "signed", title: "Agreement signed", at: signedAt, done: allSigned, note: contractRequired ? null : "Not required" },
    { key: "deposit_requested", title: "Deposit payment requested", at: depositRequested, done: Boolean(depositRequested), note: depositRequired ? null : "Not required" },
    { key: "deposit_paid", title: "Deposit paid", at: booking.deposit_paid_at, done: booking.deposit_state === "paid", note: depositRequired ? null : "Not required" },
    { key: "confirmed", title: "Booking confirmed", at: booking.confirmed_at, done: Boolean(booking.confirmed_at) },
    { key: "shoot", title: "Shoot completed", at: booking.coverage_done_at, done: Boolean(booking.coverage_done_at) },
    { key: "editing", title: "Editing", at: editing ? booking.coverage_done_at : null, done: Boolean(editing) },
    { key: "gallery_ready", title: "Gallery ready", at: gallery?.ready_at ?? null, done: Boolean(gallery?.ready_at) },
    { key: "delivered", title: "Gallery delivered", at: booking.gallery_delivered_at ?? booking.delivered_at, done: Boolean(booking.gallery_delivered_at ?? booking.delivered_at) },
    { key: "balance_due", title: "Final balance due", at: booking.balance_due_at, done: Boolean(booking.balance_due_at), note: balanceExpected ? null : "Nothing left to pay" },
    { key: "balance_requested", title: "Final balance payment requested", at: balanceRequested, done: Boolean(balanceRequested), note: balanceExpected ? null : "Not required" },
    { key: "balance_paid", title: "Final balance paid", at: booking.balance_paid_at, done: booking.balance_state === "paid", note: balanceExpected ? null : "Not required" },
    { key: "completed", title: "Completed", at: booking.completed_at, done: booking.booking_status === "completed" },
  ];
}

export function BookingTimeline({ detail }: { detail: BookingDetail }) {
  const steps = bookingTimelineSteps(detail);
  const cancelled = detail.booking.booking_status === "cancelled";
  return (
    <ol className="space-y-1.5 text-sm">
      {steps.map((s) => (
        <li key={s.key} className={cn("flex items-start gap-2 border-l-2 pl-3", s.done ? "border-success" : "border-line")}>
          <span className={cn("mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full", s.done ? "bg-success text-white" : "border border-line bg-page")} aria-hidden>{s.done && <CheckIcon size={10} />}</span>
          <span className="min-w-0 flex-1">
            <span className={cn("block", s.done ? "font-semibold text-ink" : "text-muted")}>{s.title}</span>
            <span className="block text-[11px] text-muted">{s.at ? formatStamp(s.at) : s.note ?? (cancelled ? "" : "Pending")}</span>
          </span>
        </li>
      ))}
      {cancelled && (
        <li className="flex items-start gap-2 border-l-2 border-danger pl-3">
          <span className="mt-0.5 h-4 w-4 shrink-0 rounded-full bg-danger" aria-hidden />
          <span><span className="block font-semibold text-danger">Cancelled</span><span className="block text-[11px] text-muted">{detail.booking.cancelled_at ? formatStamp(detail.booking.cancelled_at) : ""}{detail.booking.cancel_reason ? ` · ${detail.booking.cancel_reason}` : ""}</span></span>
        </li>
      )}
    </ol>
  );
}
