import type { Metadata } from "next";
import Link from "next/link";
import { BrandHeader } from "@/components/BrandHeader";
import { PageBody } from "@/components/AppShell";
import { EmptyState } from "@/components/EmptyState";
import { formatQr } from "@/lib/bookings/state";
import { assessmentFromRow } from "@/lib/pricing/engine";
import { listAssessments } from "@/lib/pricing/queries";
import { requireOwner } from "@/lib/roles";
import { formatStamp } from "@/lib/time";
import { AssessmentStatusPill, ConfidencePill, OwnerOnly } from "../OwnerOnly";

export const metadata: Metadata = { title: "Pricing assessments" };
export const dynamic = "force-dynamic";

export default async function AssessmentsPage() {
  const owner = await requireOwner();
  if (!owner.ok) return <OwnerOnly title="Pricing assessments" />;
  const rows = await listAssessments({ limit: 100 });
  return (
    <>
      <BrandHeader title="Pricing assessments" subtitle="Every version is an immutable snapshot: market comparison, cost floor and recommendation." backHref="/pricing" />
      <PageBody className="max-w-4xl">
        {rows.length === 0 ? (
          <EmptyState title="No assessments yet" description="Website requests create one automatically; open a booking to run one by hand." />
        ) : (
          <ul className="card divide-y divide-line">
            {rows.map((a) => {
              const snap = a.status === "ready" || a.status === "needs_detail" ? assessmentFromRow(a) : null;
              return (
                <li key={a.id}>
                  <Link href={`/pricing/assessments/${a.id}`} className="flex min-h-14 items-center gap-3 px-4 py-3 hover:bg-page">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-ink">{a.booking ? <>{a.booking.customer_name} <span className="font-mono text-xs text-muted">{a.booking.public_ref ?? ""}</span></> : <span className="text-muted">Lead (no booking yet)</span>}</p>
                      <p className="text-xs text-muted">v{a.version} · {formatStamp(a.created_at)}{a.trigger_reason ? ` · ${a.trigger_reason.replace("_", " ")}` : ""}</p>
                      <div className="mt-1 flex flex-wrap gap-1.5"><AssessmentStatusPill status={a.status} />{a.confidence && <ConfidencePill confidence={a.confidence} />}</div>
                    </div>
                    {snap && <p className="shrink-0 text-right text-sm font-black tabular-nums text-ink">{formatQr(snap.recommendation.recommended.target)}<br /><span className="text-xs font-semibold text-muted">{formatQr(snap.recommendation.recommended.low)} to {formatQr(snap.recommendation.recommended.high)}</span></p>}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </PageBody>
    </>
  );
}
