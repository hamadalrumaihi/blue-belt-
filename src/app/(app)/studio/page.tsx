import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BrandHeader } from "@/components/BrandHeader";
import { PageBody } from "@/components/AppShell";
import { EmptyState } from "@/components/EmptyState";
import { AlertIcon, BellIcon, BookmarkIcon, CalendarIcon, CreditCardIcon, FileTextIcon, ImageIcon, InboxIcon, PlusIcon, SearchIcon } from "@/components/icons";
import { BOOKING_TYPE_LABEL, formatQr } from "@/lib/bookings/state";
import { resolveViewerMode } from "@/lib/collaborator";
import { loadStudioOverview } from "@/lib/studio/dashboard";
import { searchWorkspace } from "@/lib/studio/search";
import { formatDateTime, formatStamp } from "@/lib/time";
import { cn } from "@/lib/utils";
import { BookingStatusBadge } from "../bookings/BookingStatusBadge";
import { NextActionRow } from "./NextActionRow";

export const metadata: Metadata = { title: "Overview" };
export const dynamic = "force-dynamic";

type Card = { href: string; label: string; count: number; icon: React.ComponentType<{ size?: number; className?: string }>; tone?: "warning" | "danger" };

export default async function StudioPage({ searchParams }: PageProps<"/studio">) {
  if ((await resolveViewerMode()).collaboratorOnly) redirect("/coverage");
  const params = await searchParams;
  const rawQ = Array.isArray(params.q) ? params.q[0] : params.q;
  if (typeof rawQ === "string" && rawQ.trim()) return <SearchResults raw={rawQ} />;

  const now = new Date();
  const d = await loadStudioOverview(now);
  const t = d.today;
  const cards: Card[] = [
    { href: "/bookings?filter=confirmed", label: "Shoots in 7 days", count: t.upcomingShoots, icon: CalendarIcon },
    { href: "/leads", label: "Requests to answer", count: d.requests.length, icon: InboxIcon, tone: d.requests.length ? "warning" : undefined },
    { href: "/bookings", label: "Bookings need action", count: t.needsAction, icon: BookmarkIcon, tone: t.needsAction ? "warning" : undefined },
    { href: "/payments", label: "Balances outstanding", count: d.moneySplit.outstandingCount, icon: CreditCardIcon, tone: d.moneySplit.outstandingCount ? "warning" : undefined },
    { href: "/documents?status=sent", label: "Agreements to sign", count: t.contractsAwaiting, icon: FileTextIcon },
    { href: "/galleries?status=ready", label: "Galleries to deliver", count: t.galleriesAwaiting, icon: ImageIcon },
    { href: "/issues", label: "Watcher incidents", count: t.openIssues, icon: AlertIcon, tone: t.openIssues ? "danger" : undefined },
    { href: "/notifications", label: "Failed deliveries (24h)", count: t.failedDeliveries, icon: BellIcon, tone: t.failedDeliveries ? "danger" : undefined },
  ];

  return (
    <>
      <BrandHeader title="Overview" subtitle="Today's priorities, requests, money, delivery and what is coming up" actions={<Link href="/bookings/new" className="btn-primary min-h-10"><PlusIcon size={16} /> Booking</Link>} />
      <PageBody className="max-w-6xl space-y-4">
        <form action="/studio" method="get" role="search" className="lg:hidden">
          <label htmlFor="overview-search" className="sr-only">Search the workspace</label>
          <div className="flex min-h-11 items-center gap-2 rounded-xl border border-line bg-white px-3">
            <SearchIcon size={16} className="text-muted" />
            <input id="overview-search" name="q" type="search" placeholder="Search clients, clubs, bookings, leads, events, athletes" className="min-w-0 flex-1 bg-transparent text-sm focus:outline-none" />
          </div>
        </form>

        <section aria-labelledby="today-h">
          <h2 id="today-h" className="eyebrow mb-2">Today</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
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
            <section className="card p-4" aria-labelledby="prio-h">
              <div className="flex items-center justify-between gap-2">
                <h2 id="prio-h" className="eyebrow">Priorities · next action per booking</h2>
                <Link href="/bookings" className="text-xs font-semibold text-primary hover:underline">All bookings</Link>
              </div>
              {d.priorities.length === 0 ? (
                <p className="mt-2 text-sm text-muted">No live bookings. New website requests land in Leads; convert one to a booking to see its next step here.</p>
              ) : (
                <ul className="mt-2 divide-y divide-line">
                  {d.priorities.map(({ booking: b, action }) => (
                    <li key={b.id} className="py-2.5">
                      <NextActionRow action={action} now={now.toISOString()} title={b.client?.full_name ?? b.customer_name} subtitle={`${BOOKING_TYPE_LABEL[b.booking_type]}${b.public_ref ? ` · ${b.public_ref}` : ""}${b.session_at ? ` · ${formatDateTime(b.session_at)}` : ""}`} status={b.booking_status} />
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="card p-4" aria-labelledby="req-h">
              <div className="flex items-center justify-between gap-2">
                <h2 id="req-h" className="eyebrow">Requests needing an answer</h2>
                <Link href="/leads" className="text-xs font-semibold text-primary hover:underline">Open leads</Link>
              </div>
              <p className="mt-1 text-xs text-muted">New and contacted leads, plus bookings still at inquiry or quote. A request never reserves a slot.</p>
              {d.requests.length === 0 ? <p className="mt-2 text-sm text-muted">Everything has been answered.</p> : (
                <ul className="mt-2 divide-y divide-line">
                  {d.requests.slice(0, 10).map((r) => (
                    <li key={`${r.kind}:${r.id}`}>
                      <Link href={r.href} className="flex items-center gap-3 py-2.5 hover:bg-page">
                        <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", r.kind === "lead" ? "bg-lightblue text-primary" : "bg-warning-soft text-warning")}>{r.kind === "lead" ? <InboxIcon size={18} /> : <BookmarkIcon size={18} />}</span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-bold text-ink">{r.title}</p>
                          <p className="truncate text-xs text-muted">{r.subtitle} · {formatStamp(r.at, undefined, now)}</p>
                        </div>
                        <span className="rounded-full bg-page px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted">{r.kind === "lead" ? `lead · ${r.status}` : r.status.replace("_", " ")}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="card p-4" aria-labelledby="up-h">
              <div className="flex items-center justify-between gap-2">
                <h2 id="up-h" className="eyebrow">Next shoots · 14 days</h2>
                <Link href="/bookings?filter=confirmed" className="text-xs font-semibold text-primary hover:underline">Schedule</Link>
              </div>
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

            <section className="card p-4" aria-labelledby="deliv-h">
              <div className="flex items-center justify-between gap-2">
                <h2 id="deliv-h" className="eyebrow">Delivery work</h2>
                <Link href="/production" className="text-xs font-semibold text-primary hover:underline">Production board</Link>
              </div>
              <p className="mt-1 text-xs text-muted">{d.delivery.inProgress} booking{d.delivery.inProgress === 1 ? "" : "s"} in editing · {d.delivery.ready.length} galler{d.delivery.ready.length === 1 ? "y" : "ies"} ready but not delivered</p>
              {d.delivery.ready.length === 0 ? <p className="mt-2 text-sm text-muted">No gallery is waiting to be delivered.</p> : (
                <ul className="mt-2 divide-y divide-line">
                  {d.delivery.ready.map((g) => (
                    <li key={g.galleryId}>
                      <Link href={g.bookingId ? `/bookings/${g.bookingId}#delivery` : `/galleries/${g.galleryId}`} className="flex items-center gap-3 py-2.5 hover:bg-page">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-success-soft text-success"><ImageIcon size={18} /></span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-bold text-ink">{g.customer ?? g.name}</p>
                          <p className="truncate text-xs text-muted">{g.name}{g.readyAt ? ` · ready ${formatStamp(g.readyAt, undefined, now)}` : ""}{g.hasUrl ? "" : " · no gallery link yet"}</p>
                        </div>
                        <span className="text-xs font-semibold text-primary">Deliver</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <div className="space-y-4">
            <section className="card p-4" aria-labelledby="money-h">
              <div className="flex items-center justify-between gap-2">
                <h2 id="money-h" className="eyebrow">Money · {d.moneySplit.range.label}</h2>
                <Link href="/studio/metrics" className="text-xs font-semibold text-primary hover:underline">Metrics</Link>
              </div>
              <dl className="mt-3 space-y-2">
                <div className="rounded-xl bg-page p-3">
                  <dt className="text-xs font-semibold text-muted">Collected this month</dt>
                  <dd className="text-lg font-black tabular-nums text-success">{formatQr(d.moneySplit.collectedMonthQr)}</dd>
                  <dd className="text-[11px] text-muted">Payments recorded (online + by hand) with a paid date in {d.moneySplit.range.label}.</dd>
                </div>
                <div className="rounded-xl bg-page p-3">
                  <dt className="text-xs font-semibold text-muted">Forecast: booked this month</dt>
                  <dd className="text-lg font-black tabular-nums text-ink">{formatQr(d.moneySplit.forecastMonthQr)}</dd>
                  <dd className="text-[11px] text-muted">Total price of bookings confirmed in {d.moneySplit.range.label}. Not money in the bank.</dd>
                </div>
                <div className="rounded-xl bg-page p-3">
                  <dt className="text-xs font-semibold text-muted">Outstanding balances</dt>
                  <dd className={cn("text-lg font-black tabular-nums", d.moneySplit.outstandingQr > 0 ? "text-warning" : "text-ink")}>{formatQr(d.moneySplit.outstandingQr)}</dd>
                  <dd className="text-[11px] text-muted">Still owed on {d.moneySplit.outstandingCount} live booking{d.moneySplit.outstandingCount === 1 ? "" : "s"} (deposit or balance), any month. Live pipeline {formatQr(d.moneySplit.forecastLiveQr)}.</dd>
                </div>
              </dl>
              <Link href="/payments" className="mt-3 inline-block text-xs font-semibold text-primary hover:underline">Open payments</Link>
            </section>

            <section className="card p-4" aria-labelledby="inc-h">
              <div className="flex items-center justify-between gap-2">
                <h2 id="inc-h" className="eyebrow">Integration incidents</h2>
                <Link href="/issues" className="text-xs font-semibold text-primary hover:underline">Issues</Link>
              </div>
              {d.incidents.length === 0 && t.failedDeliveries === 0 ? <p className="mt-2 text-sm text-muted">Watcher, Telegram and e-mail deliveries are running clean.</p> : (
                <ul className="mt-2 space-y-2 text-sm">
                  {t.failedDeliveries > 0 && <li className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-ink"><Link href="/notifications" className="font-semibold hover:underline">{t.failedDeliveries} failed deliver{t.failedDeliveries === 1 ? "y" : "ies"}</Link> in the last 24 hours.</li>}
                  {d.incidents.map((i) => (
                    <li key={i.id} className="rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-ink">
                      <Link href="/issues" className="font-semibold hover:underline">{i.kind.replace(/[._]/g, " ")}</Link>
                      <span className="text-xs text-muted"> · seen {i.occurrences}× · last {formatStamp(i.last_seen_at, undefined, now)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="card p-4" aria-labelledby="q-h">
              <div className="flex items-center justify-between gap-2">
                <h2 id="q-h" className="eyebrow">Open questions</h2>
                <Link href="/website/faqs#open-questions" className="text-xs font-semibold text-primary hover:underline">Manage</Link>
              </div>
              <p className="mt-2 text-sm text-ink"><span className={cn("text-2xl font-black tabular-nums", d.openQuestions.open ? "text-warning" : "text-ink")}>{d.openQuestions.open}</span> unanswered visitor / policy question{d.openQuestions.open === 1 ? "" : "s"}</p>
              <p className="text-[11px] text-muted">{d.openQuestions.resolved} resolved. Turn the recurring ones into FAQs so the website answers them.</p>
            </section>

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
        </div>
      </PageBody>
    </>
  );
}

async function SearchResults({ raw }: { raw: string }) {
  const { term, groups } = await searchWorkspace(raw);
  const total = groups.reduce((s, g) => s + g.hits.length, 0);
  return (
    <>
      <BrandHeader title="Search" subtitle={term ? `Results for “${term}”` : "Type at least two characters"} backHref="/studio" />
      <PageBody className="max-w-4xl space-y-4">
        <form action="/studio" method="get" role="search">
          <label htmlFor="search-q" className="sr-only">Search the workspace</label>
          <div className="flex min-h-11 items-center gap-2 rounded-xl border border-line bg-white px-3">
            <SearchIcon size={16} className="text-muted" />
            <input id="search-q" name="q" type="search" defaultValue={raw} autoFocus className="min-w-0 flex-1 bg-transparent text-sm focus:outline-none" />
            <button type="submit" className="btn-primary min-h-9 px-3 text-xs">Search</button>
          </div>
        </form>
        <p className="text-xs text-muted">Searches clients, teams & clubs, bookings (reference, customer, athlete, e-mail), leads, events and tracked athletes you have access to. <Link href="/studio" className="font-semibold text-primary hover:underline">Back to overview</Link></p>
        {!term ? (
          <EmptyState icon={<SearchIcon />} title="Type at least two characters" description="Names, references like BB-7K3PQ2, e-mails, phone numbers, venues or academies." />
        ) : total === 0 ? (
          <EmptyState icon={<SearchIcon />} title={`Nothing matches “${term}”`} description="Try a shorter word, the booking reference or the client's phone number." />
        ) : (
          groups.map((g) => (
            <section key={g.key} className="card p-4" aria-labelledby={`sr-${g.key}`}>
              <h2 id={`sr-${g.key}`} className="eyebrow">{g.label} · {g.hits.length}</h2>
              <ul className="mt-2 divide-y divide-line">
                {g.hits.map((h) => (
                  <li key={h.id}>
                    <Link href={h.href} className="flex items-center gap-3 py-2.5 hover:bg-page">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-bold text-ink">{h.title}</p>
                        {h.subtitle && <p className="truncate text-xs text-muted">{h.subtitle}</p>}
                      </div>
                      {h.badge && <span className="rounded-full bg-page px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted">{h.badge.replace(/_/g, " ")}</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </PageBody>
    </>
  );
}
