"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { cancelOrder, confirmOrderPayment, markOrderFulfilled, requestOrderInvoice } from "@/lib/actions/orders";

type Props = { orderId: string; paymentState: string; status: string; offline: boolean; paymentsEnabled?: boolean; hasInvoice?: boolean };

/** Owner bookkeeping for one order: create a payment invoice, confirm an offline payment, mark fulfilled, cancel. */
export function OrderActions({ orderId, paymentState, status, offline, paymentsEnabled = false, hasInvoice = false }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);

  function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await action();
      if (!res.ok) setError(res.error ?? "Something went wrong");
      else router.refresh();
    });
  }

  if (status === "cancelled") return <p className="mt-3 text-xs font-semibold text-muted">Cancelled.</p>;

  const canInvoice = paymentsEnabled && !hasInvoice && paymentState !== "paid" && paymentState !== "refunded";

  return (
    <div className="mt-3 space-y-2">
      {canInvoice && (
        <button type="button" className="btn-secondary min-h-11" disabled={pending} onClick={() => run(() => requestOrderInvoice(orderId))}>Create MyFatoorah payment invoice</button>
      )}
      {paymentState !== "paid" && paymentState !== "refunded" && (
        confirming ? (
          <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto] sm:items-end">
            <label className="block text-xs">
              <span className="mb-1 block font-semibold text-ink">Note (optional, e.g. Fawran reference)</span>
              <input className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
            </label>
            <button type="button" className="btn-primary min-h-11" disabled={pending} onClick={() => run(() => confirmOrderPayment(orderId, note))}>Confirm payment received</button>
            <button type="button" className="btn-ghost min-h-11" disabled={pending} onClick={() => setConfirming(false)}>Cancel</button>
          </div>
        ) : (
          <button type="button" className="btn-primary min-h-11" disabled={pending} onClick={() => setConfirming(true)}>{offline ? "Payment received — confirm" : "Mark as paid"}</button>
        )
      )}
      <div className="flex flex-wrap gap-2">
        {status === "fulfilled" ? (
          <button type="button" className="btn-secondary min-h-11" disabled={pending} onClick={() => run(() => markOrderFulfilled(orderId, false))}>Undo fulfilled</button>
        ) : (
          <button type="button" className="btn-secondary min-h-11" disabled={pending} onClick={() => run(() => markOrderFulfilled(orderId, true))}>Mark fulfilled</button>
        )}
        <button type="button" className="btn-ghost min-h-11 text-danger" disabled={pending} onClick={() => { if (confirm("Cancel this order record? Prices and the Pic-Time order itself are not changed.")) run(() => cancelOrder(orderId)); }}>Cancel order</button>
      </div>
      {error && <p className="text-xs font-semibold text-danger" role="alert">{error}</p>}
    </div>
  );
}
