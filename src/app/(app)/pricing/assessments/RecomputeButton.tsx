"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { recomputeAssessment, type RecomputeTarget } from "@/lib/actions/pricing";
import { cn } from "@/lib/utils";

/** Creates a new assessment version (fresh extraction from the booking, or from a previous version's inputs) and opens it. */
export function RecomputeButton({ target, label = "Re-assess", className }: { target: RecomputeTarget; label?: string; className?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="inline-flex flex-col gap-1">
      <button
        type="button"
        className={cn("btn-secondary min-h-11", className)}
        disabled={pending}
        aria-busy={pending}
        onClick={() => {
          setError(null);
          start(async () => {
            const r = await recomputeAssessment(target);
            if (!r.ok) setError(r.error);
            else router.push(`/pricing/assessments/${r.id}`);
          });
        }}
      >
        {pending ? "Assessing…" : label}
      </button>
      {error && <p className="text-xs font-semibold text-danger" role="alert">{error}</p>}
    </div>
  );
}
