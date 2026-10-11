"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CopyButton } from "@/components/CopyButton";
import { CheckIcon, MailIcon, ReceiptIcon, RefreshIcon, SendIcon } from "@/components/icons";
import { checkOrderPayment, markOrderDone, resendOrderInvoice, sendOrderInvoice } from "@/lib/actions/orders";
import { EXCEPTION_LABEL, isInvoiceExceptionReason } from "@/lib/orders/eligibility";
import { formatStamp } from "@/lib/time";
import { cn } from "@/lib/utils";

export type OrderInvoiceCardProps = {
  orderId: string;
  paymentState: string;
  status: string;
  amountQr: number;
  currency: string;
  paymentMethod: string;
  customerEmail: string | null;
  payUrl: string | null;
  hasInvoice: boolean;
  requestedAt: string | null;
  requestedBy: string | null;
  emailState: string;
  emailUpdatedAt: string | null;
  emailCount: number;
  exception: string | null;
  jobError: string | null;
  nextAttemptAt: string | null;
  paymentsEnabled: boolean;
  /** How this owner's new orders are handled (shown as context). */
  mode: "auto" | "review";
  providerConfirmed: boolean;
};

type Tone = { label: string; detail: string; tone: string };

/**
 * The payment-link workflow for one order, driving the same services as the
 * Telegram buttons: Send invoice (create link + invoice once, queue the
 * e-mail), Resend / Retry e-mail (same link, never a second invoice), Check
 * payment (ask the provider), Done (photos released by hand). Every state
 * the Telegram card can show is shown here too.
 */
export function OrderInvoiceCard(p: OrderInvoiceCardProps) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  function run(name: string, action: () => Promise<{ ok: boolean; message?: string; error?: string }>) {
    setNotice(null);
    setBusy(name);
    start(async () => {
      const res = await action();
      setBusy(null);
      setNotice(res.ok ? { kind: "ok", text: res.message ?? "Done." } : { kind: "error", text: res.error ?? "Something went wrong." });
      router.refresh();
    });
  }

  const closed = p.status === "cancelled" || p.paymentState === "refunded";
  const paid = p.paymentState === "paid";
  const outstanding = !closed && !paid && p.amountQr > 0;
  const card = p.paymentMethod === "card";
  const s = stateOf(p);

  return (
    <section className="card p-4" aria-labelledby="order-invoice-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="order-invoice-heading" className="eyebrow flex items-center gap-1.5"><ReceiptIcon size={14} /> Payment link</h2>
        <span className={cn("rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide", s.tone)}>{s.label}</span>
      </div>
      <p className="mt-2 text-sm text-ink">{s.detail}</p>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted">
        <dt>Mode</dt><dd className="text-ink">{p.mode === "auto" ? "Automatic for new orders" : "Review (you press Send invoice)"}</dd>
        {p.requestedAt && <><dt>Requested</dt><dd className="text-ink">{formatStamp(p.requestedAt)}{p.requestedBy ? ` · ${requestedByLabel(p.requestedBy)}` : ""}</dd></>}
        {p.emailState !== "none" && <><dt>Customer e-mail</dt><dd className="text-ink">{emailStateLabel(p.emailState)}{p.emailCount > 1 ? ` (${p.emailCount} sent)` : ""}{p.emailUpdatedAt ? ` · ${formatStamp(p.emailUpdatedAt)}` : ""}{p.customerEmail ? ` · ${p.customerEmail}` : ""}</dd></>}
        {p.nextAttemptAt && !paid && <><dt>Next automatic try</dt><dd className="text-ink">{formatStamp(p.nextAttemptAt)}{p.jobError ? ` · ${p.jobError}` : ""}</dd></>}
      </dl>

      {p.payUrl && outstanding && (
        <div className="mt-3 rounded-lg bg-page px-3 py-2 text-xs text-muted">
          <p>Private payment page: <a href={p.payUrl} target="_blank" rel="noopener noreferrer" className="break-all font-semibold text-primary underline">{p.payUrl}</a></p>
          <div className="mt-2"><CopyButton value={p.payUrl} label="Copy link" copiedLabel="Link copied" /></div>
          <p className="mt-1">Shows the order reference, items and the amount; the buyer pays online and the order is marked paid only after the payment is verified.</p>
        </div>
      )}

      {outstanding && !card && (
        <div className="mt-3 flex flex-wrap gap-2">
          {!p.hasInvoice || p.exception ? (
            <button type="button" className="btn-primary min-h-11" disabled={pending || !p.paymentsEnabled} aria-busy={busy === "send"} onClick={() => run("send", () => sendOrderInvoice(p.orderId))}>
              <SendIcon size={16} /> {busy === "send" ? "Creating…" : p.exception ? "Send invoice (retry)" : "Send invoice"}
            </button>
          ) : (
            <button type="button" className="btn-secondary min-h-11" disabled={pending} aria-busy={busy === "resend"} onClick={() => run("resend", () => resendOrderInvoice(p.orderId))}>
              <MailIcon size={16} /> {busy === "resend" ? "Queuing…" : p.emailState === "failed" || p.emailState === "exception" ? "Retry e-mail" : "Resend e-mail"}
            </button>
          )}
          {p.hasInvoice && (
            <button type="button" className="btn-secondary min-h-11" disabled={pending || !p.paymentsEnabled} aria-busy={busy === "check"} onClick={() => run("check", () => checkOrderPayment(p.orderId))}>
              <RefreshIcon size={16} /> {busy === "check" ? "Checking…" : "Check payment"}
            </button>
          )}
        </div>
      )}
      {outstanding && !card && !p.paymentsEnabled && <p className="mt-2 text-xs font-semibold text-amber-800">Online payments are not configured on the server, so no payment link can be created yet.</p>}

      {paid && p.status !== "fulfilled" && (
        <div className="mt-3">
          <button type="button" className="btn-primary min-h-11" disabled={pending} aria-busy={busy === "done"} onClick={() => run("done", () => markOrderDone(p.orderId))}>
            <CheckIcon size={16} /> {busy === "done" ? "Saving…" : "Done: photos released in the gallery"}
          </button>
          <p className="hint mt-1">Release the purchased photos in your gallery by hand, then record it here. Nothing is released automatically.</p>
        </div>
      )}

      {notice && <p className={cn("mt-3 text-xs font-semibold", notice.kind === "ok" ? "text-success" : "text-danger")} role={notice.kind === "ok" ? "status" : "alert"}>{notice.text}</p>}
    </section>
  );
}

function requestedByLabel(by: string): string {
  if (by === "auto") return "automatically";
  if (by.startsWith("telegram:")) return "from Telegram";
  if (by.startsWith("owner:")) return "by you";
  return by;
}

function emailStateLabel(state: string): string {
  switch (state) {
    case "queued":
      return "Queued";
    case "sent":
      return "Sent";
    case "failed":
      return "Failed";
    case "exception":
      return "Not sent";
    default:
      return "Not sent";
  }
}

function stateOf(p: OrderInvoiceCardProps): Tone {
  if (p.status === "cancelled") return { label: "Cancelled", detail: "This order is cancelled; no payment link is offered.", tone: "bg-page text-muted border border-line" };
  if (p.paymentState === "refunded") return { label: "Refunded", detail: "This payment was refunded.", tone: "bg-page text-muted border border-line" };
  if (p.paymentState === "paid") return { label: p.providerConfirmed ? "Paid online" : "Paid", detail: p.providerConfirmed ? "Verified by the payment service." : "Confirmed by you.", tone: "bg-success-soft text-success" };
  if (!(p.amountQr > 0)) return { label: "Nothing to pay", detail: "The order came with no amount, so there is nothing to bill.", tone: "bg-page text-muted border border-line" };
  if (p.paymentMethod === "card") return { label: "Not needed", detail: "Paid by card in the gallery. A payment link would ask the buyer to pay twice.", tone: "bg-page text-muted border border-line" };
  if (p.exception) {
    const why = isInvoiceExceptionReason(p.exception) ? EXCEPTION_LABEL[p.exception] : p.exception;
    return { label: "Needs attention", detail: `The payment link could not be sent: ${why}. ${p.payUrl ? "You can copy the link below and share it yourself, or fix the cause and press Send invoice." : "Fix the cause and press Send invoice."}`, tone: "bg-amber-50 text-amber-800" };
  }
  switch (p.emailState) {
    case "sent":
      return { label: "Link e-mailed", detail: "The buyer has the private payment link. Press Check payment to ask the payment service now, or wait for the automatic confirmation.", tone: "bg-lightblue text-primary" };
    case "queued":
      return { label: "E-mail queued", detail: "The payment link and invoice exist; the e-mail goes out on the next delivery tick and this changes to Sent.", tone: "bg-lightblue text-primary" };
    case "failed":
      return { label: "E-mail failed", detail: "Every attempt to deliver the e-mail failed. Retry, or share the link yourself.", tone: "bg-danger-soft text-danger" };
    default:
      if (p.requestedAt) return { label: "Queued", detail: "The invoice job is queued and runs on the next payments tick (or press Send invoice to run it now).", tone: "bg-lightblue text-primary" };
      return { label: "Not sent", detail: p.mode === "auto" ? "This order was not billed automatically (it arrived before automatic mode was switched on, or online payments were off). Press Send invoice to e-mail the payment link." : "Press Send invoice to create the private payment link and e-mail it to the buyer.", tone: "bg-amber-50 text-amber-800" };
  }
}
