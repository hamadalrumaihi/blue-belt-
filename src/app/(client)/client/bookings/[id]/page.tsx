import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeftIcon, DownloadIcon, ExternalIcon, MapPinIcon } from "@/components/icons";
import { BOOKING_TYPE_LABEL, bookingDetails, effectivePayment, formatQr, PAYMENT_METHOD_LABEL } from "@/lib/bookings/state";
import { getMyBooking, loadMyPeople } from "@/lib/client-portal/queries";
import { DOCUMENT_KIND_LABEL, DOCUMENT_STATUS_LABEL, isDocumentKind } from "@/lib/documents/state";
import { isStudioRole, resolveViewer } from "@/lib/roles";
import { formatDateTime } from "@/lib/time";
import { isUuid } from "@/lib/validation";
import { BookingStatusPill } from "../../BookingStatusPill";
import { ClientHeader } from "../../ClientHeader";

export const metadata: Metadata = { title: "Booking" };
export const dynamic = "force-dynamic";

export default async function ClientBookingPage({ params }: PageProps<"/client/bookings/[id]">) {
  const viewer = await resolveViewer();
  if (!viewer) redirect("/client/login");
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const people = await loadMyPeople(viewer.userId);
  const item = await getMyBooking(id, people.map((p) => p.id));
  if (!item) notFound();
  const { booking, documents, gallery, payments } = item;
  const pay = effectivePayment(booking);
  const details = bookingDetails(booking);
  const galleryOpen = gallery && (gallery.status === "ready" || gallery.status === "delivered") && gallery.pictime_url ? gallery.pictime_url : null;

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

        <section className="card mt-4 p-4">
          <p className="eyebrow">Payment</p>
          <p className="mt-1 text-2xl font-black text-ink">{formatQr(booking.amount_qr)}</p>
          <p className="text-sm font-semibold text-ink">{pay.state === "paid" ? "Paid, thank you" : pay.state === "partial" ? `${formatQr(pay.paidQr)} received · ${formatQr(pay.dueQr)} still due` : pay.state === "refunded" ? "Refunded" : Number(booking.amount_qr) > 0 ? "Payment pending" : "Nothing to pay"}</p>
          {pay.state !== "paid" && pay.state !== "refunded" && booking.payment_url && booking.booking_status !== "cancelled" && <a href={booking.payment_url} target="_blank" rel="noopener noreferrer" className="btn-primary mt-3 min-h-12 w-full sm:w-auto">Pay now</a>}
          {payments.length > 0 && (
            <ul className="mt-3 divide-y divide-line text-sm">
              {payments.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="text-ink">{PAYMENT_METHOD_LABEL[p.method] ?? p.method}<span className="block text-xs text-muted">{formatDateTime(p.paid_at)} Qatar time{p.note ? ` · ${p.note}` : ""}</span></span>
                  <span className="tabular-nums font-semibold text-ink">{formatQr(p.amount_qr)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card mt-4 p-4">
          <p className="eyebrow">Agreements</p>
          {documents.length === 0 ? (
            <p className="mt-1 text-sm text-muted">No agreement has been sent for this booking yet.</p>
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
                    <p className="text-xs text-muted">Open the signing link from your e-mail or WhatsApp.</p>
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
              <p className="mt-1 text-sm text-ink">Your photos are ready{gallery?.name ? `: ${gallery.name}` : ""}.</p>
              <a href={galleryOpen} target="_blank" rel="noopener noreferrer" className="btn-primary mt-3 min-h-12 w-full sm:w-auto"><ExternalIcon size={16} /> View gallery</a>
            </>
          ) : (
            <p className="mt-1 text-sm text-muted">Your gallery link will appear here when the photos are ready. You will also get an e-mail.</p>
          )}
        </section>
      </main>
    </>
  );
}
