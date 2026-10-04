import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BrandHeader } from "@/components/BrandHeader";
import { PageBody } from "@/components/AppShell";
import { METHOD_LABEL, OFFLINE_METHODS, paymentLabel, type PaymentMethod, type PaymentState } from "@/lib/orders/contract";
import { getOrder } from "@/lib/orders/queries";
import { formatDateTime } from "@/lib/time";
import { isUuid } from "@/lib/validation";
import { OrderActions } from "./OrderActions";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/orders/[id]">): Promise<Metadata> {
  const { id } = await params;
  const order = isUuid(id) ? await getOrder(id) : null;
  return { title: order ? `Order — ${order.customer_name}` : "Order" };
}

type Item = { name?: unknown; quantity?: unknown; unitAmount?: unknown; sku?: unknown };

export default async function OrderDetailPage({ params }: PageProps<"/orders/[id]">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const order = await getOrder(id);
  if (!order) notFound();
  const method = order.payment_method as PaymentMethod;
  const state = order.payment_state as PaymentState;
  const items = (Array.isArray(order.items) ? order.items : []) as Item[];
  const offline = OFFLINE_METHODS.includes(method);
  const metadata = order.metadata && typeof order.metadata === "object" && !Array.isArray(order.metadata) ? (order.metadata as Record<string, unknown>) : {};

  return (
    <>
      <BrandHeader title={order.customer_name} subtitle={order.gallery_name ?? "Order"} backHref="/orders" />
      <PageBody className="max-w-2xl space-y-4">
        <section className="card p-4">
          <p className="eyebrow">Payment</p>
          <p className="mt-1 text-2xl font-black text-ink">{Number(order.amount_qr).toFixed(2)} {order.currency}</p>
          <p className="mt-1 text-sm font-semibold text-ink">{paymentLabel(method, state)}</p>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted">
            <dt>Method</dt><dd className="text-ink">{METHOD_LABEL[method] ?? method}</dd>
            {order.payment_reported_state && <><dt>Reported by Pic-Time</dt><dd className="text-ink">{order.payment_reported_state}</dd></>}
            {order.payment_reference && <><dt>Reference</dt><dd className="break-all text-ink">{order.payment_reference}</dd></>}
            {order.payment_confirmed_at && <><dt>Confirmed by you</dt><dd className="text-ink">{formatDateTime(order.payment_confirmed_at)}{typeof metadata.payment_confirmation_note === "string" && metadata.payment_confirmation_note ? ` — ${metadata.payment_confirmation_note}` : ""}</dd></>}
            {order.paid_at && !order.payment_confirmed_at && <><dt>Paid</dt><dd className="text-ink">{formatDateTime(order.paid_at)}</dd></>}
          </dl>
          {offline && state !== "paid" && order.status !== "cancelled" && (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">This order is paid outside Pic-Time ({METHOD_LABEL[method]}). The order notification is not proof of payment — confirm below once the money has arrived.</p>
          )}
          <OrderActions orderId={order.id} paymentState={state} status={order.status} offline={offline} />
        </section>

        <section className="card p-4">
          <p className="eyebrow">Buyer</p>
          <p className="mt-1 font-bold text-ink">{order.customer_name}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {order.customer_phone && <a href={`tel:${order.customer_phone}`} className="btn-secondary min-h-11">{order.customer_phone}</a>}
            {order.customer_email && <a href={`mailto:${order.customer_email}`} className="btn-secondary min-h-11">{order.customer_email}</a>}
          </div>
          {order.athlete_name_hint && <p className="mt-2 text-xs text-muted">Mentioned competitor: <span className="font-semibold text-ink">{order.athlete_name_hint}</span> (free text from the order; not linked to a tracked client)</p>}
          {order.buyer_note && <p className="mt-2 rounded-lg bg-page px-3 py-2 text-sm text-ink">“{order.buyer_note}”</p>}
        </section>

        <section className="card p-4">
          <p className="eyebrow">Items</p>
          {items.length === 0 ? (
            <p className="mt-1 text-sm text-muted">No line items were sent with this order.</p>
          ) : (
            <ul className="mt-2 divide-y divide-line text-sm">
              {items.map((it, i) => (
                <li key={i} className="flex items-center justify-between gap-3 py-2">
                  <span className="text-ink">{Number(it.quantity ?? 1)}× {String(it.name ?? "Item")}{it.sku ? <span className="text-xs text-muted"> · {String(it.sku)}</span> : null}</span>
                  <span className="tabular-nums text-muted">{typeof it.unitAmount === "number" ? `${it.unitAmount.toFixed(2)} ${order.currency}` : "—"}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card p-4 text-xs text-muted">
          <p className="eyebrow">Record</p>
          <dl className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1">
            <dt>Source</dt><dd className="text-ink">{order.source}{order.external_ref ? ` · ${order.external_ref}` : ""}</dd>
            <dt>Placed</dt><dd className="text-ink">{formatDateTime(order.placed_at ?? order.created_at)}</dd>
            <dt>Received</dt><dd className="text-ink">{formatDateTime(order.received_at ?? order.created_at)}</dd>
            <dt>Status</dt><dd className="text-ink">{order.status}{order.fulfilled_at ? ` · ${formatDateTime(order.fulfilled_at)}` : ""}</dd>
          </dl>
        </section>
      </PageBody>
    </>
  );
}
