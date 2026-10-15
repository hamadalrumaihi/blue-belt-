"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { discardQuote, issueQuote } from "@/lib/actions/pricing";

type Props = { quoteId: string; canDiscard: boolean; canIssue: boolean; issuedAt: string | null };

/**
 * Discard (draft only) and the explicit "Issue quote" that records
 * issued_at. Issuing sends nothing: the owner shares the price themselves.
 */
export function QuoteActions({ quoteId, canDiscard, canIssue, issuedAt }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      {canIssue && !issuedAt && (
        <button
          type="button"
          className="btn-secondary min-h-11 w-full"
          disabled={pending}
          aria-busy={pending}
          onClick={() => {
            if (!window.confirm("Mark this quote as issued to the client? Nothing is sent; this records that you shared the price.")) return;
            setError(null);
            start(async () => {
              const r = await issueQuote(quoteId);
              if (!r.ok) setError(r.error);
              else router.refresh();
            });
          }}
        >
          {pending ? "Saving…" : "Issue quote (record only)"}
        </button>
      )}
      {canDiscard && (
        <button
          type="button"
          className="btn-ghost min-h-11 w-full text-muted"
          disabled={pending}
          aria-busy={pending}
          onClick={() => {
            setError(null);
            start(async () => {
              const r = await discardQuote(quoteId);
              if (!r.ok) setError(r.error);
              else router.refresh();
            });
          }}
        >
          {pending ? "Discarding…" : "Discard this quote"}
        </button>
      )}
      {error && <p className="text-xs font-semibold text-danger" role="alert">{error}</p>}
    </div>
  );
}
