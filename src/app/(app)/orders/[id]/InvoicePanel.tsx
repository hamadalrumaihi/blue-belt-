"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CopyButton } from "@/components/CopyButton";
import { CheckIcon, MailIcon, PhoneIcon, ReceiptIcon } from "@/components/icons";
import { markInvoiceSent } from "@/lib/actions/orders";
import type { InvoiceDraft, InvoiceNeed } from "@/lib/orders/invoice-draft";
import { formatStamp } from "@/lib/time";
import { cn } from "@/lib/utils";

type Props = { orderId: string; need: InvoiceNeed; draft: InvoiceDraft | null; draftText: string; sentAt: string | null; clientCheckFailed?: boolean };

const money = (n: number, cur: string) => `${n.toFixed(2)} ${cur}`;

/**
 * Invoice preparation for one order. The draft is for the owner: copy it, or
 * open your own email / WhatsApp with it filled in, then mark it sent. Nothing
 * here sends anything to the buyer by itself.
 */
export function InvoicePanel({ orderId, need, draft, draftText, sentAt, clientCheckFailed }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function setSent(sent: boolean) {
    setError(null);
    start(async () => {
      const res = await markInvoiceSent(orderId, sent);
      if (!res.ok) setError(res.error);
      else router.refresh();
    });
  }

  const status = statusOf(need, sentAt);

  return (
    <section className="card p-4" aria-labelledby="invoice-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="invoice-heading" className="eyebrow flex items-center gap-1.5"><ReceiptIcon size={14} /> Invoice</h2>
        <span className={cn("rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide", status.tone)}>{status.label}</span>
      </div>
      <p className="mt-2 text-sm text-ink">{status.detail}</p>
      {need.kind === "client" && (
        <Link href={`/clients/${need.match.athleteId}`} className="mt-1 inline-block text-sm font-semibold text-primary hover:underline">Open {need.match.name}’s client page</Link>
      )}
      {clientCheckFailed && need.kind === "draft" && (
        <p className="mt-2 text-xs text-muted">The client check failed when this order arrived, so Telegram had no draft. This draft uses your current client list.</p>
      )}

      {need.kind === "draft" && draft && (
        <>
          <div className="mt-3 rounded-xl border border-line">
            <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 border-b border-line px-3 py-2.5 text-xs">
              <div className="min-w-0">
                <p className="font-bold text-ink">Bill to {draft.billTo.name}</p>
                <p className="break-words text-muted">{[draft.billTo.email, draft.billTo.phone].filter(Boolean).join(" · ") || "No contact details on the order"}</p>
              </div>
              {draft.reference && <p className="font-mono text-muted">Pic-Time {draft.reference}</p>}
            </div>
            <table className="w-full text-sm">
              <caption className="sr-only">Invoice draft lines</caption>
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-muted">
                  <th scope="col" className="px-3 py-2 font-bold">Item</th>
                  <th scope="col" className="px-2 py-2 text-right font-bold">Qty</th>
                  <th scope="col" className="hidden px-2 py-2 text-right font-bold sm:table-cell">Unit</th>
                  <th scope="col" className="px-3 py-2 text-right font-bold">Amount</th>
                </tr>
              </thead>
              <tbody>
                {draft.lines.length === 0 ? (
                  <tr><td colSpan={4} className="px-3 py-2 text-muted">No line items came with the order.</td></tr>
                ) : (
                  draft.lines.map((l, i) => (
                    <tr key={i} className="border-b border-line last:border-0">
                      <td className="break-words px-3 py-2 text-ink">{l.description}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-muted">{l.quantity}</td>
                      <td className="hidden px-2 py-2 whitespace-nowrap text-right tabular-nums text-muted sm:table-cell">{l.unitAmount !== null ? money(l.unitAmount, draft.currency) : "—"}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-right tabular-nums text-ink">{l.amount !== null ? money(l.amount, draft.currency) : "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
              <tfoot>
                <tr className="border-t border-line bg-page">
                  <th scope="row" colSpan={2} className="px-3 py-2.5 text-left font-bold text-ink sm:hidden">Total due</th>
                  <th scope="row" colSpan={3} className="hidden px-3 py-2.5 text-left font-bold text-ink sm:table-cell">Total due</th>
                  <td className="px-3 py-2.5 whitespace-nowrap text-right font-black tabular-nums text-ink sm:hidden">{money(draft.total, draft.currency)}</td>
                  <td className="hidden px-3 py-2.5 whitespace-nowrap text-right font-black tabular-nums text-ink sm:table-cell">{money(draft.total, draft.currency)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          {!draft.linesMatchTotal && draft.lines.length > 0 && (
            <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">Check before sending: some item prices are missing or do not add up to the order total. The total is the amount Pic-Time sent.</p>
          )}

          <details className="mt-3 rounded-xl border border-line px-3 py-2">
            <summary className="cursor-pointer text-sm font-semibold text-ink">Preview the text you will send</summary>
            <pre className="mt-2 whitespace-pre-wrap break-words font-sans text-sm text-ink">{draftText}</pre>
          </details>

          <div className="mt-3 flex flex-wrap gap-2">
            <CopyButton value={draftText} label="Copy invoice text" copiedLabel="Invoice text copied" />
            {draft.billTo.email && (
              <a className="btn-secondary min-h-11" href={`mailto:${draft.billTo.email}?subject=${encodeURIComponent(`Invoice — Pic-Time order ${draft.reference ?? ""}`.trim())}&body=${encodeURIComponent(draftText)}`}>
                <MailIcon size={16} /> Open in email
              </a>
            )}
            {whatsappNumber(draft.billTo.phone) && (
              <a className="btn-secondary min-h-11" href={`https://wa.me/${whatsappNumber(draft.billTo.phone)}?text=${encodeURIComponent(draftText)}`} target="_blank" rel="noopener noreferrer">
                <PhoneIcon size={16} /> Open in WhatsApp
              </a>
            )}
          </div>
          <p className="hint mt-2">Email and WhatsApp open with the text filled in; nothing is sent until you press send there.</p>

          <div className="mt-3 border-t border-line pt-3">
            {sentAt ? (
              <button type="button" className="btn-ghost min-h-11" disabled={pending} onClick={() => setSent(false)}>Undo “invoice sent”</button>
            ) : (
              <button type="button" className="btn-primary min-h-11" disabled={pending} aria-busy={pending} onClick={() => setSent(true)}>
                <CheckIcon size={16} /> {pending ? "Saving…" : "Mark invoice sent"}
              </button>
            )}
            {error && <p className="mt-2 text-xs font-semibold text-danger" role="alert">{error}</p>}
          </div>
        </>
      )}
    </section>
  );
}

/** wa.me wants digits only with the country code; a bare 8-digit number is treated as Qatar (+974). */
function whatsappNumber(phone: string | null): string | null {
  const digits = (phone ?? "").replace(/\D/g, "").replace(/^00/, "");
  if (digits.length === 8) return `974${digits}`;
  return digits.length >= 10 ? digits : null;
}

function statusOf(need: InvoiceNeed, sentAt: string | null): { label: string; detail: string; tone: string } {
  switch (need.kind) {
    case "draft":
      return sentAt
        ? { label: "Sent by you", detail: `You marked the invoice sent ${formatStamp(sentAt)}. Confirm the payment above once the money arrives.`, tone: "bg-success-soft text-success" }
        : { label: "Draft ready · not sent", detail: "This buyer is not one of your clients. Review the draft, send it yourself, then mark it sent.", tone: "bg-amber-50 text-amber-800" };
    case "client":
      return { label: "Existing client", detail: `${need.match.name} is already a client (matched by ${need.match.by}), so no invoice draft was prepared.`, tone: "bg-lightblue text-primary" };
    case "card":
    case "paid":
      return { label: "Not needed", detail: "Paid, or paid by card through Pic-Time — invoicing would ask the buyer to pay twice.", tone: "bg-page text-muted border border-line" };
    case "closed":
      return { label: "Cancelled", detail: "This order is cancelled; no invoice is needed.", tone: "bg-page text-muted border border-line" };
    case "no_amount":
      return { label: "No amount", detail: "The order came without an amount, so no draft was made. Check the order in Pic-Time.", tone: "bg-amber-50 text-amber-800" };
  }
}
