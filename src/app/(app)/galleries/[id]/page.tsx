import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BrandHeader } from "@/components/BrandHeader";
import { PageBody } from "@/components/AppShell";
import { BOOKING_STATUS_LABEL } from "@/lib/bookings/state";
import { getGallery } from "@/lib/galleries/queries";
import { isEmailEnabled } from "@/lib/notifications/email/config";
import { isClientKindEnabled } from "@/lib/notifications/email/outbox";
import { createClient } from "@/lib/supabase/server";
import { formatStamp } from "@/lib/time";
import { isUuid } from "@/lib/validation";
import { GalleryStatusBadge } from "../GalleryStatusBadge";
import { GalleryActions } from "./GalleryActions";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/galleries/[id]">): Promise<Metadata> {
  const { id } = await params;
  const detail = isUuid(id) ? await getGallery(id) : null;
  return { title: detail ? `Gallery: ${detail.gallery.name}` : "Gallery" };
}

export default async function GalleryDetailPage({ params }: PageProps<"/galleries/[id]">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const detail = await getGallery(id);
  if (!detail) notFound();
  const { gallery, client, booking, eventName } = detail;
  const supabase = await createClient();
  const galleryReadyPrefOn = await isClientKindEnabled(supabase, gallery.owner_id, "GALLERY_READY");
  const clientEmail = client?.email ?? booking?.customer_email ?? null;
  const now = new Date();

  return (
    <>
      <BrandHeader title={gallery.name} subtitle={client?.full_name ?? booking?.athlete_name ?? "Gallery"} backHref="/galleries" />
      <PageBody className="max-w-2xl space-y-4">
        <section className="card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="eyebrow">Status</p>
            <GalleryStatusBadge status={gallery.status} />
          </div>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-muted">Client</dt>
            <dd className="text-ink">{client ? client.full_name : booking ? booking.customer_name : "—"}{clientEmail ? <span className="block text-xs text-muted">{clientEmail}</span> : <span className="block text-xs text-muted">No e-mail on file</span>}</dd>
            <dt className="text-muted">Booking</dt>
            <dd className="text-ink">{booking ? <Link href={`/bookings/${booking.id}`} className="font-semibold text-primary underline-offset-2 hover:underline">{booking.public_ref ?? booking.athlete_name}</Link> : "—"}{booking ? <span className="block text-xs text-muted">{booking.athlete_name} · {BOOKING_STATUS_LABEL[booking.booking_status]}</span> : null}</dd>
            {eventName && <><dt className="text-muted">Event</dt><dd className="text-ink">{eventName}</dd></>}
            <dt className="text-muted">Pic-Time link</dt>
            <dd className="break-all text-ink">{gallery.pictime_url ? <a href={gallery.pictime_url} target="_blank" rel="noreferrer noopener" className="font-semibold text-primary underline-offset-2 hover:underline">{gallery.pictime_url}</a> : "Not linked yet"}</dd>
            {gallery.pictime_project_id && <><dt className="text-muted">Project id</dt><dd className="font-mono text-xs text-ink">{gallery.pictime_project_id}</dd></>}
            <dt className="text-muted">Visits</dt>
            <dd className="text-ink">{gallery.visitor_count}{gallery.last_visitor_at ? <span className="text-xs text-muted"> · last {formatStamp(gallery.last_visitor_at, undefined, now)}</span> : null}</dd>
          </dl>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 border-t border-line pt-3 text-xs text-muted sm:grid-cols-4">
            <div><dt>Created in Pic-Time</dt><dd className="text-ink">{gallery.created_in_pictime_at ? formatStamp(gallery.created_in_pictime_at, undefined, now) : "—"}</dd></div>
            <div><dt>Ready</dt><dd className="text-ink">{gallery.ready_at ? formatStamp(gallery.ready_at, undefined, now) : "—"}</dd></div>
            <div><dt>Client e-mailed</dt><dd className="text-ink">{gallery.notified_at ? formatStamp(gallery.notified_at, undefined, now) : "Not yet"}</dd></div>
            <div><dt>Delivered</dt><dd className="text-ink">{gallery.delivered_at ? formatStamp(gallery.delivered_at, undefined, now) : "—"}</dd></div>
          </dl>
          {gallery.notes && <p className="mt-3 whitespace-pre-wrap rounded-xl bg-page px-3 py-2 text-sm text-ink">{gallery.notes}</p>}
        </section>

        <GalleryActions id={gallery.id} name={gallery.name} status={gallery.status} pictimeUrl={gallery.pictime_url} clientEmail={clientEmail} emailEnabled={isEmailEnabled()} galleryReadyPrefOn={galleryReadyPrefOn} />
      </PageBody>
    </>
  );
}
