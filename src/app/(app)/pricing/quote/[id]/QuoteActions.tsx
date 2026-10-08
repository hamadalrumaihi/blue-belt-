"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { discardQuote } from "@/lib/actions/pricing";

export function QuoteActions({ quoteId }: { quoteId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
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
      {error && <p className="mt-1 text-xs font-semibold text-danger" role="alert">{error}</p>}
    </div>
  );
}
