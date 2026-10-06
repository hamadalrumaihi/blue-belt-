import type { Metadata } from "next";
import Link from "next/link";
import { BrandHeader } from "@/components/BrandHeader";
import { PageBody } from "@/components/AppShell";
import { EmptyState } from "@/components/EmptyState";
import { CameraIcon, EditIcon, PlusIcon, ReceiptIcon, VideoIcon } from "@/components/icons";
import { BOOKING_TYPES, BOOKING_TYPE_LABEL, formatQr } from "@/lib/bookings/state";
import { listServices } from "@/lib/studio/queries";
import { cn } from "@/lib/utils";
import { SeedServicesButton, ServiceRowActions } from "./ServiceActions";

export const metadata: Metadata = { title: "Services & packages" };
export const dynamic = "force-dynamic";

export default async function PackagesPage() {
  const services = await listServices();
  const groups = BOOKING_TYPES.map((t) => ({ type: t, items: services.filter((s) => s.booking_type === t) })).filter((g) => g.items.length);
  return (
    <>
      <BrandHeader title="Services & packages" subtitle="What the website offers and at what price. Empty price = quote on request." actions={<Link href="/packages/new" className="btn-primary min-h-10"><PlusIcon size={18} /> New</Link>} />
      <PageBody>
        {services.length === 0 ? (
          <EmptyState
            icon={<ReceiptIcon />}
            title="No packages yet"
            description="Start from a sensible set (tournament photo, photo + video, club day, training and private sessions, custom) and set your prices, or add one by hand."
            action={<div className="flex flex-col gap-2 sm:flex-row"><SeedServicesButton /><Link href="/packages/new" className="btn-secondary">Add a package</Link></div>}
          />
        ) : (
          <div className="space-y-8">
            {groups.map((g) => (
              <section key={g.type} aria-labelledby={`pk-${g.type}`}>
                <h2 id={`pk-${g.type}`} className="eyebrow mb-3">{BOOKING_TYPE_LABEL[g.type]}</h2>
                <ul className="grid gap-3 md:grid-cols-2">
                  {g.items.map((s) => (
                    <li key={s.id} className={cn("card p-4", !s.active && "opacity-70")}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-base font-extrabold text-ink">{s.name}</p>
                          <p className="mt-0.5 font-mono text-xs text-muted">{s.code}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1 text-muted">
                          {s.includes_photo && <CameraIcon size={16} aria-label="Photo" />}
                          {s.includes_video && <VideoIcon size={16} aria-label="Video" />}
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                        {s.price_qr === null ? (
                          <span className="rounded-md bg-warning-soft px-2 py-0.5 font-bold uppercase tracking-wider text-warning">Set your price · quote</span>
                        ) : (
                          <span className="rounded-md bg-lightblue px-2 py-0.5 font-bold text-primary">{formatQr(Number(s.price_qr))}</span>
                        )}
                        {s.deposit_qr !== null && <span className="text-muted">Deposit {formatQr(Number(s.deposit_qr))}</span>}
                        {s.duration_minutes && <span className="text-muted">{s.duration_minutes} min</span>}
                        {!s.active && <span className="rounded-md bg-page px-2 py-0.5 font-bold uppercase tracking-wider text-muted">Archived</span>}
                        {s.active && !s.public && <span className="rounded-md bg-page px-2 py-0.5 font-bold uppercase tracking-wider text-muted">Hidden from website</span>}
                      </div>
                      {s.description && <p className="mt-2 line-clamp-2 text-sm text-muted">{s.description}</p>}
                      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                        <Link href={`/packages/${s.id}/edit`} className="btn-secondary min-h-10"><EditIcon size={16} /> Edit</Link>
                        <ServiceRowActions id={s.id} name={s.name} active={s.active} />
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </PageBody>
    </>
  );
}
