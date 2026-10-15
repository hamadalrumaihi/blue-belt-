import Link from "next/link";
import { BrandHeader } from "@/components/BrandHeader";
import { PageBody } from "@/components/AppShell";
import { EmptyState } from "@/components/EmptyState";
import { ShieldIcon } from "@/components/icons";
import type { PriceConfidence, PricingAssessmentStatus } from "@/lib/supabase/database.types";

/** What a staff account sees on any pricing page: nothing but the refusal. */
export function OwnerOnly({ title = "Pricing" }: { title?: string }) {
  return (
    <>
      <BrandHeader title={title} backHref="/more" />
      <PageBody className="max-w-xl">
        <EmptyState icon={<ShieldIcon />} title="Owner only" description="Pricing research and quotes are for the studio owner." action={<Link href="/coverage" className="btn-secondary">Back to my coverage</Link>} />
      </PageBody>
    </>
  );
}

export const QUOTE_STATUS_LABEL = { draft: "Draft", applied: "Applied", discarded: "Discarded" } as const;

const PILL = "inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide";

export function QuoteStatusPill({ status }: { status: keyof typeof QUOTE_STATUS_LABEL }) {
  const tone = status === "applied" ? "bg-success-soft text-success border border-success/30" : status === "discarded" ? "bg-page text-muted border border-line" : "bg-lightblue text-primary border border-primary/20";
  return <span className={`${PILL} ${tone}`}>{QUOTE_STATUS_LABEL[status]}</span>;
}

export const ASSESSMENT_STATUS_LABEL: Record<PricingAssessmentStatus, string> = { queued: "Queued", researching: "Researching", ready: "Ready", needs_detail: "Needs detail", failed: "Failed" };

export function AssessmentStatusPill({ status }: { status: PricingAssessmentStatus }) {
  const tone = status === "ready" ? "bg-success-soft text-success border border-success/30" : status === "needs_detail" ? "bg-warning-soft text-warning border border-warning/30" : status === "failed" ? "bg-danger-soft text-danger border border-danger/30" : "bg-lightblue text-primary border border-primary/20";
  return <span className={`${PILL} ${tone}`}>{ASSESSMENT_STATUS_LABEL[status]}</span>;
}

export function ConfidencePill({ confidence }: { confidence: PriceConfidence | "low" | "medium" | "high" | null }) {
  const c = confidence ?? "unverified";
  const tone = c === "verified" || c === "high" ? "bg-success-soft text-success border border-success/30" : c === "likely" || c === "medium" ? "bg-lightblue text-primary border border-primary/20" : "bg-warning-soft text-warning border border-warning/30";
  return <span className={`${PILL} ${tone}`}>{c}</span>;
}
