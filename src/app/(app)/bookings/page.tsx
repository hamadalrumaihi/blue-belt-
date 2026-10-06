import type { Metadata } from "next";
import Link from "next/link";
import { BrandHeader } from "@/components/BrandHeader";
import { PageBody } from "@/components/AppShell";
import { EmptyState } from "@/components/EmptyState";
import { BookmarkIcon, PlusIcon, SearchIcon } from "@/components/icons";
import { bookingCounts, listBookings, type BookingFilter } from "@/lib/bookings/queries";
import { BOOKING_TYPE_LABEL, BOOKING_TYPES, formatQr, isBookingType } from "@/lib/bookings/state";
import { formatDateTime, formatEventDate } from "@/lib/time";
import { cn } from "@/lib/utils";
import { BookingStatusBadge } from "./BookingStatusBadge";
import { PaymentBadge } from "./PaymentBadge";

export const metadata: Metadata = { title: "Bookings" };
export const dynamic = "force-dynamic";

const FILTERS: Array<{ key: BookingFilter; label: string }> = [
  { key: "needs_action", label: "Needs action" },
  { key: "confirmed", label: "Confirmed / upcoming" },
  { key: "delivered", label: "Delivered" },
  { key: "all", label: "All" },
];

function href(filter: BookingFilter, q: string | null, type: string | null): string {
  const params = new URLSearchParams();
  if (filter !== "needs_action") params.set("filter", filter);
  if (q) params.set("q", q);
  if (type) params.set("type", type);
  const s = params.toString();
  return s ? `/bookings?${s}` : "/bookings";
}

export default async function BookingsPage({ searchParams }: PageProps<"/bookings">) {
  const params = await searchParams;
  const filter = (FILTERS.find((f) => f.key === params.filter)?.key ?? "needs_action") as BookingFilter;
  const q = typeof params.q === "string" && params.q.trim() ? params.q.trim().slice(0, 60) : null;
  const type = typeof params.type === "string" && isBookingType(params.type) ? params.type : null;
  const [bookings, counts] = await Promise.all([listBookings({ filter, q, type }), bookingCounts()]);
  const current = FILTERS.find((f) => f.key === filter)!;

  return (
    <>
      <BrandHeader title="Bookings" subtitle={counts.needs_action ? `${counts.needs_action} need${counts.needs_action === 1 ? "s" : ""} your attention` : `${counts.all} booking${counts.all === 1 ? "" : "s"}`} actions={<Link href="/bookings/new" className="btn-primary min-h-10"><PlusIcon size={16} /> New</Link>} />
      <PageBody className="max-w-3xl">
        <form method="get" action="/bookings" className="mb-3 flex gap-2" role="search">
          {filter !== "needs_action" && <input type="hidden" name="filter" value={filter} />}
          {type && <input type="hidden" name="type" value={type} />}
          <label htmlFor="q" className="sr-only">Search bookings</label>
          <input id="q" name="q" className="input" type="search" inputMode="search" placeholder="Name, athlete, reference or e-mail" defaultValue={q ?? ""} autoComplete="off" />
          <button type="submit" className="btn-secondary min-h-11 shrink-0" aria-label="Search"><SearchIcon size={18} /></button>
        </form>
        <div className="mb-3 flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <Link key={f.key} href={href(f.key, q, type)} aria-current={filter === f.key ? "page" : undefined} className={cn("inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-bold", filter === f.key ? "border-primary bg-lightblue text-primary" : "border-line bg-white text-muted")}>
              {f.label}
              <span className={cn("rounded-full px-1.5 text-[10px] tabular-nums", filter === f.key ? "bg-white/70" : "bg-page")}>{counts[f.key]}</span>
            </Link>
          ))}
        </div>
        <div className="mb-3 flex flex-wrap gap-1.5 text-xs">
          <Link href={href(filter, q, null)} className={cn("rounded-md px-2 py-1 font-semibold", !type ? "bg-ink text-white" : "text-muted hover:text-ink")}>Any type</Link>
          {BOOKING_TYPES.map((t) => (
            <Link key={t} href={href(filter, q, t)} className={cn("rounded-md px-2 py-1 font-semibold", type === t ? "bg-ink text-white" : "text-muted hover:text-ink")}>{BOOKING_TYPE_LABEL[t]}</Link>
          ))}
        </div>

        {bookings.length === 0 ? (
          counts.all === 0 ? (
            <EmptyState icon={<BookmarkIcon />} title="No bookings yet" description="Add a booking by hand, or open public booking on your website so clients can request one." action={<Link href="/bookings/new" className="btn-primary">New booking</Link>} />
          ) : (
            <EmptyState compact title={q ? `Nothing matches “${q}”` : `Nothing under “${current.label}”`} description={filter === "needs_action" && !q ? "Every booking is confirmed, delivered or closed." : "Try another filter or search."} action={<Link href="/bookings?filter=all" className="btn-secondary">Show all bookings</Link>} />
          )
        ) : (
          <ul className="card divide-y divide-line">
            {bookings.map((b) => (
              <li key={b.id}>
                <Link href={`/bookings/${b.id}`} className="flex min-h-16 items-center gap-3 px-4 py-3 hover:bg-page">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-extrabold text-ink">
                      {b.client?.full_name ?? b.customer_name}
                      {b.athlete_name && b.athlete_name !== b.customer_name ? <span className="font-normal text-muted"> · {b.athlete_name}</span> : null}
                    </p>
                    <p className="truncate text-xs text-muted">
                      <span className="font-mono">{b.public_ref ?? "—"}</span> · {BOOKING_TYPE_LABEL[b.booking_type]}{b.package_name && b.package_name !== BOOKING_TYPE_LABEL[b.booking_type] ? ` · ${b.package_name}` : ""}
                    </p>
                    <p className="truncate text-[11px] text-muted">
                      {b.event ? `${b.event.name}${b.event.event_date ? ` · ${formatEventDate(b.event.event_date, "short")}` : ""}` : b.session_at ? formatDateTime(b.session_at) : "Date to be confirmed"}
                      {b.event && b.session_at ? ` · ${formatDateTime(b.session_at)}` : ""}
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      <BookingStatusBadge status={b.booking_status} size="sm" />
                      <PaymentBadge payment={b.payment} amountQr={b.amount_qr} size="sm" />
                    </div>
                  </div>
                  <p className="shrink-0 text-right text-sm font-black tabular-nums text-ink">{formatQr(b.amount_qr)}</p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </PageBody>
    </>
  );
}
