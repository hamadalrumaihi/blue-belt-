"use client";

import Script from "next/script";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { CreditCardIcon, ExternalIcon, ShieldIcon } from "@/components/icons";
import { executeCardPayment, startCardSession, startHostedPayment } from "@/lib/actions/pay";

type Props = { token: string; amountLabel: string; businessName: string };

type Session = { sessionId: string; countryCode: string; scriptUrl: string };
type Phase = "starting" | "loading" | "ready" | "submitting" | "redirecting" | "failed";

/** The global the provider's card-view script installs (embedded payment form). */
type ProviderCardView = {
  init(config: { countryCode: string; sessionId: string; cardViewId: string; supportedNetworks?: string; onCardBinChanged?: (bin: string) => void; style?: Record<string, unknown> }): void;
  submit(): Promise<{ sessionId: string; cardBrand?: string; cardIdentifier?: string }>;
};

declare global {
  interface Window {
    myFatoorah?: ProviderCardView;
  }
}

const CARD_VIEW_ID = "card-element";
/** If the card fields are not up by then, offer the secure payment page instead of a blank box. */
const LOAD_TIMEOUT_MS = 12_000;
const FORM_FAILED = "The card form did not load. You can use the secure payment page instead.";

/**
 * Embedded card view. The browser only ever holds a session id: the server
 * opens the session, the provider script renders the card fields inside
 * `#card-element`, and on "Pay" the session goes back to the server, which
 * charges the payment request's own amount and returns the 3-D Secure page.
 */
export function PayCard({ token, amountLabel, businessName }: Props) {
  const [phase, setPhase] = useState<Phase>("starting");
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hostedPending, startHosted] = useTransition();
  const initialised = useRef(false);
  const timeout = useRef<number | null>(null);

  const fail = useCallback((message: string) => {
    setError(message);
    setPhase("failed");
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await startCardSession(token);
      if (cancelled) return;
      if (!res.ok) {
        fail(res.error);
        return;
      }
      setSession({ sessionId: res.sessionId, countryCode: res.countryCode, scriptUrl: res.scriptUrl });
      setPhase("loading");
      timeout.current = window.setTimeout(() => {
        if (!initialised.current) fail(FORM_FAILED);
      }, LOAD_TIMEOUT_MS);
    })();
    return () => {
      cancelled = true;
      if (timeout.current) window.clearTimeout(timeout.current);
    };
  }, [token, fail]);

  const initCardView = useCallback(() => {
    if (!session || initialised.current) return;
    const mf = window.myFatoorah;
    if (!mf) {
      fail(FORM_FAILED);
      return;
    }
    try {
      mf.init({ countryCode: session.countryCode, sessionId: session.sessionId, cardViewId: CARD_VIEW_ID, supportedNetworks: "v,m,ae" });
      initialised.current = true;
      if (timeout.current) window.clearTimeout(timeout.current);
      setPhase("ready");
    } catch {
      fail(FORM_FAILED);
    }
  }, [session, fail]);

  async function pay() {
    if (phase !== "ready" || !window.myFatoorah) return;
    setError(null);
    setPhase("submitting");
    let sessionId: string;
    try {
      const out = await window.myFatoorah.submit();
      sessionId = out.sessionId;
    } catch (err) {
      setError(typeof err === "string" ? err : err instanceof Error ? err.message : "Check the card details and try again.");
      setPhase("ready");
      return;
    }
    const res = await executeCardPayment(token, sessionId);
    if (!res.ok) {
      setError(res.error);
      setPhase("ready");
      return;
    }
    setPhase("redirecting");
    window.location.assign(res.redirectUrl);
  }

  function payHosted() {
    setError(null);
    startHosted(async () => {
      const res = await startHostedPayment(token);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setPhase("redirecting");
      window.location.assign(res.redirectUrl);
    });
  }

  const busy = phase === "submitting" || phase === "redirecting" || hostedPending;
  const status = phase === "starting" ? "Preparing secure payment" : phase === "loading" ? "Loading the card form" : phase === "submitting" ? "Checking your card" : phase === "redirecting" ? "Opening secure payment" : "";

  return (
    <div className="space-y-4">
      {session && <Script src={session.scriptUrl} strategy="afterInteractive" onReady={initCardView} onError={() => fail(FORM_FAILED)} />}
      {phase !== "failed" && (
        <div className="rounded-2xl border border-line bg-white p-3 sm:p-4">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted"><ShieldIcon size={14} /> Card details are entered on a secure payment form. {businessName} never sees your card number.</p>
          <div id={CARD_VIEW_ID} className="min-h-56 w-full" aria-busy={phase === "starting" || phase === "loading"} />
          {(phase === "starting" || phase === "loading") && <p className="mt-2 text-sm text-muted">{status}...</p>}
        </div>
      )}
      {phase !== "failed" && (
        <button type="button" className="btn-primary min-h-12 w-full text-base" onClick={pay} disabled={phase !== "ready" || busy} aria-busy={busy}>
          <CreditCardIcon size={18} /> {phase === "submitting" ? "Checking your card..." : phase === "redirecting" ? "Opening secure payment..." : `Pay ${amountLabel}`}
        </button>
      )}
      {phase === "failed" && (
        <button type="button" className="btn-primary min-h-12 w-full text-base" onClick={payHosted} disabled={busy} aria-busy={busy}>
          <ExternalIcon size={18} /> {hostedPending ? "Opening secure payment..." : "Open secure payment page"}
        </button>
      )}
      <p role="status" aria-live="polite" className="text-sm text-muted">{phase === "failed" ? "" : status}</p>
      <p role="alert" aria-live="assertive" className="text-sm font-semibold text-danger">{error}</p>
    </div>
  );
}
