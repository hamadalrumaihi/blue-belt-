import type { Metadata } from "next";
import Link from "next/link";
import { BrandHeader } from "@/components/BrandHeader";
import { PageBody } from "@/components/AppShell";
import { EmptyState } from "@/components/EmptyState";
import { ExternalIcon, ImageIcon, PlusIcon } from "@/components/icons";
import { galleryCounts, listGalleries } from "@/lib/galleries/queries";
import type { GalleryStatus } from "@/lib/supabase/database.types";
import { formatStamp } from "@/lib/time";
import { cn } from "@/lib/utils";
import { GalleryStatusBadge } from "./GalleryStatusBadge";

export const metadata: Metadata = { title: "Galleries" };
export const dynamic = "force-dynamic";

type Filter = "ready" | "pending" | "delivered" | "all";
const FILTERS: Array<{ key: Filter; label: string; status: GalleryStatus | null }> = [
  { key: "all", label: "All", status: null },
  { key: "ready", label: "Awaiting delivery", status: "ready" },
  { key: "pending", label: "Not created", status: "pending" },
  { key: "delivered", label: "Delivered", status: "delivered" },
];

/**
 * Owner list of Pic-Time galleries: where each one is, who it is for and
 * whether the client has been told. Pic-Time hosts the photos; this is the
 * studio's record.
 */
export default async function GalleriesPage({ searchParams }: PageProps<"/galleries">) {
  const params = await searchParams;
  const filter = FILTERS.find((f) => f.key === params.filter) ?? FILTERS[0];
  const now = new Date();
  const [galleries, counts] = await Promise.all([listGalleries({ status: filter.status }), galleryCounts()]);
  const subtitle = counts.ready ? `${counts.ready} ready to deliver` : `${counts.total} ${counts.total === 1 ? "gallery" : "galleries"}`;

  return (
    <>
      <BrandHeader title="Galleries" subtitle={subtitle} actions={<Link href="/galleries/new" className="btn-primary min-h-10"><PlusIcon size={18} /> Add</Link>} />
      <PageBody className="max-w-3xl">
        <div className="mb-3 flex flex-wrap gap-2">
          {FILTERS.map((f) => {
            const count = f.status ? counts[f.status] : counts.total;
            return (
              <Link key={f.key} href={f.key === "all" ? "/galleries" : `/galleries?filter=${f.key}`} aria-current={filter.key === f.key ? "page" : undefined} className={cn("inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-bold", filter.key === f.key ? "border-primary bg-lightblue text-primary" : "border-line bg-white text-muted")}>
                {f.label}
                <span className="tabular-nums opacity-70">{count}</span>
              </Link>
            );
          })}
        </div>

        {galleries.length === 0 && filter.key !== "all" && counts.total > 0 ? (
          <EmptyState compact title={`No galleries under “${filter.label}”`} description="Try another filter." action={<Link href="/galleries" className="btn-secondary">Show all galleries</Link>} />
        ) : galleries.length === 0 ? (
          <EmptyState icon={<ImageIcon />} title="No galleries yet" description="Add a gallery once it exists in Pic-Time, or let the Zapier “New gallery” trigger create it here. Mark it ready to send the client the link." action={<Link href="/galleries/new" className="btn-primary"><PlusIcon size={18} /> Add gallery</Link>} />
        ) : (
          <ul className="card divide-y divide-line">
            {galleries.map((g) => {
              const who = g.client?.full_name ?? g.booking?.athlete_name ?? g.booking?.customer_name ?? null;
              const ref = g.booking?.public_ref ?? null;
              return (
                <li key={g.id} className="flex items-center gap-2 px-3 py-3 sm:px-4">
                  <Link href={`/galleries/${g.id}`} className="flex min-h-11 min-w-0 flex-1 flex-col gap-1 rounded-lg px-1 hover:bg-page">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-extrabold text-ink">{g.name}</span>
                      <GalleryStatusBadge status={g.status} />
                    </span>
                    <span className="break-words text-xs text-muted">
                      {who ?? "No client linked"}{ref ? ` · ${ref}` : ""}
                      {" · "}{g.visitor_count} {g.visitor_count === 1 ? "visit" : "visits"}
                      {g.notified_at ? ` · client e-mailed ${formatStamp(g.notified_at, undefined, now)}` : g.ready_at ? ` · ready ${formatStamp(g.ready_at, undefined, now)}` : ""}
                    </span>
                  </Link>
                  {g.pictime_url ? (
                    <a href={g.pictime_url} target="_blank" rel="noreferrer noopener" className="btn-ghost min-h-11 shrink-0 px-2 text-xs" aria-label={`Open ${g.name} in Pic-Time`}>
                      <ExternalIcon size={16} /> <span className="hidden sm:inline">Pic-Time</span>
                    </a>
                  ) : (
                    <span className="shrink-0 text-[11px] font-semibold text-muted">No link</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </PageBody>
    </>
  );
}
