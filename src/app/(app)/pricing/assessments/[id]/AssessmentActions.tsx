"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { acceptAssessment } from "@/lib/actions/pricing";
import type { PricingAssessmentStatus } from "@/lib/supabase/database.types";

type Props = { assessmentId: string; status: PricingAssessmentStatus; hasBooking: boolean; quoteId: string | null; followUp: string; missing: string[] };

/**
 * Accept → a quote DRAFT (the existing apply flow sets the amount);
 * Request details → a prefilled owner follow-up DRAFT to copy by hand.
 * Nothing here sends anything to anyone.
 */
export function AssessmentActions({ assessmentId, status, hasBooking, quoteId, followUp, missing }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showDraft, setShowDraft] = useState(false);
  const [copied, setCopied] = useState(false);
  const draftId = useId();
  const canAccept = hasBooking && (status === "ready" || status === "needs_detail");

  return (
    <div className="space-y-3">
      {quoteId ? (
        <Link href={`/pricing/quote/${quoteId}`} className="btn-primary min-h-11 w-full">Open the quote draft</Link>
      ) : (
        <button
          type="button"
          className="btn-primary min-h-11 w-full"
          disabled={pending || !canAccept}
          aria-busy={pending}
          onClick={() => {
            setError(null);
            start(async () => {
              const r = await acceptAssessment(assessmentId);
              if (!r.ok) setError(r.error);
              else router.push(`/pricing/quote/${r.quoteId}`);
            });
          }}
        >
          {pending ? "Creating draft…" : "Accept → quote draft"}
        </button>
      )}
      {!hasBooking && <p className="text-xs text-muted">This lead has no booking yet; convert it to accept a price.</p>}
      {status === "needs_detail" && <p className="text-xs text-warning">Details are missing. You can still accept, but the band rests on assumptions.</p>}
      <button type="button" className="btn-secondary min-h-11 w-full" onClick={() => setShowDraft((v) => !v)}>
        {showDraft ? "Hide follow-up draft" : missing.length ? `Request missing details (${missing.length})` : "Follow-up draft"}
      </button>
      {showDraft && (
        <div>
          <label htmlFor={draftId} className="label">Draft (not sent; copy it into WhatsApp or e-mail)</label>
          <textarea id={draftId} className="input min-h-48 py-3 text-xs" defaultValue={followUp} />
          <button
            type="button"
            className="btn-ghost mt-1 min-h-10 text-primary"
            onClick={async () => {
              const el = document.getElementById(draftId) as HTMLTextAreaElement | null;
              try {
                await navigator.clipboard.writeText(el?.value ?? followUp);
                setCopied(true);
              } catch {
                setCopied(false);
              }
            }}
          >
            {copied ? "Copied" : "Copy draft"}
          </button>
        </div>
      )}
      {error && <p className="text-xs font-semibold text-danger" role="alert">{error}</p>}
      <p className="text-[11px] text-muted">Accepting creates a private draft only. The amount reaches the booking through "Apply", and the client only through you.</p>
    </div>
  );
}
