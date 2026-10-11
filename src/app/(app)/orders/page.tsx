import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BrandHeader } from "@/components/BrandHeader";
import { PageBody } from "@/components/AppShell";
import { EmptyState } from "@/components/EmptyState";
import { heartbeatAge, loadJobHeartbeats } from "@/lib/jobs/heartbeat";
import { isOrdersIntakeEnabled } from "@/lib/orders/config";
import { METHOD_LABEL, paymentLabel, type PaymentMethod, type PaymentState } from "@/lib/orders/contract";
import { EXCEPTION_LABEL, isInvoiceExceptionReason, readOrderInvoicing } from "@/lib/orders/eligibility";
import { findOrderIdByRef, listOrders, orderCounts, orderQueueOverview, type OrderFilter } from "@/lib/orders/queries";
import { isPaymentsEnabled } from "@/lib/payments/config";
import { loadStudio } from "@/lib/studio/queries";
import type { PhotoJobHeartbeatRow } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime, zoneLabel } from "@/lib/time";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Orders" };
export const dynamic = "force-dynamic";

const FILTERS: Array<{ key: OrderFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "needs_confirmation", label: "Unpaid" },
  { key: "attention", label: "Needs attention" },
  { key: "paid", label: "Paid" },
  { key: "fulfilled", label: "Fulfilled" },
];

/**
 * Owner-only list of gallery photo orders (RLS: only the owner's rows exist
 * for this session; collaborators have no policy on photo_orders). Buyers
 * are customers; nothing here links to tracked athletes.
 */
export default async function OrdersPage({ searchParams }: PageProps<"/orders">) {
  const params = await searchParams;
  // Telegram [Orders] links carry the Pic-Time reference; open that order directly.
  if (typeof params.ref === "string" && params.ref) {
    const id = await findOrderIdByRef(params.ref);
    if (id) redirect(`/orders/${id}`);
  }
  const filter = (FILTERS.find((f) => f.key === params.filter)?.key ?? "all") as OrderFilter;
  const supabase = await createClient();
  const now = new Date();
  const [orders, counts, studio, queue, beats] = await Promise.all([listOrders(filter), orderCounts(), loadStudio(), orderQueueOverview(), loadJobHeartbeats(supabase).catch((): Record<string, PhotoJobHeartbeatRow> => ({}))]);
  const intake = isOrdersIntakeEnabled();
  const invoicing = readOrderInvoicing(studio?.settings ?? null);
  const payments = beats.payments;
  const deliveries = beats.deliveries;

  return (
    <>
      <BrandHeader title="Orders" subtitle={counts.needsConfirmation ? `${counts.needsConfirmation} unpaid` : `${counts.total} order${counts.total === 1 ? "" : "s"}`} />
      <PageBody className="max-w-3xl">
        <section className="mb-3 grid gap-2 sm:grid-cols-3" aria-label="Invoicing status">
          <Stat label="Invoicing" value={invoicing.mode === "auto" ? "Automatic" : "Review"} hint={invoicing.mode === "auto" && invoicing.autoSince ? `since ${formatDateTime(invoicing.autoSince)}` : "you press Send invoice"} href="/settings" />
          <Stat label="Queue" value={queue.waiting ? `${queue.waiting} waiting` : queue.exceptions || queue.emailFailed ? `${queue.exceptions + queue.emailFailed} need attention` : "Clear"} hint={queue.waiting && queue.oldestWaitingAt ? `oldest ${formatDateTime(queue.oldestWaitingAt)}` : `${queue.exceptions} exception${queue.exceptions === 1 ? "" : "s"} · ${queue.emailFailed} e-mail failed`} tone={queue.exceptions || queue.emailFailed ? "warning" : undefined} />
          <Stat label="Runners" value={payments ? `Payments ${heartbeatAge(payments.ran_at, now)}` : isPaymentsEnabled() ? "Payments: never ran" : "Payments off"} hint={deliveries ? `deliveries ${heartbeatAge(deliveries.ran_at, now)}` : "deliveries: never ran"} tone={payments && now.getTime() - new Date(payments.ran_at).getTime() > 30 * 60_000 ? "warning" : undefined} />
        </section>

        <div className="mb-3 flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <Link key={f.key} href={f.key === "all" ? "/orders" : `/orders?filter=${f.key}`} aria-current={filter === f.key ? "page" : undefined} className={cn("inline-flex min-h-9 items-center rounded-full border px-3 text-xs font-bold", filter === f.key ? "border-primary bg-lightblue text-primary" : "border-line bg-white text-muted")}>
              {f.label}
            </Link>
          ))}
        </div>
        {!intake && <p className="mb-3 rounded-xl bg-page px-3 py-2 text-xs text-muted">Automatic intake from the gallery is not switched on (ORDERS_INTAKE_ENABLED). Orders recorded by other means still show here.</p>}
        {orders.length === 0 && filter !== "all" && counts.total > 0 ? (
          <EmptyState compact title={`No orders under “${FILTERS.find((f) => f.key === filter)?.label}”`} description={filter === "attention" ? "Every order's payment link went out, or nothing is owed." : filter === "needs_confirmation" ? "Every order is paid or closed." : "Try another filter."} action={<Link href="/orders" className="btn-secondary">Show all orders</Link>} />
        ) : orders.length === 0 ? (
          <EmptyState title="No orders yet" description={intake ? "New gallery orders sent by your Zap will appear here and in Telegram as [Orders] cards." : "Switch on the orders intake and connect the Zap (docs/orders-intake.md) to see orders here."} />
        ) : (
          <ul className="card divide-y divide-line">
            {orders.map((o) => {
              const method = o.payment_method as PaymentMethod;
              const state = o.payment_state as PaymentState;
              const needs = state !== "paid" && state !== "refunded" && o.status !== "cancelled" && Number(o.amount_qr) > 0;
              const chip = invoiceChip(o);
              return (
                <li key={o.id}>
                  <Link href={`/orders/${o.id}`} className="flex min-h-16 items-center gap-3 px-4 py-3 hover:bg-page">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-extrabold text-ink">{o.customer_name}{o.gallery_name ? <span className="font-normal text-muted"> · {o.gallery_name}</span> : null}{o.source === "test" ? <span className="ml-2 rounded bg-page px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted">Test</span> : null}</p>
                      <p className={cn("break-words text-xs", needs ? "font-semibold text-amber-800" : "text-muted")}>{paymentLabel(method, state)} · {METHOD_LABEL[method] ?? method}{o.status === "fulfilled" ? " · fulfilled" : o.status === "cancelled" ? " · cancelled" : ""}</p>
                      {chip && <p className="mt-0.5"><span className={cn("rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide", chip.tone)}>{chip.label}</span></p>}
                      <p className="text-[11px] text-muted">{o.external_ref ?? o.pictime_order_id ?? "—"} · {formatDateTime(o.placed_at ?? o.received_at ?? o.created_at)} {zoneLabel()}</p>
                    </div>
                    <p className="shrink-0 text-right text-base font-black tabular-nums text-ink">{Number(o.amount_qr).toFixed(2)} <span className="text-xs font-bold text-muted">{o.currency}</span></p>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </PageBody>
    </>
  );
}

function invoiceChip(o: { status: string; payment_state: string; amount_qr: number; payment_method: string; invoice_exception: string | null; invoice_email_state: string; invoice_requested_at: string | null; metadata: unknown }): { label: string; tone: string } | null {
  if (o.status === "cancelled" || o.payment_state === "refunded") return null;
  if (o.payment_state === "paid") {
    const meta = o.metadata && typeof o.metadata === "object" && !Array.isArray(o.metadata) ? (o.metadata as Record<string, unknown>) : {};
    return { label: meta.payment_confirmed_source === "MYFATOORAH" ? "Paid online" : "Paid", tone: "bg-success-soft text-success" };
  }
  if (!(Number(o.amount_qr) > 0) || o.payment_method === "card") return null;
  if (o.invoice_exception) return { label: `Attention: ${isInvoiceExceptionReason(o.invoice_exception) ? EXCEPTION_LABEL[o.invoice_exception] : o.invoice_exception}`, tone: "bg-amber-50 text-amber-800" };
  switch (o.invoice_email_state) {
    case "sent":
      return { label: "Payment link e-mailed", tone: "bg-lightblue text-primary" };
    case "queued":
      return { label: "E-mail queued", tone: "bg-lightblue text-primary" };
    case "failed":
      return { label: "E-mail failed", tone: "bg-danger-soft text-danger" };
    default:
      return o.invoice_requested_at ? { label: "Invoice queued", tone: "bg-lightblue text-primary" } : { label: "Invoice not sent", tone: "bg-amber-50 text-amber-800" };
  }
}

function Stat({ label, value, hint, tone, href }: { label: string; value: string; hint?: string; tone?: "warning"; href?: string }) {
  const body = (
    <>
      <p className="eyebrow">{label}</p>
      <p className={cn("mt-1 truncate text-sm font-black", tone === "warning" ? "text-amber-800" : "text-ink")}>{value}</p>
      {hint && <p className="truncate text-[11px] text-muted">{hint}</p>}
    </>
  );
  return href ? <Link href={href} className="card block px-3 py-3 hover:bg-page">{body}</Link> : <div className="card px-3 py-3">{body}</div>;
}
