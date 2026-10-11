"use client";

import { useState, useTransition } from "react";
import { ExternalIcon } from "@/components/icons";
import { startOrderPayment } from "@/lib/actions/pay";

type Props = { token: string; amountLabel: string };

/** "Pay online": asks the server for the secure payment page of this order and opens it. The amount is never sent from here. */
export function OrderPayButton({ token, amountLabel }: Props) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  function pay() {
    setError(null);
    start(async () => {
      const res = await startOrderPayment(token);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOpening(true);
      window.location.assign(res.redirectUrl);
    });
  }

  const busy = pending || opening;
  return (
    <div className="space-y-3">
      <button type="button" className="btn-primary min-h-12 w-full text-base" onClick={pay} disabled={busy} aria-busy={busy}>
        <ExternalIcon size={18} /> {opening ? "Opening secure payment..." : pending ? "Preparing secure payment..." : `Pay ${amountLabel} online`}
      </button>
      <p role="alert" aria-live="assertive" className="text-sm font-semibold text-danger">{error}</p>
    </div>
  );
}
