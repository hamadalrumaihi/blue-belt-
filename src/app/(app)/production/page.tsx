import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BrandHeader } from "@/components/BrandHeader";
import { PageBody } from "@/components/AppShell";
import { EmptyState } from "@/components/EmptyState";
import { CameraIcon } from "@/components/icons";
import { groupByStage, PRODUCTION_STAGE_HINT, PRODUCTION_STAGE_LABEL, PRODUCTION_STAGES, settableStages, type StoredStage } from "@/lib/bookings/production";
import { listBookings } from "@/lib/bookings/queries";
import { formatQr } from "@/lib/bookings/state";
import { resolveViewerMode } from "@/lib/collaborator";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime, formatStamp } from "@/lib/time";
import { cn } from "@/lib/utils";
import { StageControl } from "./StageControl";

export const metadata: Metadata = { title: "Production board" };
export const dynamic = "force-dynamic";

/**
 * Kanban of every booking between the shoot and the follow-up. Columns are
 * derived from existing columns (see src/lib/bookings/production.ts); only
 * culling / editing / review are set here, everything else moves from the
 * booking page (shoot complete, gallery ready, deliver).
 */
export default async function ProductionPage() {
  if ((await resolveViewerMode()).collaboratorOnly) redirect("/coverage");
  const supabase = await createClient();
  const [bookings, galleries] = await Promise.all([
    listBookings({ filter: "all", limit: 400 }),
    supabase.from("photo_galleries").select("id,booking_id,status,pictime_url,name").not("booking_id", "is", null).limit(500),
  ]);
  const galleryByBooking = new Map<string, { id: string; status: "pending" | "created" | "ready" | "delivered"; pictime_url: string | null; name: string }>();
  for (const g of galleries.data ?? []) if (g.booking_id && !galleryByBooking.has(g.booking_id)) galleryByBooking.set(g.booking_id, g);
  const rows = bookings.map((booking) => ({ booking, gallery: galleryByBooking.get(booking.id) ?? null }));
  const board = groupByStage(rows);
  const total = PRODUCTION_STAGES.reduce((s, k) => s + board[k].length, 0);
  const now = new Date();

  return (
    <>
      <BrandHeader title="Production board" subtitle="Shoot complete → culling → editing → review → ready → delivered → follow-up" actions={<Link href="/bookings?filter=confirmed" className="btn-secondary min-h-10">Schedule</Link>} />
      <PageBody className="max-w-none space-y-3">
        <p className="text-xs text-muted">Stages come from the booking itself: the shoot you marked complete, the gallery&rsquo;s Pic-Time status, the delivery and the final balance. Only culling, editing and review are set here. Nothing is duplicated; the booking page stays the source of truth.</p>
        {total === 0 ? (
          <EmptyState icon={<CameraIcon />} title="Nothing in production" description="A booking appears here once you mark its shoot complete. Confirmed shoots waiting for their day are on the schedule." action={<Link href="/bookings?filter=confirmed" className="btn-primary min-h-10">Open schedule</Link>} />
        ) : (
          <div className="-mx-4 overflow-x-auto px-4 pb-2 lg:-mx-8 lg:px-8">
            <div className="grid min-w-[1400px] grid-cols-7 gap-3">
              {PRODUCTION_STAGES.map((stage) => (
                <section key={stage} className="flex min-h-40 flex-col rounded-2xl bg-page/70 p-2" aria-labelledby={`col-${stage}`}>
                  <div className="px-1 pb-2">
                    <h2 id={`col-${stage}`} className="flex items-center justify-between text-xs font-extrabold uppercase tracking-wide text-ink">
                      {PRODUCTION_STAGE_LABEL[stage]}
                      <span className="rounded-full bg-white px-2 py-0.5 text-[10px] tabular-nums text-muted">{board[stage].length}</span>
                    </h2>
                    <p className="mt-0.5 text-[10px] leading-snug text-muted">{PRODUCTION_STAGE_HINT[stage]}</p>
                  </div>
                  <ul className="space-y-2">
                    {board[stage].map(({ row, derived }) => {
                      const b = row.booking;
                      const options: StoredStage[] = settableStages(derived);
                      return (
                        <li key={b.id} className={cn("card p-3", stage === "followup" && "border-warning/40")}>
                          <Link href={`/bookings/${b.id}`} className="block">
                            <p className="truncate text-sm font-bold text-ink">{b.client?.full_name ?? b.customer_name}</p>
                            <p className="truncate text-[11px] text-muted">{b.public_ref ?? ""}{b.public_ref ? " · " : ""}{b.package_name}</p>
                            <p className="truncate text-[11px] text-muted">{b.session_at ? `Shot ${formatDateTime(b.session_at)}` : "No session date"}{derived.since ? ` · here since ${formatStamp(derived.since, undefined, now)}` : ""}</p>
                            {row.gallery && <p className="truncate text-[11px] text-muted">Gallery: {row.gallery.name}{row.gallery.pictime_url ? "" : " (no link yet)"}</p>}
                            {stage === "followup" && <p className="mt-1 text-[11px] font-semibold text-warning">Balance due: {formatQr(b.balance_qr)}</p>}
                          </Link>
                          {options.length > 0 ? (
                            <StageControl bookingId={b.id} current={derived.source === "stored" ? (derived.stage as StoredStage) : "shoot_complete"} options={options} />
                          ) : (
                            <Link href={`/bookings/${b.id}#delivery`} className="mt-2 inline-block text-[11px] font-semibold text-primary hover:underline">{stage === "ready" ? "Deliver from the booking" : stage === "followup" ? "Chase balance on the booking" : "Complete on the booking"}</Link>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
          </div>
        )}
      </PageBody>
    </>
  );
}
