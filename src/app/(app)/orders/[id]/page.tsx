import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BrandHeader } from "@/components/BrandHeader";
import { PageBody } from "@/components/AppShell";
import { METHOD_LABEL, OFFLINE_METHODS, paymentLabel, type PaymentMethod, type PaymentState } from "@/lib/orders/contract";
import { readOrderInvoicing } from "@/lib/orders/eligibility";
import { buildInvoiceDraft, draftOrderOf, invoiceDraftText, invoiceNeed, invoiceSentAt, matchClient } from "@/lib/orders/invoice-draft";
import { getOrder, listClientContacts } from "@/lib/orders/queries";
import { isPaymentsEnabled } from "@/lib/payments/config";
import { loadStudio } from "@/lib/studio/queries";
import { formatStamp } from "@/lib/time";
import { isUuid } from "@/lib/validation";
import { InvoicePanel } from "./InvoicePanel";
import { OrderActions } from "./OrderActions";
import { OrderInvoiceCard } from "./OrderInvoiceCard";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/orders/[id]">): Promise<Metadata> {
  const { id } = await params;
  const order = isUuid(id) ? await getOrder(id) : null;
  return { title: order ? `Order: ${order.customer_name}` : "Order" };
}

const STATUS_LABEL: Record<string, string> = { placed: "Open", fulfilled: "Done, photos delivered", cancelled: "Cancelled" };
const REPORTED_LABEL: Record<string, string> = { paid: "Approved / paid", pending: "Pending", failed: "Failed", refunded: "Refunded", unknown: "Unknown" };

type Item = { name?: unknown; quantity?: unknown; unitAmount?: unknown; sku?: unknown };

export default async function OrderDetailPage({ params }: PageProps<"/orders/[id]">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const [order, clients, studio] = await Promise.all([getOrder(id), listClientContacts(), loadStudio()]);
  if (!order) notFound();
  const method = order.payment_method as PaymentMethod;
  const state = order.payment_state as PaymentState;
  const items = (Array.isArray(order.items) ? order.items : []) as Item[];
  const offline = OFFLINE_METHODS.includes(method);
  const metadata = order.metadata && typeof order.metadata === "object" && !Array.isArray(order.metadata) ? (order.metadata as Record<string, unknown>) : {};
  const client = matchClient({ email: order.customer_email, phone: order.customer_phone }, clients);
  const draftInput = draftOrderOf(order);
  const need = invoiceNeed(draftInput, client);
  const draft = need.kind === "draft" || need.kind === "client" ? buildInvoiceDraft(draftInput) : null;
  const providerConfirmed = state === "paid" && metadata.payment_confirmed_source === "MYFATOORAH";
  const outstanding = state !== "paid" && state !== "refunded" && order.status !== "cancelled";
  const payUrl = order.pay_token_hash && order.payment_url ? order.payment_url : null;
  const mismatch = metadata.payment_mismatch && typeof metadata.payment_mismatch === "object" ? (metadata.payment_mismatch as Record<string, unknown>) : null;
  const invoicing = readOrderInvoicing(studio?.settings ?? null);

  return (
    <>
      <BrandHeader title={order.customer_name} subtitle={order.gallery_name ?? "Order"} backHref="/orders" />
      <PageBody className="max-w-2xl space-y-4">
        <section className="card p-4">
          <p className="eyebrow">Payment</p>
          <p className="mt-1 text-2xl font-black text-ink">{Number(order.amount_qr).toFixed(2)} {order.currency}</p>
          <p className="mt-1 text-sm font-semibold text-ink">{providerConfirmed ? "Paid online (verified by the payment service)" : paymentLabel(method, state)}</p>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted">
            <dt>Method</dt><dd className="text-ink">{METHOD_LABEL[method] ?? method}</dd>
            {order.payment_reported_state && <><dt>Pic-Time said</dt><dd className="text-ink">{REPORTED_LABEL[order.payment_reported_state] ?? order.payment_reported_state}{order.payment_reported_state === "paid" && offline ? " (not proof of money for a direct payment)" : ""}</dd></>}
            {order.payment_reference && <><dt>Reference</dt><dd className="break-all text-ink">{order.payment_reference}</dd></>}
            {order.payment_confirmed_at && !providerConfirmed && <><dt>Confirmed by you</dt><dd className="text-ink">{formatStamp(order.payment_confirmed_at)}{typeof metadata.payment_confirmation_note === "string" && metadata.payment_confirmation_note ? ` · ${metadata.payment_confirmation_note}` : ""}</dd></>}
            {order.paid_at && providerConfirmed && <><dt>Paid</dt><dd className="text-ink">{formatStamp(order.paid_at)}</dd></>}
          </dl>
          {offline && outstanding && (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">This order is paid to you directly ({METHOD_LABEL[method]}). The gallery notification is not proof of payment: send the payment link below, or confirm by hand once the money has arrived.</p>
          )}
          {mismatch && (
            <p className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-xs font-semibold text-danger">A payment reported by the payment service did not match this order ({String(mismatch.reason ?? "mismatch")}). It was NOT marked paid. Check your provider dashboard before confirming anything by hand.</p>
          )}
          <OrderActions orderId={order.id} paymentState={state} status={order.status} offline={offline} />
        </section>

        <OrderInvoiceCard
          orderId={order.id}
          paymentState={state}
          status={order.status}
          amountQr={Number(order.amount_qr)}
          currency={order.currency}
          paymentMethod={method}
          customerEmail={order.customer_email}
          payUrl={payUrl}
          hasInvoice={Boolean(order.provider_invoice_id)}
          requestedAt={order.invoice_requested_at}
          requestedBy={order.invoice_requested_by}
          emailState={order.invoice_email_state}
          emailUpdatedAt={order.invoice_email_updated_at}
          emailCount={order.invoice_email_count}
          exception={order.invoice_exception}
          jobError={order.invoice_job_error}
          nextAttemptAt={order.invoice_next_attempt_at}
          paymentsEnabled={isPaymentsEnabled()}
          mode={invoicing.mode}
          providerConfirmed={providerConfirmed}
        />

        {outstanding && draft && (
          <InvoicePanel orderId={order.id} need={need.kind === "client" ? { kind: "draft" } : need} draft={draft} draftText={invoiceDraftText(draft, { payUrl })} sentAt={invoiceSentAt(order.metadata)} clientCheckFailed={metadata.client_check === "failed"} />
        )}

        <section className="card p-4">
          <p className="eyebrow">Buyer</p>
          <p className="mt-1 font-bold text-ink">{order.customer_name}{need.kind === "client" ? <span className="ml-2 rounded bg-lightblue px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary">Existing client</span> : null}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {order.customer_phone && <a href={`tel:${order.customer_phone}`} className="btn-secondary min-h-11">{order.customer_phone}</a>}
            {order.customer_email && <a href={`mailto:${order.customer_email}`} className="btn-secondary min-h-11">{order.customer_email}</a>}
            {!order.customer_email && <span className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">No e-mail address on the order. Add it in the gallery for the next order; share the payment link yourself for this one.</span>}
          </div>
          {order.athlete_name_hint && <p className="mt-2 text-xs text-muted">Mentioned competitor: <span className="font-semibold text-ink">{order.athlete_name_hint}</span> (free text from the order; not linked to a tracked client)</p>}
          {order.buyer_note && <p className="mt-2 rounded-lg bg-page px-3 py-2 text-sm text-ink">“{order.buyer_note}”</p>}
        </section>

        <section className="card p-4">
          <p className="eyebrow">Items</p>
          {items.length === 0 ? (
            <p className="mt-1 text-sm text-muted">No line items were sent with this order (the Zap does not map them yet). The payment page shows the total only.</p>
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
            <dt>Source</dt><dd className="break-all text-ink">{order.source === "pictime" ? "Pic-Time" : order.source === "test" ? "Test order" : order.source}{order.external_ref ? ` · ${order.external_ref}` : ""}</dd>
            <dt>Placed</dt><dd className="text-ink">{formatStamp(order.placed_at ?? order.created_at)}</dd>
            <dt>Received</dt><dd className="text-ink">{formatStamp(order.received_at ?? order.created_at)}</dd>
            <dt>Status</dt><dd className="text-ink">{STATUS_LABEL[order.status] ?? order.status}{order.fulfilled_at ? ` · ${formatStamp(order.fulfilled_at)}` : ""}</dd>
            {order.provider_invoice_id && <><dt>Invoice</dt><dd className="text-ink">created{order.pay_token_created_at ? ` · link ${formatStamp(order.pay_token_created_at)}` : ""}</dd></>}
          </dl>
        </section>
      </PageBody>
    </>
  );
}
