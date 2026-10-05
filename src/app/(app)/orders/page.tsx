import type { Metadata } from "next";
import Link from "next/link";
import { BrandHeader } from "@/components/BrandHeader";
import { PageBody } from "@/components/AppShell";
import { EmptyState } from "@/components/EmptyState";
import { isOrdersIntakeEnabled } from "@/lib/orders/config";
import { METHOD_LABEL, paymentLabel, type PaymentMethod, type PaymentState } from "@/lib/orders/contract";
import { listOrders, orderCounts, type OrderFilter } from "@/lib/orders/queries";
import { formatDateTime } from "@/lib/time";
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
  const filter = (FILTERS.find((f) => f.key === params.filter)?.key ?? "all") as OrderFilter;
  const [orders, counts] = await Promise.all([listOrders(filter), orderCounts()]);
  const intake = isOrdersIntakeEnabled();

  return (
    <>
      <BrandHeader title="Orders" subtitle={counts.needsConfirmation ? `${counts.needsConfirmation} need${counts.needsConfirmation === 1 ? "s" : ""} payment attention` : `${counts.total} order${counts.total === 1 ? "" : "s"}`} />
      <PageBody className="max-w-3xl">
        <div className="mb-3 flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <Link key={f.key} href={f.key === "all" ? "/orders" : `/orders?filter=${f.key}`} className={cn("rounded-full border px-3 py-1.5 text-xs font-bold", filter === f.key ? "border-primary bg-lightblue text-primary" : "border-line bg-white text-muted")}>
              {f.label}
            </Link>
          ))}
        </div>
        {!intake && <p className="mb-3 rounded-xl bg-page px-3 py-2 text-xs text-muted">Automatic intake from Pic-Time is not switched on (ORDERS_INTAKE_ENABLED). Orders recorded by other means still show here.</p>}
        {orders.length === 0 ? (
          <EmptyState title="No orders yet" description={intake ? "New Pic-Time orders sent by your Zap will appear here and in Telegram as [Orders] messages." : "Switch on the orders intake and connect the Zap (docs/orders-intake.md) to see orders here."} />
        ) : (
          <ul className="card divide-y divide-line">
            {orders.map((o) => {
              const method = o.payment_method as PaymentMethod;
              const state = o.payment_state as PaymentState;
              const needs = state !== "paid" && state !== "refunded" && o.status !== "cancelled";
              return (
                <li key={o.id}>
                  <Link href={`/orders/${o.id}`} className="flex min-h-16 items-center gap-3 px-4 py-3 hover:bg-page">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-extrabold text-ink">{o.customer_name}{o.gallery_name ? <span className="font-normal text-muted"> · {o.gallery_name}</span> : null}</p>
                      <p className={cn("truncate text-xs", needs ? "font-semibold text-amber-700" : "text-muted")}>{paymentLabel(method, state)} · {METHOD_LABEL[method] ?? method}{o.status === "fulfilled" ? " · fulfilled" : o.status === "cancelled" ? " · cancelled" : ""}</p>
                      <p className="text-[11px] text-muted">{o.external_ref ?? o.pictime_order_id ?? "—"} · {formatDateTime(o.placed_at ?? o.received_at ?? o.created_at)}</p>
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
