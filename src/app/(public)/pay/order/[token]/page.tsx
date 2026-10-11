import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { CheckIcon, ClockIcon, ShieldIcon } from "@/components/icons";
import { formatMoney } from "@/lib/bookings/state";
import { createLogger } from "@/lib/log";
import { getPaymentsConfig, isPaymentsEnabled } from "@/lib/payments/config";
import { createMyFatoorahClient } from "@/lib/payments/myfatoorah/client";
import { loadOrderPay, verifyReturnedOrderPayment, type OrderPayDeps, type OrderPayView, type OrderVerifyResult } from "@/lib/payments/order-pay";
import { isOrderPayTokenShape } from "@/lib/payments/pay-token";
import { rateLimit, RULES } from "@/lib/rate-limit";
import { siteUrl } from "@/lib/studio/queries";
import { createServiceClient, isServiceClientConfigured } from "@/lib/supabase/service";
import { formatDateTime } from "@/lib/time";
import { OrderPayButton } from "./OrderPayButton";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Pay online", robots: { index: false, follow: false } };

/**
 * The page a buyer opens from the payment-link e-mail for a photo order from
 * their private gallery. No account needed: the token is the credential.
 * Everything shown comes from the order row; the query string only decides
 * whether to ask the provider about a returned payment.
 */
export default async function OrderPayPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ token }, query, h] = await Promise.all([params, searchParams, headers()]);
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
  const limit = rateLimit(`pay-page:${ip}`, RULES.signPerIp);
  if (!limit.ok) return <Notice title="Too many requests" text={`Please wait ${Math.ceil(limit.retryAfterSeconds / 60)} minutes and open the link again.`} />;
  if (!isOrderPayTokenShape(token) || !isServiceClientConfigured()) return <Notice title="This payment link is not valid" text="Check that the whole link was copied, or ask the studio to send it again." />;

  const enabled = isPaymentsEnabled();
  const config = getPaymentsConfig();
  const deps: OrderPayDeps = {
    supabase: createServiceClient(),
    now: () => new Date(),
    log: createLogger({ route: "public/pay-order" }),
    provider: enabled ? createMyFatoorahClient({ apiKey: config.apiKey, baseUrl: config.baseUrl }) : null,
    enabled,
    siteUrl: siteUrl(),
  };

  const result = one(query.result);
  const paymentId = one(query.paymentId);
  let verified: OrderVerifyResult | null = null;
  if (result === "callback" && paymentId) verified = await verifyReturnedOrderPayment(token, paymentId, deps);

  const loaded = await loadOrderPay(token, deps);
  if (!loaded.ok) return <Notice title="This payment link is not valid" text="Check that the whole link was copied, or ask the studio to send it again." />;
  const { view, studioName } = loaded;
  const paid = view.state === "paid";
  const amountLabel = formatMoney(view.amountQr, view.currency);

  return (
    <main className="bg-page">
      <div className="mx-auto w-full max-w-xl px-4 py-8 sm:py-12">
        <header className="mb-5">
          <p className="eyebrow">{studioName}</p>
          <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-navy sm:text-3xl">{paid ? "Payment confirmed" : "Pay online"}</h1>
          <p className="mt-1 text-sm text-muted">Hi {view.customerFirstName}. This page is for your photo order{view.reference ? ` ${view.reference}` : ""} from your private gallery.</p>
        </header>

        {verified && <ReturnNotice verified={verified} />}
        {result === "error" && !paid && (
          <div className="mb-5 rounded-2xl border border-warning/30 bg-warning-soft p-4 text-sm text-ink" role="status">
            <p className="font-bold text-warning">Payment not completed.</p>
            <p className="mt-1">The payment was cancelled or declined. Nothing has been charged. You can try again below.</p>
          </div>
        )}

        <section className="card p-5 sm:p-6" aria-labelledby="order-summary">
          <h2 id="order-summary" className="sr-only">Order summary</h2>
          <dl className="divide-y divide-line text-sm">
            {view.reference && <Row label="Order reference" value={<span className="font-mono font-bold">{view.reference}</span>} />}
            {view.galleryName && <Row label="Private gallery" value={view.galleryName} />}
            {view.items.length > 0 && (
              <Row
                label="Items"
                value={
                  <ul className="space-y-0.5">
                    {view.items.map((it, i) => (
                      <li key={i}>{it.quantity}× {it.name}</li>
                    ))}
                  </ul>
                }
              />
            )}
            <Row label={paid ? "Amount paid" : "Amount due"} value={<span className="text-xl font-black text-navy">{amountLabel}</span>} />
            <Row label="Status" value={statusText(view)} />
          </dl>

          <div className="mt-6">
            {paid ? (
              <div className="flex items-start gap-3 rounded-2xl border border-success/30 bg-success-soft p-4 text-sm text-ink" role="status">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-success"><CheckIcon size={20} /></span>
                <div>
                  <p className="font-bold text-success">Payment confirmed.</p>
                  <p className="mt-1">We have received your payment{view.paidAt ? ` on ${formatDateTime(view.paidAt)} Qatar time` : ""}. Your purchased photos are being prepared in your private gallery. Thank you.</p>
                </div>
              </div>
            ) : view.state === "refunded" ? (
              <p className="rounded-2xl border border-line bg-page p-4 text-sm text-ink">This payment was refunded. Contact {studioName} if you expected something else.</p>
            ) : view.state === "cancelled" ? (
              <p className="rounded-2xl border border-line bg-page p-4 text-sm text-ink">This payment link is no longer active. If you still have something to pay, {studioName} will send you a new link.</p>
            ) : view.state === "expired" ? (
              <p className="rounded-2xl border border-line bg-page p-4 text-sm text-ink">This payment link has expired. Ask {studioName} for a new link. Nothing has been charged.</p>
            ) : view.state === "payments_off" ? (
              <div className="flex items-start gap-3 rounded-2xl border border-line bg-page p-4 text-sm text-ink" role="status">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-muted"><ClockIcon size={20} /></span>
                <p>Online payment is being set up. We will send you the link when it is ready.</p>
              </div>
            ) : (
              <OrderPayButton token={token} amountLabel={amountLabel} />
            )}
          </div>
        </section>

        <p className="mt-6 flex items-start gap-2 text-xs text-muted"><ShieldIcon size={14} className="mt-0.5 shrink-0" /> Secure online payment by card. Your order is marked paid only after the payment is confirmed to us, and your photos are released after that.</p>
        <p className="mt-2 text-xs text-muted">Questions? Contact {studioName} before paying. <Link href="/" className="font-semibold text-primary hover:underline">Back to the website</Link></p>
      </div>
    </main>
  );
}

function statusText(view: OrderPayView): string {
  switch (view.state) {
    case "paid":
      return `Paid${view.paidAt ? ` on ${formatDateTime(view.paidAt)} Qatar time` : ""}`;
    case "refunded":
      return "Refunded";
    case "cancelled":
      return "Link no longer active";
    case "expired":
      return "Link expired";
    case "failed":
      return "Not paid yet. The last attempt did not complete.";
    case "payments_off":
      return "Not paid yet";
    default:
      return "Not paid yet";
  }
}

function one(v: string | string[] | undefined): string | null {
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === "string" && s.trim() ? s.trim().slice(0, 80) : null;
}

function ReturnNotice({ verified }: { verified: OrderVerifyResult }) {
  switch (verified.status) {
    case "paid":
      return null;
    case "pending":
      return (
        <div className="mb-5 rounded-2xl border border-primary/20 bg-lightblue p-4 text-sm text-ink" role="status">
          <p className="font-bold text-primary">Your payment is being confirmed.</p>
          <p className="mt-1">This page updates as soon as confirmation is received; you will also get an e-mail. Do not pay again.</p>
        </div>
      );
    case "failed":
      return (
        <div className="mb-5 rounded-2xl border border-warning/30 bg-warning-soft p-4 text-sm text-ink" role="status">
          <p className="font-bold text-warning">Payment not completed.</p>
          <p className="mt-1">Your bank or card declined the payment. Nothing has been charged. You can try again below.</p>
        </div>
      );
    case "mismatch":
      return (
        <div className="mb-5 rounded-2xl border border-danger/30 bg-danger-soft p-4 text-sm text-ink" role="alert">
          <p className="font-bold text-danger">We could not match this payment to your order.</p>
          <p className="mt-1">The studio has been told and will check it. Do not pay again; contact the studio if you are unsure.</p>
        </div>
      );
    case "provider_error":
    case "unavailable":
      return (
        <div className="mb-5 rounded-2xl border border-line bg-page p-4 text-sm text-ink" role="status">
          <p className="font-bold">We could not check your payment just now.</p>
          <p className="mt-1">If you completed the payment, your order will be marked paid as soon as confirmation is received. Reload this page in a minute.</p>
        </div>
      );
    default:
      return null;
  }
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="min-w-0 break-words text-right text-ink">{value}</dd>
    </div>
  );
}

function Notice({ title, text }: { title: string; text: string }) {
  return (
    <main className="bg-page">
      <div className="mx-auto w-full max-w-md px-4 py-16 text-center">
        <h1 className="text-xl font-extrabold text-ink">{title}</h1>
        <p className="mt-2 text-sm text-muted">{text}</p>
        <Link href="/" className="btn-secondary mt-6 min-h-11">Back to home</Link>
      </div>
    </main>
  );
}
