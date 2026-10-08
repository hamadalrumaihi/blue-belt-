import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CheckIcon, ChevronLeftIcon, DownloadIcon, ExternalIcon, MapPinIcon } from "@/components/icons";
import { BOOKING_TYPE_LABEL, bookingDetails, formatMoney } from "@/lib/bookings/state";
import { getMyBooking, loadMyPeople, type ClientStageLine } from "@/lib/client-portal/queries";
import { DOCUMENT_KIND_LABEL, DOCUMENT_STATUS_LABEL, isDocumentKind } from "@/lib/documents/state";
import { isStudioRole, resolveViewer } from "@/lib/roles";
import { formatDateTime } from "@/lib/time";
import { cn } from "@/lib/utils";
import { isUuid } from "@/lib/validation";
import { BookingStatusPill } from "../../BookingStatusPill";
import { ClientHeader } from "../../ClientHeader";

export const metadata: Metadata = { title: "Booking" };
export const dynamic = "force-dynamic";

/** Customer-safe method words: cash, bank and Fawran by name; anything else is simply an online payment (never a vendor name). */
const METHOD_WORDS: Record<string, string> = { cash: "Cash", bank_transfer: "Bank transfer", fawran: "Fawran", other: "Other" };
function methodLabel(method: string): string {
  return METHOD_WORDS[method] ?? "Online payment";
}

export default async function ClientBookingPage({ params }: PageProps<"/client/bookings/[id]">) {
  const viewer = await resolveViewer();
  if (!viewer) redirect("/client/login");
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const people = await loadMyPeople(viewer.userId, viewer.email);
  const item = await getMyBooking(id, people.map((p) => p.id));
  if (!item) notFound();
  const { booking, documents, gallery, payments, summary } = item;
  const details = bookingDetails(booking);
  const galleryOpen = gallery && (gallery.status === "ready" || gallery.status === "delivered") && gallery.pictime_url ? gallery.pictime_url : null;
  const priced = Number(booking.amount_qr) > 0;

  return (
    <>
      <ClientHeader studioView={isStudioRole(viewer.role)} />
      <main className="mx-auto w-full max-w-3xl px-4 py-6">
        <Link href="/client" className="btn-ghost -ml-2 mb-3 min-h-11 px-2 text-sm text-muted"><ChevronLeftIcon size={18} /> My bookings</Link>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="eyebrow">{booking.public_ref ?? "Booking"}</p>
            <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-ink">{booking.package_name}</h1>
            <p className="text-sm text-muted">{BOOKING_TYPE_LABEL[booking.booking_type]}</p>
          </div>
          <BookingStatusPill status={booking.booking_status} />
        </div>

        <section className="card mt-5 p-4">
          <p className="eyebrow">Session</p>
          <dl className="mt-2 grid grid-cols-[7rem_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted">Athlete</dt><dd className="text-ink">{booking.athlete_name}</dd>
            {booking.academy && <><dt className="text-muted">Academy</dt><dd className="text-ink">{booking.academy}</dd></>}
            {booking.division && <><dt className="text-muted">Division</dt><dd className="text-ink">{booking.division}</dd></>}
            <dt className="text-muted">When</dt><dd className="text-ink">{booking.session_at ? `${formatDateTime(booking.session_at)} Qatar time` : details.requested_date ? `${details.requested_date}${details.requested_time ? ` ${details.requested_time}` : ""} (requested)` : "To be confirmed"}</dd>
            {booking.location && <><dt className="text-muted">Where</dt><dd className="flex items-start gap-1 text-ink"><MapPinIcon size={16} className="mt-0.5 shrink-0 text-muted" /><span>{booking.location}</span></dd></>}
            {details.coverage && <><dt className="text-muted">Coverage</dt><dd className="text-ink">{details.coverage === "both" ? "Photo + video" : details.coverage === "video" ? "Video" : "Photo"}</dd></>}
          </dl>
        </section>

        <section className="card mt-4 p-4" aria-labelledby="client-pay-h">
          <p id="client-pay-h" className="eyebrow">Payment</p>
          {priced ? (
            <>
              <p className="mt-1 text-2xl font-black text-ink">{formatMoney(booking.amount_qr, booking.currency)}</p>
              <p className="text-sm font-semibold text-ink">{summary.headline}</p>
              <ul className="mt-3 divide-y divide-line text-sm">
                <StageRow title="Deposit (50%)" line={summary.deposit} />
                <StageRow title="Remaining balance (50%)" line={summary.balance} />
              </ul>
              {summary.pay ? (
                <a href={summary.pay.payUrl} className="btn-primary mt-4 min-h-12 w-full sm:w-auto">Pay online {summary.pay.amount}</a>
              ) : summary.deposit.due && !summary.contract.signed ? (
                <p className="mt-3 text-sm text-muted">Sign your agreement first. We will then send you a secure online payment link for the deposit.</p>
              ) : summary.deposit.due || summary.balance.due ? (
                <p className="mt-3 text-sm text-muted">We will send you a secure online payment link.</p>
              ) : null}
            </>
          ) : (
            <p className="mt-1 text-sm text-muted">{booking.booking_status === "cancelled" ? "Cancelled. Nothing to pay." : "We will confirm the price shortly. You secure the booking with a 50% deposit paid online once the agreement is signed; the remaining 50% is due after delivery."}</p>
          )}
          {payments.length > 0 && (
            <ul className="mt-4 divide-y divide-line border-t border-line text-sm">
              {payments.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="text-ink">{methodLabel(p.method)}<span className="block text-xs text-muted">{formatDateTime(p.paid_at)} Qatar time</span></span>
                  <span className="tabular-nums font-semibold text-ink">{formatMoney(p.amount_qr, p.currency)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card mt-4 p-4">
          <p className="eyebrow">Agreement</p>
          <p className="mt-1 text-sm font-semibold text-ink">{summary.contract.label}</p>
          {documents.length === 0 ? (
            <p className="mt-1 text-sm text-muted">{booking.requires_contract ? "Your agreement will be sent to you to sign." : "No agreement is needed for this booking."}</p>
          ) : (
            <ul className="mt-2 divide-y divide-line">
              {documents.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-ink">{d.title}</p>
                    <p className="text-xs text-muted">{isDocumentKind(d.kind) ? DOCUMENT_KIND_LABEL[d.kind] : d.kind} · {DOCUMENT_STATUS_LABEL[d.status]}{d.signed_at ? ` ${formatDateTime(d.signed_at)}` : ""}</p>
                  </div>
                  {d.status === "signed" ? (
                    <a href={`/api/documents/${d.id}/pdf`} className="btn-secondary min-h-11"><DownloadIcon size={16} /> Download signed copy</a>
                  ) : d.status === "sent" || d.status === "viewed" ? (
                    <p className="text-xs text-muted">Open the signing link from your e-mail or WhatsApp to sign your agreement.</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card mt-4 p-4">
          <p className="eyebrow">Gallery</p>
          {galleryOpen ? (
            <>
              <p className="mt-1 text-sm text-ink">{gallery?.status === "delivered" ? "Your private gallery is delivered" : "Your private gallery is ready"}{gallery?.name ? `: ${gallery.name}` : ""}.</p>
              <a href={galleryOpen} target="_blank" rel="noopener noreferrer" className="btn-primary mt-3 min-h-12 w-full sm:w-auto"><ExternalIcon size={16} /> View and buy photos</a>
            </>
          ) : (
            <p className="mt-1 text-sm text-muted">{booking.booking_status === "in_progress" ? "Editing. Your private gallery link will appear here when it is ready." : "Your private gallery link will appear here when the photos are ready."}</p>
          )}
        </section>
      </main>
    </>
  );
}

function StageRow({ title, line }: { title: string; line: ClientStageLine }) {
  return (
    <li className="flex items-center justify-between gap-3 py-2">
      <span className="min-w-0">
        <span className="block font-semibold text-ink">{title}</span>
        <span className={cn("flex items-center gap-1 text-xs", line.paid ? "text-success" : line.due ? "text-warning" : "text-muted")}>{line.paid && <CheckIcon size={12} />}{line.label}</span>
      </span>
      {line.amount && <span className="shrink-0 tabular-nums font-semibold text-ink">{line.amount}</span>}
    </li>
  );
}
