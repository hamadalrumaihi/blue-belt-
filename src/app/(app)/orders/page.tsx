import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BrandHeader } from "@/components/BrandHeader";
import { PageBody } from "@/components/AppShell";
import { EmptyState } from "@/components/EmptyState";
import { isOrdersIntakeEnabled } from "@/lib/orders/config";
import { METHOD_LABEL, paymentLabel, type PaymentMethod, type PaymentState } from "@/lib/orders/contract";
import { draftOrderOf, invoiceNeed, invoiceSentAt, matchClient } from "@/lib/orders/invoice-draft";
import { findOrderIdByRef, listClientContacts, listOrders, orderCounts, type OrderFilter } from "@/lib/orders/queries";
import { formatDateTime, zoneLabel } from "@/lib/time";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Orders" };
export const dynamic = "force-dynamic";

const FILTERS: Array<{ key: OrderFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "needs_confirmation", label: "Needs payment confirmation" },
  { key: "paid", label: "Paid" },
  { key: "fulfilled", label: "Fulfilled" },
];

/**
 * Owner-only list of Pic-Time orders (RLS: only the owner's rows exist for
 * this session; collaborators have no policy on photo_orders). Buyers are
 * customers — nothing here links to tracked athletes.
 */
export default async function OrdersPage({ searchParams }: PageProps<"/orders">) {
  const params = await searchParams;
  // Telegram [Orders] links carry the Pic-Time reference; open that order directly.
  if (typeof params.ref === "string" && params.ref) {
    const id = await findOrderIdByRef(params.ref);
    if (id) redirect(`/orders/${id}`);
  }
  const filter = (FILTERS.find((f) => f.key === params.filter)?.key ?? "all") as OrderFilter;
  const [orders, counts, clients] = await Promise.all([listOrders(filter), orderCounts(), listClientContacts()]);
  const intake = isOrdersIntakeEnabled();

  return (
    <>
      <BrandHeader title="Orders" subtitle={counts.needsConfirmation ? `${counts.needsConfirmation} need${counts.needsConfirmation === 1 ? "s" : ""} payment attention` : `${counts.total} order${counts.total === 1 ? "" : "s"}`} />
      <PageBody className="max-w-3xl">
        <div className="mb-3 flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <Link key={f.key} href={f.key === "all" ? "/orders" : `/orders?filter=${f.key}`} aria-current={filter === f.key ? "page" : undefined} className={cn("inline-flex min-h-9 items-center rounded-full border px-3 text-xs font-bold", filter === f.key ? "border-primary bg-lightblue text-primary" : "border-line bg-white text-muted")}>
              {f.label}
            </Link>
          ))}
        </div>
        {!intake && <p className="mb-3 rounded-xl bg-page px-3 py-2 text-xs text-muted">Automatic intake from Pic-Time is not switched on (ORDERS_INTAKE_ENABLED). Orders recorded by other means still show here.</p>}
        {orders.length === 0 && filter !== "all" && counts.total > 0 ? (
          <EmptyState compact title={`No orders under “${FILTERS.find((f) => f.key === filter)?.label}”`} description={filter === "needs_confirmation" ? "Every order has a confirmed payment or is closed." : "Try another filter."} action={<Link href="/orders" className="btn-secondary">Show all orders</Link>} />
        ) : orders.length === 0 ? (
          <EmptyState title="No orders yet" description={intake ? "New Pic-Time orders sent by your Zap will appear here and in Telegram as [Orders] messages." : "Switch on the orders intake and connect the Zap (docs/orders-intake.md) to see orders here."} />
        ) : (
          <ul className="card divide-y divide-line">
            {orders.map((o) => {
              const method = o.payment_method as PaymentMethod;
              const state = o.payment_state as PaymentState;
              const needs = state !== "paid" && state !== "refunded" && o.status !== "cancelled";
              const need = invoiceNeed(draftOrderOf(o), matchClient({ email: o.customer_email, phone: o.customer_phone }, clients));
              const invoice = need.kind === "draft" ? (invoiceSentAt(o.metadata) ? "Invoice sent" : "Invoice draft ready") : need.kind === "client" ? "Existing client" : null;
              return (
                <li key={o.id}>
                  <Link href={`/orders/${o.id}`} className="flex min-h-16 items-center gap-3 px-4 py-3 hover:bg-page">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-extrabold text-ink">{o.customer_name}{o.gallery_name ? <span className="font-normal text-muted"> · {o.gallery_name}</span> : null}</p>
                      <p className={cn("break-words text-xs", needs ? "font-semibold text-amber-800" : "text-muted")}>{needs && <span className="mr-1 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide">Action needed</span>}{paymentLabel(method, state)} · {METHOD_LABEL[method] ?? method}{o.status === "fulfilled" ? " · fulfilled" : o.status === "cancelled" ? " · cancelled" : ""}</p>
                      {invoice && <p className={cn("mt-0.5 text-[11px] font-semibold", invoice === "Invoice draft ready" ? "text-amber-800" : "text-muted")}>{invoice}</p>}
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
