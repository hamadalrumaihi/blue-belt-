import Link from "next/link";
import { BrandHeader } from "@/components/BrandHeader";
import { PageBody } from "@/components/AppShell";
import { EmptyState } from "@/components/EmptyState";
import { ShieldIcon } from "@/components/icons";

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

export function QuoteStatusPill({ status }: { status: keyof typeof QUOTE_STATUS_LABEL }) {
  const tone = status === "applied" ? "bg-success-soft text-success border border-success/30" : status === "discarded" ? "bg-page text-muted border border-line" : "bg-lightblue text-primary border border-primary/20";
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${tone}`}>{QUOTE_STATUS_LABEL[status]}</span>;
}
