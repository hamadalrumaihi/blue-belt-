"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createTestOrder, setOrderInvoicingMode } from "@/lib/actions/orders";
import type { InvoiceMode } from "@/lib/orders/eligibility";
import type { OrderQueueOverview } from "@/lib/orders/queries";
import { formatStamp } from "@/lib/time";
import { cn } from "@/lib/utils";

export type InvoicingFlags = {
  /** PAYMENTS_MYFATOORAH_ENABLED=1 with credentials. */
  payments: boolean;
  /** The payment service points at its test environment. */
  sandbox: boolean;
  /** PAYMENTS_AUTO_INVOICE_ENABLED=1: the server lets automatic mode act. */
  autoSwitch: boolean;
  /** EMAIL_ENABLED=1 with a sender configured. */
  email: boolean;
  /** Test orders allowed (sandbox, or ORDERS_TEST_ORDERS_ENABLED=1). */
  testOrders: boolean;
};

export type RunnerView = { ranAt: string | null; age: string; ok: boolean; stale: boolean };

type Props = {
  mode: InvoiceMode;
  autoSince: string | null;
  flags: InvoicingFlags;
  queue: OrderQueueOverview;
  runners: { payments: RunnerView; deliveries: RunnerView };
};

/**
 * Owner-only control of how new photo orders are billed:
 *   Review    every order waits for "Send invoice" (Telegram or the order page)
 *   Automatic eligible NEW orders (received after the activation time) get
 *             their payment link and e-mail without the owner
 * Switching to Automatic stamps the activation time, so nothing that arrived
 * earlier (historical records, sample orders) is ever billed by the switch.
 */
export function OrdersInvoicingSettings({ mode, autoSince, flags, queue, runners }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [amount, setAmount] = useState("5");
  const [name, setName] = useState("Test buyer");

  const autoLive = mode === "auto" && flags.autoSwitch && flags.payments && flags.email;

  function run(what: string, action: () => Promise<{ ok: boolean; message?: string; error?: string }>) {
    setNotice(null);
    setBusy(what);
    start(async () => {
      const res = await action();
      setBusy(null);
      setNotice(res.ok ? { kind: "ok", text: res.message ?? "Saved." } : { kind: "error", text: res.error ?? "Something went wrong." });
      router.refresh();
    });
  }

  return (
    <section className="card space-y-4 p-5" aria-labelledby="orders-invoicing-heading">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="orders-invoicing-heading" className="text-base font-bold text-ink">Photo-order payment links</h2>
          <p className="mt-1 text-sm text-muted">When a gallery order is paid to you directly (not by card in the gallery), the app can create a private payment page and e-mail the buyer the link. You choose whether that happens by itself or after you press Send invoice.</p>
        </div>
        <span className={cn("shrink-0 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider", autoLive ? "bg-lightblue text-primary" : mode === "auto" ? "bg-amber-50 text-amber-800" : "bg-page text-muted")}>{mode === "auto" ? (autoLive ? "Automatic" : "Automatic (held)") : "Review"}</span>
      </div>

      <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Invoicing mode">
        <ModeButton active={mode === "review"} disabled={pending} busy={busy === "review"} title="Review" body="Every new order shows up in Telegram and under Orders with a Send invoice button. Nothing is e-mailed until you press it." onClick={() => run("review", () => setOrderInvoicingMode("review"))} />
        <ModeButton active={mode === "auto"} disabled={pending} busy={busy === "auto"} title="Automatic" body="New orders paid to you directly, with a buyer e-mail and an amount owed, get the payment link by themselves. Orders that arrived before you switch, card orders, paid, free and cancelled orders are never billed automatically." onClick={() => run("auto", () => setOrderInvoicingMode("auto"))} />
      </div>
      {mode === "auto" && (
        <p className="text-xs text-muted">Activation time: <span className="font-semibold text-ink">{autoSince ? formatStamp(autoSince) : "not recorded"}</span>. Only orders received after this moment are eligible; switching to Review and back resets it to now.</p>
      )}

      <div>
        <p className="label">Server switches</p>
        <ul className="mt-1 grid gap-1 text-sm sm:grid-cols-2">
          <Flag on={flags.payments} label="Online payments" hint={flags.payments ? (flags.sandbox ? "sandbox (test) environment" : "live environment") : "PAYMENTS_MYFATOORAH_ENABLED off: no links can be created"} />
          <Flag on={flags.autoSwitch} label="Automatic invoicing allowed" hint={flags.autoSwitch ? "PAYMENTS_AUTO_INVOICE_ENABLED=1" : "PAYMENTS_AUTO_INVOICE_ENABLED is off: Automatic mode waits for Send invoice"} />
          <Flag on={flags.email} label="Customer e-mail" hint={flags.email ? "EMAIL_ENABLED=1" : "EMAIL_ENABLED off: links are created but not e-mailed (needs attention)"} />
          <Flag on={flags.testOrders} label="Test orders" hint={flags.testOrders ? "allowed below" : "only against the sandbox, or ORDERS_TEST_ORDERS_ENABLED=1"} />
        </ul>
        {mode === "auto" && !autoLive && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">Automatic mode is selected but held by a server switch above. New orders are recorded and shown with a Send invoice button until every switch is on.</p>}
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-xl bg-page p-3 text-xs">
          <p className="font-semibold text-ink">Invoice queue</p>
          <p className="mt-1 text-ink">{queue.waiting ? `${queue.waiting} waiting${queue.oldestWaitingAt ? ` · oldest ${formatStamp(queue.oldestWaitingAt)}` : ""}` : "Nothing waiting"}</p>
          <p className={cn("mt-0.5", queue.exceptions || queue.emailFailed ? "font-semibold text-amber-800" : "text-muted")}>{queue.exceptions} need{queue.exceptions === 1 ? "s" : ""} attention · {queue.emailFailed} e-mail failed</p>
          {(queue.exceptions > 0 || queue.emailFailed > 0 || queue.waiting > 0) && <Link href="/orders?filter=attention" className="mt-1 inline-block font-semibold text-primary underline">Open the list</Link>}
        </div>
        <div className="rounded-xl bg-page p-3 text-xs">
          <p className="font-semibold text-ink">Background runners</p>
          <p className={cn("mt-1", runners.payments.stale ? "font-semibold text-amber-800" : "text-ink")}>Payments (links, retries, checks): {runners.payments.ranAt ? `${runners.payments.age}${runners.payments.ok ? "" : " · last run had errors"}` : "never ran"}</p>
          <p className={cn("mt-0.5", runners.deliveries.stale ? "font-semibold text-amber-800" : "text-ink")}>Deliveries (e-mail, Telegram): {runners.deliveries.ranAt ? `${runners.deliveries.age}${runners.deliveries.ok ? "" : " · last run had errors"}` : "never ran"}</p>
          <p className="mt-1 text-muted">Both are driven by the scheduler (docs/orders-invoicing.md, “Activation checklist”). A runner older than 30 minutes means queued links and e-mails are not moving.</p>
        </div>
      </div>

      <details className="rounded-xl border border-line p-3">
        <summary className="cursor-pointer text-sm font-semibold text-ink">Send a test order to yourself</summary>
        <p className="mt-2 text-xs text-muted">Creates an order marked “Test” for a buyer e-mail you control and runs the normal flow (payment page, invoice, e-mail, Telegram card). {flags.testOrders ? (flags.sandbox ? "The payment service is in sandbox mode, so no real money moves." : "Careful: online payments are LIVE; a test payment is a real charge.") : "Disabled: test orders are allowed only against the payment sandbox, or with ORDERS_TEST_ORDERS_ENABLED=1."} Historical customers are never used for tests.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
          <label className="block text-xs">
            <span className="mb-1 block font-semibold text-ink">Your test e-mail</span>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" disabled={pending || !flags.testOrders} />
          </label>
          <label className="block text-xs">
            <span className="mb-1 block font-semibold text-ink">Buyer name</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} disabled={pending || !flags.testOrders} />
          </label>
          <label className="block text-xs">
            <span className="mb-1 block font-semibold text-ink">Amount (QAR)</span>
            <input className="input w-24" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={pending || !flags.testOrders} />
          </label>
          <button type="button" className="btn-secondary min-h-11" disabled={pending || !flags.testOrders} aria-busy={busy === "test"} onClick={() => run("test", async () => {
            const res = await createTestOrder({ email, amount: Number(amount), name });
            return res.ok ? { ok: true, message: `Test order created. ${mode === "auto" && autoLive ? "Its payment link is being created and e-mailed now." : "Open it under Orders and press Send invoice."}` } : res;
          })}>{busy === "test" ? "Creating…" : "Create test order"}</button>
        </div>
      </details>

      {notice && <p className={cn("text-xs font-semibold", notice.kind === "ok" ? "text-success" : "text-danger")} role={notice.kind === "ok" ? "status" : "alert"}>{notice.text}</p>}
    </section>
  );
}

function ModeButton({ active, disabled, busy, title, body, onClick }: { active: boolean; disabled: boolean; busy: boolean; title: string; body: string; onClick: () => void }) {
  return (
    <button type="button" role="radio" aria-checked={active} disabled={disabled || active} aria-busy={busy} onClick={onClick} className={cn("rounded-xl border p-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-default", active ? "border-primary bg-lightblue/40" : "border-line bg-white hover:bg-page disabled:opacity-60")}>
      <p className="flex items-center gap-2 text-sm font-extrabold text-ink"><span className={cn("inline-block h-3 w-3 rounded-full border-2", active ? "border-primary bg-primary" : "border-line")} aria-hidden />{title}{busy ? " …" : ""}</p>
      <p className="mt-1 text-xs text-muted">{body}</p>
    </button>
  );
}

function Flag({ on, label, hint }: { on: boolean; label: string; hint: string }) {
  return (
    <li className="flex items-start gap-2 rounded-lg border border-line px-3 py-2">
      <span className={cn("mt-1 inline-block h-2.5 w-2.5 shrink-0 rounded-full", on ? "bg-success" : "bg-line")} aria-hidden />
      <span><span className="font-semibold text-ink">{label}: {on ? "on" : "off"}</span><br /><span className="text-xs text-muted">{hint}</span></span>
    </li>
  );
}
