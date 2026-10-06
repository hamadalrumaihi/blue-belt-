import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BrandHeader } from "@/components/BrandHeader";
import { PageBody } from "@/components/AppShell";
import { EditIcon, FileTextIcon, ImageIcon, MailIcon, PhoneIcon, TrashIcon, WhatsAppIcon } from "@/components/icons";
import { getBooking, listAssignableTeam } from "@/lib/bookings/queries";
import { BOOKING_TYPE_LABEL, bookingDetails, formatQr, PAYMENT_METHOD_LABEL, PAYMENT_MODE_LABEL } from "@/lib/bookings/state";
import { DOCUMENT_STATUS_LABEL } from "@/lib/documents/state";
import { GALLERY_STATUS_LABEL } from "@/lib/galleries/state";
import { isPaymentsEnabled } from "@/lib/payments/config";
import { whatsappDigits } from "@/lib/people/form";
import { listAthletes } from "@/lib/queries";
import { describeAudit } from "@/lib/studio/dashboard";
import { formatDateTime, formatEventDate, formatStamp, zoneLabel } from "@/lib/time";
import { isUuid } from "@/lib/validation";
import { AthleteLink } from "../AthleteLink";
import { BookingActions } from "../BookingActions";
import { BookingStatusBadge } from "../BookingStatusBadge";
import { CoverageAssign } from "../CoverageAssign";
import { InvoicePanel } from "../InvoicePanel";
import { ManualPaymentForm } from "../ManualPaymentForm";
import { PaymentBadge } from "../PaymentBadge";
import { DeletePaymentButton } from "./DeletePaymentButton";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/bookings/[id]">): Promise<Metadata> {
  const { id } = await params;
  const detail = isUuid(id) ? await getBooking(id) : null;
  return { title: detail ? `${detail.booking.public_ref ?? "Booking"} — ${detail.booking.customer_name}` : "Booking" };
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="flex gap-3 py-1.5 text-sm">
      <dt className="w-28 shrink-0 text-muted">{label}</dt>
      <dd className="min-w-0 flex-1 break-words text-ink">{value}</dd>
    </div>
  );
}

export default async function BookingDetailPage({ params }: PageProps<"/bookings/[id]">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const detail = await getBooking(id);
  if (!detail) notFound();
  const { booking, client, organization, service, event, gallery, documents, paymentRecords, payment, audit, linkedAthlete } = detail;
  const [team, athletes] = await Promise.all([listAssignableTeam(booking.event_id), booking.event_id ? listAthletes(booking.event_id) : Promise.resolve([])]);
  const d = bookingDetails(booking);
  const phone = client?.phone ?? booking.customer_phone;
  const email = client?.email ?? booking.customer_email;
  const wa = whatsappDigits(client?.whatsapp ?? phone);
  const paymentsEnabled = isPaymentsEnabled();
  const canInvoice = !booking.provider_invoice_id && booking.status !== "paid" && booking.status !== "refunded" && booking.booking_status !== "cancelled" && booking.booking_status !== "completed" && Number(booking.amount_qr) > 0;

  return (
    <>
      <BrandHeader title={booking.customer_name} subtitle={`${booking.public_ref ?? "Booking"} · ${BOOKING_TYPE_LABEL[booking.booking_type]}`} backHref="/bookings" actions={<Link href={`/bookings/${id}/edit`} className="btn-secondary min-h-10"><EditIcon size={16} /> Edit</Link>} />
      <PageBody className="max-w-5xl">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm font-bold text-ink">{booking.public_ref ?? "No reference"}</span>
          <BookingStatusBadge status={booking.booking_status} />
          <PaymentBadge payment={payment} amountQr={booking.amount_qr} detailed />
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <section className="card p-4" aria-labelledby="actions-h">
              <h2 id="actions-h" className="eyebrow">Next step</h2>
              <div className="mt-3"><BookingActions bookingId={id} status={booking.booking_status} /></div>
            </section>

            <section className="card p-4" aria-labelledby="client-h">
              <h2 id="client-h" className="eyebrow">Client</h2>
              <p className="mt-1 text-lg font-extrabold text-ink">{client ? <Link href={`/people/${client.id}`} className="hover:underline">{client.full_name}</Link> : booking.customer_name}</p>
              {organization && <p className="text-sm text-muted">{organization.name} · <Link href={`/clubs/${organization.id}`} className="font-semibold text-primary hover:underline">open club</Link></p>}
              <div className="mt-3 grid grid-cols-3 gap-2">
                {phone ? <a href={`tel:${phone}`} className="btn-secondary min-h-11"><PhoneIcon size={16} /> Call</a> : <span className="btn-secondary min-h-11 opacity-50" aria-disabled>No phone</span>}
                {wa ? <a href={`https://wa.me/${wa}`} target="_blank" rel="noopener noreferrer" className="btn-secondary min-h-11"><WhatsAppIcon size={16} /> WhatsApp</a> : <span className="btn-secondary min-h-11 opacity-50" aria-disabled>No WhatsApp</span>}
                {email ? <a href={`mailto:${email}`} className="btn-secondary min-h-11"><MailIcon size={16} /> Email</a> : <span className="btn-secondary min-h-11 opacity-50" aria-disabled>No e-mail</span>}
              </div>
              <dl className="mt-3 divide-y divide-line">
                <Row label="Phone" value={phone} />
                <Row label="Email" value={email} />
                <Row label="Instagram" value={client?.instagram ? `@${client.instagram}` : d.instagram} />
                {!email && <Row label="Note" value={<span className="text-warning">No e-mail on file — confirmations and payment links cannot be e-mailed.</span>} />}
              </dl>
            </section>

            <section className="card p-4" aria-labelledby="what-h">
              <h2 id="what-h" className="eyebrow">What</h2>
              <dl className="mt-2 divide-y divide-line">
                <Row label="Type" value={BOOKING_TYPE_LABEL[booking.booking_type]} />
                <Row label="Service" value={service ? <Link href="/packages" className="hover:underline">{service.name}</Link> : booking.package_name} />
                <Row label="Athlete" value={booking.athlete_name || d.athlete_name} />
                <Row label="Academy" value={d.academy ?? booking.academy} />
                <Row label="Belt" value={d.belt} />
                <Row label="Division" value={[d.age_division, d.weight_division, booking.division].filter(Boolean).join(" · ")} />
                <Row label="Gi" value={d.gi === "both" ? "Gi + No-Gi" : d.gi === "no-gi" ? "No-Gi" : d.gi === "gi" ? "Gi" : null} />
                <Row label="Coverage" value={d.coverage === "both" ? "Photo + video" : d.coverage === "photo" ? "Photo" : d.coverage === "video" ? "Video" : [d.wants_photographer ? "Photographer" : null, d.wants_videographer ? "Videographer" : null].filter(Boolean).join(" + ") || null} />
                <Row label="Athletes" value={d.athlete_count} />
                <Row label="Booked for" value={d.booked_for === "self" ? "The client" : d.booked_for === "child" ? "Their child" : d.booked_for === "athlete" ? "An athlete they manage" : d.booked_for === "club" ? "A club" : null} />
                <Row label="Bracket URL" value={d.source_url ? <a href={d.source_url} target="_blank" rel="noopener noreferrer" className="break-all text-primary hover:underline">{d.source_url}</a> : null} />
                <Row label="Notes" value={booking.notes} />
              </dl>
            </section>

            <section className="card p-4" aria-labelledby="when-h">
              <h2 id="when-h" className="eyebrow">When &amp; where</h2>
              <dl className="mt-2 divide-y divide-line">
                <Row label="Session" value={booking.session_at ? `${formatDateTime(booking.session_at)} ${zoneLabel()}${booking.session_end_at ? ` → ${formatDateTime(booking.session_end_at)}` : ""}` : <span className="text-muted">Not set</span>} />
                <Row label="Location" value={booking.location ?? <span className="text-muted">Not set</span>} />
                <Row label="Event" value={event ? <Link href={`/events/${event.id}`} className="font-semibold text-primary hover:underline">{event.name}{event.event_date ? ` · ${formatEventDate(event.event_date, "short")}` : ""}</Link> : null} />
                <Row label="Competition" value={d.competition_date ? formatEventDate(d.competition_date, "short") : null} />
              </dl>
              <div className="mt-3 border-t border-line pt-3">
                <p className="mb-2 text-xs font-semibold text-muted">Who shoots it</p>
                <CoverageAssign bookingId={id} photographerId={booking.assigned_photographer_id} videographerId={booking.assigned_videographer_id} team={team} />
              </div>
            </section>

            <section className="card p-4" aria-labelledby="pay-h">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id="pay-h" className="eyebrow">Payment</h2>
                <PaymentBadge payment={payment} amountQr={booking.amount_qr} detailed />
              </div>
              <p className="mt-1 text-2xl font-black text-ink">{formatQr(booking.amount_qr)}</p>
              <p className="text-xs text-muted">{PAYMENT_MODE_LABEL[booking.payment_mode]}{payment.paidQr > 0 ? ` · received ${formatQr(payment.paidQr)}` : ""}{payment.dueQr > 0 && Number(booking.amount_qr) > 0 ? ` · due ${formatQr(payment.dueQr)}` : ""}</p>
              {booking.status === "paid" && <p className="mt-2 rounded-lg bg-success-soft px-3 py-2 text-xs font-semibold text-success">Paid online — verified by MyFatoorah{booking.paid_at ? ` on ${formatStamp(booking.paid_at)}` : ""}.</p>}
              {booking.status === "refunded" && <p className="mt-2 rounded-lg bg-page px-3 py-2 text-xs font-semibold text-muted">Refunded through MyFatoorah{booking.refunded_at ? ` on ${formatStamp(booking.refunded_at)}` : ""}.</p>}
              {paymentRecords.length > 0 && (
                <ul className="mt-3 divide-y divide-line rounded-xl border border-line text-sm">
                  {paymentRecords.map((r) => (
                    <li key={r.id} className="flex items-center gap-3 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-ink">{formatQr(r.amount_qr)} <span className="font-normal text-muted">· {PAYMENT_METHOD_LABEL[r.method]}{r.kind === "provider" ? " (verified)" : ""}</span></p>
                        <p className="truncate text-xs text-muted">{formatStamp(r.paid_at)}{r.note ? ` · ${r.note}` : ""}</p>
                      </div>
                      {r.kind === "manual" && <DeletePaymentButton recordId={r.id} summary={`${formatQr(r.amount_qr)} · ${PAYMENT_METHOD_LABEL[r.method]}`} />}
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                {booking.booking_status !== "cancelled" && <ManualPaymentForm bookingId={id} providerPaid={booking.status === "paid"} dueQr={payment.dueQr} currency={booking.currency} />}
              </div>
              <div className="mt-4 border-t border-line pt-3">
                <p className="mb-2 text-xs font-semibold text-muted">MyFatoorah</p>
                <InvoicePanel bookingId={id} paymentsEnabled={paymentsEnabled} paymentUrl={booking.payment_url} canInvoice={canInvoice} invoiceId={booking.provider_invoice_id} />
              </div>
            </section>
          </div>

          <div className="space-y-4">
            <section className="card p-4" aria-labelledby="agree-h">
              <h2 id="agree-h" className="eyebrow">Agreement</h2>
              {documents.length === 0 ? (
                <p className="mt-1 text-sm text-muted">No agreement yet.</p>
              ) : (
                <ul className="mt-2 space-y-1.5 text-sm">
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
              <Link href={`/documents/new?booking=${id}`} className="btn-secondary mt-3 min-h-11 w-full"><FileTextIcon size={16} /> New agreement</Link>
            </section>

            <section className="card p-4" aria-labelledby="gal-h">
              <h2 id="gal-h" className="eyebrow">Gallery</h2>
              {gallery ? (
                <Link href={`/galleries/${gallery.id}`} className="mt-1 block rounded-lg px-2 py-1.5 hover:bg-page">
                  <p className="truncate font-semibold text-ink">{gallery.name}</p>
                  <p className="text-xs text-muted">{GALLERY_STATUS_LABEL[gallery.status]}{gallery.delivered_at ? ` · ${formatStamp(gallery.delivered_at)}` : gallery.ready_at ? ` · ready ${formatStamp(gallery.ready_at)}` : ""}</p>
                </Link>
              ) : (
                <p className="mt-1 text-sm text-muted">No gallery linked yet.</p>
              )}
              {!gallery && <Link href={`/galleries/new?booking=${id}`} className="btn-secondary mt-3 min-h-11 w-full"><ImageIcon size={16} /> Add gallery</Link>}
            </section>

            <section className="card p-4" aria-labelledby="tour-h">
              <h2 id="tour-h" className="eyebrow">Tournament link</h2>
              <div className="mt-2">
                <AthleteLink bookingId={id} eventId={booking.event_id} eventName={event?.name ?? null} athletes={athletes.map((a) => ({ id: a.id, name: a.name }))} linked={linkedAthlete} />
              </div>
            </section>

            <section className="card p-4" aria-labelledby="time-h">
              <h2 id="time-h" className="eyebrow">Timeline</h2>
              {audit.length === 0 ? (
                <p className="mt-1 text-sm text-muted">Nothing recorded yet.</p>
              ) : (
                <ol className="mt-2 space-y-2 text-sm">
                  {audit.map((row) => {
                    const item = describeAudit(row);
                    return (
                      <li key={row.id} className="border-l-2 border-line pl-3">
                        <p className="text-ink">{item.text}</p>
                        <p className="text-[11px] text-muted">{formatStamp(row.created_at)} · {row.actor_kind}</p>
                      </li>
                    );
                  })}
                </ol>
              )}
              <dl className="mt-3 border-t border-line pt-2 text-[11px] text-muted">
                <div className="flex justify-between"><dt>Created</dt><dd>{formatStamp(booking.created_at)}</dd></div>
                {booking.confirmed_at && <div className="flex justify-between"><dt>Confirmed</dt><dd>{formatStamp(booking.confirmed_at)}</dd></div>}
                {booking.delivered_at && <div className="flex justify-between"><dt>Delivered</dt><dd>{formatStamp(booking.delivered_at)}</dd></div>}
                {booking.cancelled_at && <div className="flex justify-between"><dt>Cancelled</dt><dd>{formatStamp(booking.cancelled_at)}{booking.cancel_reason ? ` — ${booking.cancel_reason}` : ""}</dd></div>}
              </dl>
            </section>
            <p className="flex items-center gap-1.5 px-1 text-[11px] text-muted"><TrashIcon size={12} /> Bookings are never deleted; cancel them instead so the history stays intact.</p>
          </div>
        </div>
      </PageBody>
    </>
  );
}
