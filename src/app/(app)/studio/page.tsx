import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BrandHeader } from "@/components/BrandHeader";
import { PageBody } from "@/components/AppShell";
import { AlertIcon, BellIcon, BookmarkIcon, CalendarIcon, CreditCardIcon, FileTextIcon, ImageIcon, PlusIcon } from "@/components/icons";
import { BOOKING_TYPE_LABEL, formatQr } from "@/lib/bookings/state";
import { resolveViewerMode } from "@/lib/collaborator";
import { loadStudioDashboard } from "@/lib/studio/dashboard";
import { formatDateTime, formatStamp } from "@/lib/time";
import { cn } from "@/lib/utils";
import { BookingStatusBadge } from "../bookings/BookingStatusBadge";

export const metadata: Metadata = { title: "Studio" };
export const dynamic = "force-dynamic";

type Card = { href: string; label: string; count: number; icon: React.ComponentType<{ size?: number; className?: string }>; tone?: "warning" | "danger" };

export default async function StudioPage() {
  if ((await resolveViewerMode()).collaboratorOnly) redirect("/coverage");
  const d = await loadStudioDashboard();
  const t = d.today;
  const cards: Card[] = [
    { href: "/bookings?filter=confirmed", label: "Shoots in 7 days", count: t.upcomingShoots, icon: CalendarIcon },
    { href: "/bookings", label: "Bookings need action", count: t.needsAction, icon: BookmarkIcon, tone: t.needsAction ? "warning" : undefined },
    { href: "/payments", label: "Payments awaiting", count: t.paymentsAwaiting, icon: CreditCardIcon, tone: t.paymentsAwaiting ? "warning" : undefined },
    { href: "/documents?status=sent", label: "Contracts to sign", count: t.contractsAwaiting, icon: FileTextIcon },
    { href: "/galleries?status=ready", label: "Galleries to deliver", count: t.galleriesAwaiting, icon: ImageIcon },
    { href: "/issues", label: "Watcher issues", count: t.openIssues, icon: AlertIcon, tone: t.openIssues ? "danger" : undefined },
    { href: "/notifications", label: "Failed deliveries (24h)", count: t.failedDeliveries, icon: BellIcon, tone: t.failedDeliveries ? "danger" : undefined },
  ];

  return (
    <>
      <BrandHeader title="Studio" subtitle="What needs you today, this month's money, what is coming up" actions={<Link href="/bookings/new" className="btn-primary min-h-10"><PlusIcon size={16} /> Booking</Link>} />
      <PageBody className="max-w-5xl space-y-4">
        <section aria-labelledby="today-h">
          <h2 id="today-h" className="eyebrow mb-2">Today</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {cards.map((c) => (
              <Link key={c.label} href={c.href} className={cn("card flex min-h-20 items-center gap-3 px-3 py-3 hover:bg-page", c.tone === "warning" && c.count > 0 && "border-warning/40", c.tone === "danger" && c.count > 0 && "border-danger/40")}>
                <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", c.tone === "danger" && c.count > 0 ? "bg-danger-soft text-danger" : c.tone === "warning" && c.count > 0 ? "bg-warning-soft text-warning" : "bg-lightblue text-primary")}><c.icon size={20} /></span>
                <span className="min-w-0">
                  <span className="block text-2xl font-black tabular-nums text-ink">{c.count}</span>
                  <span className="block truncate text-xs font-semibold text-muted">{c.label}</span>
                </span>
              </Link>
            ))}
          </div>
        </section>

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <section className="card p-4" aria-labelledby="rev-h">
              <div className="flex items-center justify-between gap-2">
                <h2 id="rev-h" className="eyebrow">Revenue · {d.money.range.label}</h2>
                <Link href="/payments" className="text-xs font-semibold text-primary hover:underline">Open payments</Link>
              </div>
              <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-xl bg-page p-3"><dt className="eyebrow">Booked</dt><dd className="mt-1 text-base font-black tabular-nums text-ink sm:text-lg">{formatQr(d.money.bookedQr)}</dd></div>
                <div className="rounded-xl bg-page p-3"><dt className="eyebrow">Received</dt><dd className="mt-1 text-base font-black tabular-nums text-success sm:text-lg">{formatQr(d.money.receivedQr)}</dd></div>
                <div className="rounded-xl bg-page p-3"><dt className="eyebrow">Outstanding</dt><dd className={cn("mt-1 text-base font-black tabular-nums sm:text-lg", d.money.outstandingQr > 0 ? "text-warning" : "text-ink")}>{formatQr(d.money.outstandingQr)}</dd></div>
              </dl>
            </section>

            <section className="card p-4" aria-labelledby="need-h">
              <div className="flex items-center justify-between gap-2">
                <h2 id="need-h" className="eyebrow">Needs action</h2>
                <Link href="/bookings" className="text-xs font-semibold text-primary hover:underline">All bookings</Link>
              </div>
              {d.needsAction.length === 0 ? <p className="mt-2 text-sm text-muted">Every booking is confirmed, delivered or closed.</p> : (
                <ul className="mt-2 divide-y divide-line">
                  {d.needsAction.map((b) => (
                    <li key={b.id}>
                      <Link href={`/bookings/${b.id}`} className="flex items-center gap-3 py-2.5 hover:bg-page">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-bold text-ink">{b.client?.full_name ?? b.customer_name} <span className="font-normal text-muted">· {BOOKING_TYPE_LABEL[b.booking_type]}</span></p>
                          <p className="truncate text-xs text-muted">{b.event?.name ?? b.package_name}{b.session_at ? ` · ${formatDateTime(b.session_at)}` : ""} · {formatStamp(b.created_at)}</p>
                        </div>
                        <BookingStatusBadge status={b.booking_status} size="sm" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="card p-4" aria-labelledby="up-h">
              <h2 id="up-h" className="eyebrow">Upcoming · next 14 days</h2>
              {d.upcoming.length === 0 ? <p className="mt-2 text-sm text-muted">Nothing scheduled. Add a session date to a booking or an event to see it here.</p> : (
                <ul className="mt-2 divide-y divide-line">
                  {d.upcoming.map((u) => (
                    <li key={`${u.kind}:${u.id}`}>
                      <Link href={u.href} className="flex items-center gap-3 py-2.5 hover:bg-page">
                        <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", u.kind === "event" ? "bg-navy text-white" : "bg-lightblue text-primary")}>{u.kind === "event" ? <CalendarIcon size={18} /> : <BookmarkIcon size={18} />}</span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-bold text-ink">{u.title}</p>
                          <p className="truncate text-xs text-muted">{u.kind === "booking" ? formatDateTime(u.at) : ""}{u.kind === "booking" && u.subtitle ? " · " : ""}{u.subtitle}</p>
                        </div>
                        {u.status && <BookingStatusBadge status={u.status} size="sm" />}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <section className="card p-4" aria-labelledby="act-h">
            <h2 id="act-h" className="eyebrow">Recent activity</h2>
            {d.activity.length === 0 ? <p className="mt-2 text-sm text-muted">Nothing yet.</p> : (
              <ol className="mt-2 space-y-2">
                {d.activity.map((a) => (
                  <li key={a.id} className="border-l-2 border-line pl-3 text-sm">
                    {a.href ? <Link href={a.href} className="text-ink hover:underline">{a.text}</Link> : <span className="text-ink">{a.text}</span>}
                    <p className="text-[11px] text-muted">{formatStamp(a.at)} · {a.actor}</p>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </PageBody>
    </>
  );
}
