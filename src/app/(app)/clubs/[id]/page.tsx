import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BrandHeader } from "@/components/BrandHeader";
import { PageBody } from "@/components/AppShell";
import { EditIcon, MailIcon, PhoneIcon, PlusIcon } from "@/components/icons";
import { listBookingsForOrganization } from "@/lib/bookings/queries";
import { BOOKING_TYPE_LABEL, formatQr } from "@/lib/bookings/state";
import { ORGANIZATION_KIND_LABEL } from "@/lib/organizations/form";
import { getOrganization } from "@/lib/organizations/queries";
import { PERSON_KIND_LABEL } from "@/lib/people/form";
import { formatDateTime } from "@/lib/time";
import { isUuid } from "@/lib/validation";
import { BookingStatusBadge } from "../../bookings/BookingStatusBadge";
import { PaymentBadge } from "../../bookings/PaymentBadge";
import { DeleteOrganizationButton } from "./DeleteOrganizationButton";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/clubs/[id]">): Promise<Metadata> {
  const { id } = await params;
  const detail = isUuid(id) ? await getOrganization(id) : null;
  return { title: detail?.organization.name ?? "Club" };
}

export default async function ClubPage({ params }: PageProps<"/clubs/[id]">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const detail = await getOrganization(id);
  if (!detail) notFound();
  const { organization, primaryContact, contacts } = detail;
  const bookings = await listBookingsForOrganization(id);

  return (
    <>
      <BrandHeader title={organization.name} subtitle={ORGANIZATION_KIND_LABEL[organization.kind]} backHref="/clubs" actions={<Link href={`/clubs/${id}/edit`} className="btn-secondary min-h-10"><EditIcon size={16} /> Edit</Link>} />
      <PageBody className="max-w-4xl">
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-4">
            <section className="card p-4" aria-label="Club">
              <h2 className="text-lg font-extrabold text-ink">{organization.name}</h2>
              <p className="text-xs text-muted">{ORGANIZATION_KIND_LABEL[organization.kind]}</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {organization.phone && <a href={`tel:${organization.phone}`} className="btn-secondary min-h-11"><PhoneIcon size={16} /> Call</a>}
                {organization.email && <a href={`mailto:${organization.email}`} className="btn-secondary min-h-11"><MailIcon size={16} /> Email</a>}
              </div>
              <dl className="mt-3 space-y-1.5 text-sm">
                {organization.phone && <div className="flex gap-3"><dt className="w-20 shrink-0 text-muted">Phone</dt><dd className="text-ink">{organization.phone}</dd></div>}
                {organization.email && <div className="flex gap-3"><dt className="w-20 shrink-0 text-muted">Email</dt><dd className="break-all text-ink">{organization.email}</dd></div>}
                {organization.instagram && <div className="flex gap-3"><dt className="w-20 shrink-0 text-muted">Instagram</dt><dd className="text-ink">@{organization.instagram}</dd></div>}
                {primaryContact && <div className="flex gap-3"><dt className="w-20 shrink-0 text-muted">Contact</dt><dd><Link href={`/people/${primaryContact.id}`} className="font-semibold text-primary hover:underline">{primaryContact.full_name}</Link></dd></div>}
                {organization.notes && <div className="flex gap-3"><dt className="w-20 shrink-0 text-muted">Notes</dt><dd className="whitespace-pre-wrap text-ink">{organization.notes}</dd></div>}
              </dl>
            </section>
            <section className="card p-4" aria-labelledby="contacts-h">
              <h2 id="contacts-h" className="eyebrow">Contacts</h2>
              {contacts.length === 0 ? <p className="mt-2 text-sm text-muted">No contacts yet — set a primary contact or add a club booking.</p> : (
                <ul className="mt-2 divide-y divide-line text-sm">
                  {contacts.map((p) => (
                    <li key={p.id}><Link href={`/people/${p.id}`} className="flex items-center justify-between gap-2 py-2 hover:bg-page"><span className="truncate font-semibold text-ink">{p.full_name}</span><span className="shrink-0 text-xs text-muted">{p.id === organization.primary_contact_id ? "Primary" : PERSON_KIND_LABEL[p.kind]}</span></Link></li>
                  ))}
                </ul>
              )}
            </section>
            <section className="card p-4">
              <p className="eyebrow">Danger zone</p>
              <div className="mt-2"><DeleteOrganizationButton organizationId={id} name={organization.name} bookingCount={bookings.length} /></div>
            </section>
          </div>
          <section className="card p-4 lg:col-span-2" aria-labelledby="bk-h">
            <div className="flex items-center justify-between gap-2">
              <h2 id="bk-h" className="eyebrow">Bookings</h2>
              <Link href="/bookings/new" className="btn-secondary min-h-9 text-xs"><PlusIcon size={14} /> New booking</Link>
            </div>
            {bookings.length === 0 ? <p className="mt-2 text-sm text-muted">No bookings for this club yet.</p> : (
              <ul className="mt-2 divide-y divide-line">
                {bookings.map((b) => (
                  <li key={b.id}>
                    <Link href={`/bookings/${b.id}`} className="flex items-center gap-3 py-2.5 hover:bg-page">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-bold text-ink">{b.client?.full_name ?? b.customer_name} <span className="font-mono font-normal text-muted">· {b.public_ref ?? "—"}</span></p>
                        <p className="truncate text-xs text-muted">{BOOKING_TYPE_LABEL[b.booking_type]}{b.event ? ` · ${b.event.name}` : ""}{b.session_at ? ` · ${formatDateTime(b.session_at)}` : ""}</p>
                        <div className="mt-1 flex flex-wrap gap-1"><BookingStatusBadge status={b.booking_status} size="sm" /><PaymentBadge payment={b.payment} amountQr={b.amount_qr} size="sm" /></div>
                      </div>
                      <p className="shrink-0 text-sm font-black tabular-nums text-ink">{formatQr(b.amount_qr)}</p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </PageBody>
    </>
  );
}
