import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BrandHeader } from "@/components/BrandHeader";
import { PageBody } from "@/components/AppShell";
import { EditIcon, MailIcon, PhoneIcon, PlusIcon, WhatsAppIcon } from "@/components/icons";
import { listBookingsForPerson } from "@/lib/bookings/queries";
import { BOOKING_TYPE_LABEL, formatQr } from "@/lib/bookings/state";
import { DOCUMENT_STATUS_LABEL } from "@/lib/documents/state";
import { GALLERY_STATUS_LABEL } from "@/lib/galleries/state";
import { PERSON_KIND_LABEL, whatsappDigits } from "@/lib/people/form";
import { getPerson } from "@/lib/people/queries";
import { formatDateTime, formatStamp } from "@/lib/time";
import { initials } from "@/lib/utils";
import { isUuid } from "@/lib/validation";
import { BookingStatusBadge } from "../../bookings/BookingStatusBadge";
import { PaymentBadge } from "../../bookings/PaymentBadge";
import { DeletePersonButton } from "./DeletePersonButton";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/people/[id]">): Promise<Metadata> {
  const { id } = await params;
  const detail = isUuid(id) ? await getPerson(id) : null;
  return { title: detail?.person.full_name ?? "Client" };
}

export default async function PersonPage({ params }: PageProps<"/people/[id]">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const detail = await getPerson(id);
  if (!detail) notFound();
  const { person, organizations, galleries, documents } = detail;
  const bookings = await listBookingsForPerson(id);
  const wa = whatsappDigits(person.whatsapp ?? person.phone);

  return (
    <>
      <BrandHeader title={person.full_name} subtitle={PERSON_KIND_LABEL[person.kind]} backHref="/people" actions={<Link href={`/people/${id}/edit`} className="btn-secondary min-h-10"><EditIcon size={16} /> Edit</Link>} />
      <PageBody className="max-w-4xl">
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-4">
            <section className="card p-4" aria-label="Contact">
              <div className="flex items-center gap-3">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-lightblue text-base font-extrabold text-primary">{initials(person.full_name)}</span>
                <div className="min-w-0">
                  <h2 className="truncate text-lg font-extrabold text-ink">{person.full_name}</h2>
                  <p className="text-xs text-muted">{PERSON_KIND_LABEL[person.kind]} · since {formatStamp(person.created_at)}</p>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2">
                {person.phone ? <a href={`tel:${person.phone}`} className="btn-secondary min-h-11"><PhoneIcon size={16} /> Call</a> : <span className="btn-secondary min-h-11 opacity-50">No phone</span>}
                {wa ? <a href={`https://wa.me/${wa}`} target="_blank" rel="noopener noreferrer" className="btn-secondary min-h-11"><WhatsAppIcon size={16} /> WhatsApp</a> : <span className="btn-secondary min-h-11 opacity-50">No WhatsApp</span>}
                {person.email ? <a href={`mailto:${person.email}`} className="btn-secondary min-h-11"><MailIcon size={16} /> Email</a> : <span className="btn-secondary min-h-11 opacity-50">No e-mail</span>}
              </div>
              <dl className="mt-4 space-y-1.5 text-sm">
                {person.phone && <div className="flex gap-3"><dt className="w-20 shrink-0 text-muted">Phone</dt><dd className="text-ink">{person.phone}</dd></div>}
                {person.email && <div className="flex gap-3"><dt className="w-20 shrink-0 text-muted">Email</dt><dd className="break-all text-ink">{person.email}</dd></div>}
                {person.instagram && <div className="flex gap-3"><dt className="w-20 shrink-0 text-muted">Instagram</dt><dd className="text-ink">@{person.instagram}</dd></div>}
                {person.tags.length > 0 && <div className="flex gap-3"><dt className="w-20 shrink-0 text-muted">Tags</dt><dd className="flex flex-wrap gap-1">{person.tags.map((t) => <span key={t} className="rounded-full bg-page px-2 py-0.5 text-[11px] font-semibold text-muted">{t}</span>)}</dd></div>}
                {person.user_id && <div className="flex gap-3"><dt className="w-20 shrink-0 text-muted">Portal</dt><dd className="text-success">Has signed in to the client portal</dd></div>}
                {person.notes && <div className="flex gap-3"><dt className="w-20 shrink-0 text-muted">Notes</dt><dd className="whitespace-pre-wrap text-ink">{person.notes}</dd></div>}
              </dl>
              {organizations.length > 0 && (
                <p className="mt-3 text-xs text-muted">Primary contact for {organizations.map((o, i) => <span key={o.id}>{i > 0 ? ", " : ""}<Link href={`/clubs/${o.id}`} className="font-semibold text-primary hover:underline">{o.name}</Link></span>)}.</p>
              )}
            </section>
            <section className="card p-4">
              <p className="eyebrow">Danger zone</p>
              <div className="mt-2"><DeletePersonButton personId={id} name={person.full_name} bookingCount={bookings.length} /></div>
            </section>
          </div>

          <div className="space-y-4 lg:col-span-2">
            <section className="card p-4" aria-labelledby="bk-h">
              <div className="flex items-center justify-between gap-2">
                <h2 id="bk-h" className="eyebrow">Bookings</h2>
                <Link href={`/bookings/new?client=${id}`} className="btn-secondary min-h-9 text-xs"><PlusIcon size={14} /> New booking</Link>
              </div>
              {bookings.length === 0 ? (
                <p className="mt-2 text-sm text-muted">No bookings yet.</p>
              ) : (
                <ul className="mt-2 divide-y divide-line">
                  {bookings.map((b) => (
                    <li key={b.id}>
                      <Link href={`/bookings/${b.id}`} className="flex items-center gap-3 py-2.5 hover:bg-page">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-bold text-ink"><span className="font-mono">{b.public_ref ?? "—"}</span> · {BOOKING_TYPE_LABEL[b.booking_type]}</p>
                          <p className="truncate text-xs text-muted">{b.event?.name ?? b.package_name}{b.session_at ? ` · ${formatDateTime(b.session_at)}` : ""}</p>
                          <div className="mt-1 flex flex-wrap gap-1"><BookingStatusBadge status={b.booking_status} size="sm" /><PaymentBadge payment={b.payment} amountQr={b.amount_qr} size="sm" /></div>
                        </div>
                        <p className="shrink-0 text-sm font-black tabular-nums text-ink">{formatQr(b.amount_qr)}</p>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className="card p-4" aria-labelledby="gal-h">
              <h2 id="gal-h" className="eyebrow">Galleries</h2>
              {galleries.length === 0 ? <p className="mt-2 text-sm text-muted">No galleries yet.</p> : (
                <ul className="mt-2 divide-y divide-line text-sm">
                  {galleries.map((g) => <li key={g.id}><Link href={`/galleries/${g.id}`} className="flex justify-between gap-2 py-2 hover:bg-page"><span className="truncate font-semibold text-ink">{g.name}</span><span className="shrink-0 text-xs text-muted">{GALLERY_STATUS_LABEL[g.status]}</span></Link></li>)}
                </ul>
              )}
            </section>
            <section className="card p-4" aria-labelledby="doc-h">
              <h2 id="doc-h" className="eyebrow">Agreements</h2>
              {documents.length === 0 ? <p className="mt-2 text-sm text-muted">No agreements yet.</p> : (
                <ul className="mt-2 divide-y divide-line text-sm">
                  {documents.map((doc) => <li key={doc.id}><Link href={`/documents/${doc.id}`} className="flex justify-between gap-2 py-2 hover:bg-page"><span className="truncate font-semibold text-ink">{doc.title}</span><span className="shrink-0 text-xs text-muted">{DOCUMENT_STATUS_LABEL[doc.status]}</span></Link></li>)}
                </ul>
              )}
            </section>
          </div>
        </div>
      </PageBody>
    </>
  );
}
