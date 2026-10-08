import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BrandHeader } from "@/components/BrandHeader";
import { PageBody } from "@/components/AppShell";
import { AlertIcon, EditIcon, ImageIcon, MailIcon, PhoneIcon, TrashIcon, WhatsAppIcon } from "@/components/icons";
import { getBooking, listAssignableTeam } from "@/lib/bookings/queries";
import { BALANCE_STATE_LABEL, BOOKING_TYPE_LABEL, bookingDetails, DEPOSIT_STATE_LABEL, formatQr, nextActionFor } from "@/lib/bookings/state";
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
import { PaymentBadge } from "../PaymentBadge";
import { ShootCompleteButton } from "../ShootCompleteButton";
import { BookingTimeline } from "./BookingTimeline";
import { ContractPanel } from "./ContractPanel";
import { DeliverGalleryButton } from "./DeliverGalleryButton";
import { PaymentCard } from "./PaymentCard";
import { QuoteFromPricing } from "./QuoteFromPricing";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/bookings/[id]">): Promise<Metadata> {
  const { id } = await params;
  const detail = isUuid(id) ? await getBooking(id) : null;
  return { title: detail ? `${detail.booking.public_ref ?? "Booking"}: ${detail.booking.customer_name}` : "Booking" };
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

const CONTRACT_WORDS: Record<string, string> = { not_required: "Not required", required: "Not sent yet", sent: "Sent, waiting for signature", signed: "Signed", declined: "Declined", void: "Voided" };

export default async function BookingDetailPage({ params }: PageProps<"/bookings/[id]">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const detail = await getBooking(id);
  if (!detail) notFound();
  const { booking, client, organization, service, event, payment, audit, linkedAthlete, gallery, documents, paymentRequests } = detail;
  const [team, athletes] = await Promise.all([listAssignableTeam(booking.event_id), booking.event_id ? listAthletes(booking.event_id) : Promise.resolve([])]);
  const d = bookingDetails(booking);
  const phone = client?.phone ?? booking.customer_phone;
  const email = client?.email ?? booking.customer_email;
  const wa = whatsappDigits(client?.whatsapp ?? phone);
  const paymentsEnabled = isPaymentsEnabled();
  const next = nextActionFor(booking, paymentRequests);
  const cancelled = booking.booking_status === "cancelled";
  const preConfirmation = ["inquiry", "quoted", "awaiting_contract", "awaiting_payment"].includes(booking.booking_status);
  const confirmed = !preConfirmation && !cancelled;
  const balanceNote = booking.balance_state === "not_due" && Number(booking.balance_qr) > 0 && !cancelled ? "Final balance is not due until delivery." : null;
  const galleryDelivered = Boolean(booking.gallery_delivered_at) || gallery?.status === "delivered";

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
              <h2 id="actions-h" className="eyebrow">Status and next action</h2>
              <p className="mt-2 text-lg font-extrabold text-ink">{next.text}</p>
              {(next.blockers.length > 0 || balanceNote) && !cancelled && (
                <ul className="mt-2 space-y-1" aria-label="Blockers">
                  {next.blockers.map((b) => (
                    <li key={b.code} className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-ink"><AlertIcon size={16} className="mt-0.5 shrink-0 text-warning" /> {b.message}</li>
                  ))}
                  {balanceNote && <li className="flex items-start gap-2 rounded-lg border border-line bg-page px-3 py-2 text-sm text-muted">{balanceNote}</li>}
                </ul>
              )}
              <dl className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                <div className="rounded-lg bg-page px-3 py-2"><dt className="text-muted">Agreement</dt><dd className="font-semibold text-ink">{CONTRACT_WORDS[booking.contract_state] ?? booking.contract_state}</dd></div>
                <div className="rounded-lg bg-page px-3 py-2"><dt className="text-muted">Deposit</dt><dd className="font-semibold text-ink">{DEPOSIT_STATE_LABEL[booking.deposit_state]}{booking.deposit_state === "pending" ? ` · ${formatQr(booking.deposit_qr)}` : ""}</dd></div>
                <div className="rounded-lg bg-page px-3 py-2"><dt className="text-muted">Balance</dt><dd className="font-semibold text-ink">{BALANCE_STATE_LABEL[booking.balance_state]}{booking.balance_state === "due" ? ` · ${formatQr(booking.balance_qr)}` : ""}</dd></div>
                <div className="rounded-lg bg-page px-3 py-2"><dt className="text-muted">Delivery</dt><dd className="font-semibold text-ink">{galleryDelivered ? "Delivered" : gallery ? GALLERY_STATUS_LABEL[gallery.status] : booking.coverage_done_at ? "Editing" : "Not yet"}</dd></div>
              </dl>
              <div className="mt-3"><BookingActions bookingId={id} status={booking.booking_status} confirmBlocked={next.blockers.length ? next.blockers[0].message : null} priced={Number(booking.amount_qr) > 0} /></div>
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
                {!email && <Row label="Note" value={<span className="text-warning">No e-mail on file: confirmations and payment links cannot be e-mailed.</span>} />}
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
                <Row label="Minor" value={booking.subject_is_minor ? "Yes, guardian release required" : null} />
                <Row label="Bracket URL" value={d.source_url ? <a href={d.source_url} target="_blank" rel="noopener noreferrer" className="break-all text-primary hover:underline">{d.source_url}</a> : null} />
                <Row label="Notes" value={booking.notes} />
              </dl>
            </section>

            <section className="card p-4" aria-labelledby="when-h">
              <h2 id="when-h" className="eyebrow">When &amp; where</h2>
              <dl className="mt-2 divide-y divide-line">
                <Row label="Session" value={booking.session_at ? `${formatDateTime(booking.session_at)} ${zoneLabel()}${booking.session_end_at ? ` to ${formatDateTime(booking.session_end_at)}` : ""}` : <span className="text-muted">Not set</span>} />
                <Row label="Location" value={booking.location ?? <span className="text-muted">Not set</span>} />
                <Row label="Event" value={event ? <Link href={`/events/${event.id}`} className="font-semibold text-primary hover:underline">{event.name}{event.event_date ? ` · ${formatEventDate(event.event_date, "short")}` : ""}</Link> : null} />
                <Row label="Competition" value={d.competition_date ? formatEventDate(d.competition_date, "short") : null} />
              </dl>
              <div className="mt-3 border-t border-line pt-3">
                <p className="mb-2 text-xs font-semibold text-muted">Who shoots it</p>
                <CoverageAssign bookingId={id} photographerId={booking.assigned_photographer_id} videographerId={booking.assigned_videographer_id} team={team} />
              </div>
            </section>

            <ContractPanel booking={booking} documents={documents} />

            <section className="card p-4" aria-labelledby="pay-h">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id="pay-h" className="eyebrow">Payment</h2>
                <PaymentBadge payment={payment} amountQr={booking.amount_qr} detailed />
              </div>
              <p className="mb-3 mt-1 text-xs text-muted">50% deposit once the agreement is signed, before the booking is confirmed. The remaining 50% becomes due when you deliver the gallery. Links are created and sent only by you.</p>
              <PaymentCard detail={detail} paymentsEnabled={paymentsEnabled} />
              <QuoteFromPricing bookingId={booking.id} />
            </section>

            <section className="card p-4" aria-labelledby="delivery-h">
              <h2 id="delivery-h" className="eyebrow">Shoot, editing and delivery</h2>
              <dl className="mt-2 divide-y divide-line">
                <Row label="Shoot" value={booking.coverage_done_at ? `Done ${formatStamp(booking.coverage_done_at)}` : confirmed ? "Not marked complete yet" : "After confirmation"} />
                <Row label="Gallery" value={gallery ? <Link href={`/galleries/${gallery.id}`} className="font-semibold text-primary hover:underline">{gallery.name}</Link> : "No gallery linked yet"} />
                <Row label="Gallery state" value={gallery ? `${GALLERY_STATUS_LABEL[gallery.status]}${gallery.ready_at ? ` · ready ${formatStamp(gallery.ready_at)}` : ""}` : null} />
                <Row label="Delivered" value={booking.gallery_delivered_at ? formatStamp(booking.gallery_delivered_at) : booking.delivered_at ? formatStamp(booking.delivered_at) : null} />
              </dl>
              <div className="mt-3 space-y-3">
                {!booking.coverage_done_at && !cancelled && <ShootCompleteButton bookingId={id} label={`${booking.customer_name}${booking.athlete_name && booking.athlete_name !== booking.customer_name ? ` (${booking.athlete_name})` : ""}`} disabledReason={!confirmed ? "Confirm the booking first (agreement signed and deposit paid)." : null} />}
                {!gallery && !cancelled && <Link href={`/galleries/new?booking=${id}`} className="btn-secondary min-h-11"><ImageIcon size={16} /> Add gallery link</Link>}
                {gallery && !galleryDelivered && !cancelled && (
                  <DeliverGalleryButton galleryId={gallery.id} galleryName={gallery.name} balanceQr={booking.balance_state === "not_due" ? Number(booking.balance_qr) || 0 : 0} hasEmail={Boolean(email)} disabledReason={!gallery.pictime_url ? "Add the gallery link (open the gallery, Edit) before delivering." : !confirmed ? "Confirm the booking before delivering the gallery." : null} />
                )}
                {gallery && galleryDelivered && <p className="text-sm text-success">Gallery delivered{booking.gallery_delivered_at ? ` on ${formatStamp(booking.gallery_delivered_at)}` : ""}.</p>}
              </div>
            </section>
          </div>

          <div className="space-y-4">
            <section className="card p-4" aria-labelledby="time-h">
              <h2 id="time-h" className="eyebrow">Timeline</h2>
              <div className="mt-2"><BookingTimeline detail={detail} /></div>
            </section>

            <section className="card p-4" aria-labelledby="tour-h">
              <h2 id="tour-h" className="eyebrow">Tournament link</h2>
              <div className="mt-2">
                <AthleteLink bookingId={id} eventId={booking.event_id} eventName={event?.name ?? null} athletes={athletes.map((a) => ({ id: a.id, name: a.name }))} linked={linkedAthlete} />
              </div>
            </section>

            <section className="card p-4" aria-labelledby="log-h">
              <h2 id="log-h" className="eyebrow">Activity</h2>
              {audit.length === 0 ? (
                <p className="mt-1 text-sm text-muted">Nothing recorded yet.</p>
              ) : (
                <ol className="mt-2 space-y-2 text-sm">
                  {audit.slice(0, 30).map((row) => {
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
            </section>
            <p className="flex items-center gap-1.5 px-1 text-[11px] text-muted"><TrashIcon size={12} /> Bookings are never deleted; cancel them instead so the history stays intact.</p>
          </div>
        </div>
      </PageBody>
    </>
  );
}
