import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { EmptyState } from "@/components/EmptyState";
import { BookmarkIcon, ChevronRightIcon, ExternalIcon } from "@/components/icons";
import { BOOKING_TYPE_LABEL, effectivePayment, formatQr } from "@/lib/bookings/state";
import { listMyBookings, loadMyPeople } from "@/lib/client-portal/queries";
import { DOCUMENT_STATUS_LABEL } from "@/lib/documents/state";
import { isStudioRole, resolveViewer } from "@/lib/roles";
import { loadPublicStudio } from "@/lib/studio/queries";
import { formatDateTime } from "@/lib/time";
import { BookingStatusPill } from "./BookingStatusPill";
import { ClientHeader } from "./ClientHeader";

export const metadata: Metadata = { title: "My bookings" };
export const dynamic = "force-dynamic";

export default async function ClientPortalPage() {
  const viewer = await resolveViewer();
  if (!viewer) redirect("/client/login");
  const studioView = isStudioRole(viewer.role);
  const [people, pub] = await Promise.all([loadMyPeople(viewer.userId, viewer.email), loadPublicStudio()]);
  const items = await listMyBookings(people.map((p) => p.id));
  const contactHref = pub?.studio.whatsapp ? `https://wa.me/${pub.studio.whatsapp.replace(/\D/g, "")}` : pub?.studio.email ? `mailto:${pub.studio.email}` : "/contact";

  return (
    <>
      <ClientHeader studioView={studioView} />
      <main className="mx-auto w-full max-w-3xl px-4 py-6">
        {studioView && <p className="mb-4 rounded-xl border border-primary/20 bg-lightblue px-3 py-2 text-xs font-semibold text-primary" role="status">You are viewing the portal as the studio. Clients only see bookings linked to their own e-mail.</p>}
        <h1 className="text-2xl font-extrabold tracking-tight text-ink">My bookings</h1>
        <p className="mt-1 text-sm text-muted">{people[0] ? `Signed in as ${people[0].full_name}` : viewer.email ?? ""}</p>

        {items.length === 0 ? (
          <EmptyState
            className="mt-6"
            icon={<BookmarkIcon />}
            title="No bookings are linked to this e-mail yet."
            description="If you booked with a different address, sign in with that one. Otherwise get in touch and we will link your booking."
            action={<a href={contactHref} className="btn-primary" target={contactHref.startsWith("http") ? "_blank" : undefined} rel="noopener noreferrer">Contact the studio</a>}
          />
        ) : (
          <ul className="mt-6 space-y-3">
            {items.map(({ booking, documents, gallery, payments }) => {
              const pay = effectivePayment(booking);
              const contract = documents[0] ?? null;
              const when = booking.session_at ? formatDateTime(booking.session_at) : null;
              return (
                <li key={booking.id} className="card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="eyebrow">{booking.public_ref ?? "Booking"}</p>
                      <h2 className="mt-1 truncate text-lg font-extrabold text-ink">{booking.package_name}</h2>
                      <p className="text-sm text-muted">{BOOKING_TYPE_LABEL[booking.booking_type]} · {booking.athlete_name}{when ? ` · ${when} Qatar time` : ""}</p>
                    </div>
                    <BookingStatusPill status={booking.booking_status} />
                  </div>

                  <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
                    <div className="rounded-xl bg-page p-3">
                      <dt className="text-xs font-semibold text-muted">Payment</dt>
                      <dd className="mt-0.5 font-bold text-ink">{pay.state === "paid" ? "Paid" : pay.state === "partial" ? `Part paid · ${formatQr(pay.dueQr)} due` : pay.state === "refunded" ? "Refunded" : Number(booking.amount_qr) > 0 ? `Payment pending · ${formatQr(booking.amount_qr)}` : "No payment due"}</dd>
                      {pay.state !== "paid" && pay.state !== "refunded" && booking.payment_url && booking.booking_status !== "cancelled" && <a href={booking.payment_url} target="_blank" rel="noopener noreferrer" className="btn-primary mt-2 min-h-10 w-full px-3 text-xs">Pay now</a>}
                    </div>
                    <div className="rounded-xl bg-page p-3">
                      <dt className="text-xs font-semibold text-muted">Agreement</dt>
                      <dd className="mt-0.5 font-bold text-ink">{contract ? DOCUMENT_STATUS_LABEL[contract.status] : "None yet"}</dd>
                      {contract && (contract.status === "sent" || contract.status === "viewed") && <p className="mt-1 text-xs text-muted">Open the signing link from your e-mail or WhatsApp to sign.</p>}
                      {contract?.status === "signed" && <a href={`/api/documents/${contract.id}/pdf`} className="mt-1 inline-block text-xs font-semibold text-primary hover:underline">Download signed copy</a>}
                    </div>
                    <div className="rounded-xl bg-page p-3">
                      <dt className="text-xs font-semibold text-muted">Gallery</dt>
                      <dd className="mt-0.5 font-bold text-ink">{gallery && (gallery.status === "ready" || gallery.status === "delivered") && gallery.pictime_url ? "Ready" : "Not ready yet"}</dd>
                      {gallery && (gallery.status === "ready" || gallery.status === "delivered") && gallery.pictime_url && <a href={gallery.pictime_url} target="_blank" rel="noopener noreferrer" className="btn-secondary mt-2 min-h-10 w-full px-3 text-xs"><ExternalIcon size={14} /> View gallery</a>}
                    </div>
                  </dl>

                  <div className="mt-3 flex items-center justify-between gap-2">
                    <p className="text-xs text-muted">{payments.length ? `${payments.length} payment${payments.length === 1 ? "" : "s"} recorded` : ""}</p>
                    <Link href={`/client/bookings/${booking.id}`} className="btn-ghost min-h-11 px-3 text-sm text-primary">Details <ChevronRightIcon size={16} /></Link>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </>
  );
}
