import type { Metadata } from "next";
import Link from "next/link";
import { BrandHeader } from "@/components/BrandHeader";
import { PageBody } from "@/components/AppShell";
import { EmptyState } from "@/components/EmptyState";
import { CreditCardIcon } from "@/components/icons";
import { BOOKING_STATUS_LABEL, formatQr, isPaymentMethod, PAYMENT_METHOD_LABEL, PAYMENT_METHODS } from "@/lib/bookings/state";
import { listOutstandingBookings, listPaymentRecords, monthMoney, type LedgerKind } from "@/lib/payments/ledger";
import { formatDateTime, formatStamp } from "@/lib/time";
import { cn } from "@/lib/utils";
import { PaymentBadge } from "../bookings/PaymentBadge";

export const metadata: Metadata = { title: "Payments" };
export const dynamic = "force-dynamic";

const KINDS: Array<{ key: LedgerKind | "all"; label: string }> = [
  { key: "all", label: "All" },
  { key: "provider", label: "MyFatoorah" },
  { key: "manual", label: "Recorded by hand" },
];

function href(kind: string, method: string | null): string {
  const p = new URLSearchParams();
  if (kind !== "all") p.set("kind", kind);
  if (method) p.set("method", method);
  const s = p.toString();
  return s ? `/payments?${s}` : "/payments";
}

export default async function PaymentsPage({ searchParams }: PageProps<"/payments">) {
  const params = await searchParams;
  const kind = (KINDS.find((k) => k.key === params.kind)?.key ?? "all") as LedgerKind | "all";
  const method = typeof params.method === "string" && isPaymentMethod(params.method) ? params.method : null;
  const [records, outstanding, money] = await Promise.all([listPaymentRecords({ kind: kind === "all" ? null : kind, method }), listOutstandingBookings(), monthMoney()]);

  return (
    <>
      <BrandHeader title="Payments" subtitle={`${money.range.label} · ${formatQr(money.receivedQr)} received`} />
      <PageBody className="max-w-4xl space-y-4">
        <section className="grid grid-cols-3 gap-2" aria-label="This month">
          <Stat label="Booked" value={formatQr(money.bookedQr)} hint={money.range.label} />
          <Stat label="Received" value={formatQr(money.receivedQr)} hint={`${money.recordCount} payment${money.recordCount === 1 ? "" : "s"}`} tone="success" />
          <Stat label="Outstanding" value={formatQr(money.outstandingQr)} hint={`${outstanding.length} booking${outstanding.length === 1 ? "" : "s"}`} tone={money.outstandingQr > 0 ? "warning" : undefined} />
        </section>

        <section className="card p-4" aria-labelledby="due-h">
          <h2 id="due-h" className="eyebrow">Awaiting payment</h2>
          {outstanding.length === 0 ? (
            <p className="mt-2 text-sm text-muted">Nothing is owed on live bookings.</p>
          ) : (
            <ul className="mt-2 divide-y divide-line">
              {outstanding.map((b) => (
                <li key={b.id}>
                  <Link href={`/bookings/${b.id}`} className="flex items-center gap-3 py-2.5 hover:bg-page">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-ink">{b.customer_name} <span className="font-mono font-normal text-muted">· {b.public_ref ?? "—"}</span></p>
                      <p className="truncate text-xs text-muted">{b.package_name} · {BOOKING_STATUS_LABEL[b.booking_status]}{b.session_at ? ` · ${formatDateTime(b.session_at)}` : ""}{b.payment_url ? " · link ready" : ""}</p>
                      <div className="mt-1"><PaymentBadge payment={b.payment} amountQr={b.amount_qr} size="sm" /></div>
                    </div>
                    <p className="shrink-0 text-right text-sm font-black tabular-nums text-warning">{formatQr(b.payment.dueQr)}</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card p-4" aria-labelledby="ledger-h">
          <h2 id="ledger-h" className="eyebrow">Ledger</h2>
          <div className="mt-2 flex flex-wrap gap-2">
            {KINDS.map((k) => (
              <Link key={k.key} href={href(k.key, method)} aria-current={kind === k.key ? "page" : undefined} className={cn("inline-flex min-h-9 items-center rounded-full border px-3 text-xs font-bold", kind === k.key ? "border-primary bg-lightblue text-primary" : "border-line bg-white text-muted")}>{k.label}</Link>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
            <Link href={href(kind, null)} className={cn("rounded-md px-2 py-1 font-semibold", !method ? "bg-ink text-white" : "text-muted hover:text-ink")}>Any method</Link>
            {PAYMENT_METHODS.map((m) => <Link key={m} href={href(kind, m)} className={cn("rounded-md px-2 py-1 font-semibold", method === m ? "bg-ink text-white" : "text-muted hover:text-ink")}>{PAYMENT_METHOD_LABEL[m]}</Link>)}
          </div>
          {records.length === 0 ? (
            <EmptyState compact className="mt-3 border-0 shadow-none" icon={<CreditCardIcon />} title="No payments recorded" description="MyFatoorah payments land here automatically; cash, bank and Fawran are recorded on each booking." />
          ) : (
            <ul className="mt-3 divide-y divide-line">
              {records.map((r) => (
                <li key={r.id} className="flex items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-ink">
                      {r.booking ? <Link href={`/bookings/${r.booking.id}`} className="hover:underline">{r.booking.customer_name}</Link> : r.order_id ? <Link href={`/orders/${r.order_id}`} className="hover:underline">Pic-Time order</Link> : "Payment"}
                      {r.booking?.public_ref && <span className="font-mono font-normal text-muted"> · {r.booking.public_ref}</span>}
                    </p>
                    <p className="truncate text-xs text-muted">{PAYMENT_METHOD_LABEL[r.method]}{r.kind === "provider" ? " · verified" : " · by hand"} · {formatStamp(r.paid_at)}{r.note ? ` · ${r.note}` : ""}</p>
                  </div>
                  <p className="shrink-0 text-sm font-black tabular-nums text-ink">{formatQr(r.amount_qr)}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </PageBody>
    </>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "success" | "warning" }) {
  return (
    <div className="card px-3 py-3">
      <p className="eyebrow">{label}</p>
      <p className={cn("mt-1 truncate text-base font-black tabular-nums sm:text-xl", tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : "text-ink")}>{value}</p>
      {hint && <p className="truncate text-[11px] text-muted">{hint}</p>}
    </div>
  );
}
