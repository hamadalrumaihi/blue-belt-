import Link from "next/link";
import { TagIcon } from "@/components/icons";
import { formatQr } from "@/lib/bookings/state";
import { assessmentFromRow } from "@/lib/pricing/engine";
import { latestAssessmentForBooking, listQuotes } from "@/lib/pricing/queries";
import { requireOwner } from "@/lib/roles";
import { formatStamp } from "@/lib/time";
import { AssessmentStatusPill } from "@/app/(app)/pricing/OwnerOnly";
import { RecomputeButton } from "@/app/(app)/pricing/assessments/RecomputeButton";

const STATUS_LABEL = { draft: "draft", applied: "applied", discarded: "discarded" } as const;

/**
 * Owner-only panel on the booking page: the latest private assessment
 * (Researching / Ready / Needs detail / Failed) with its version and links,
 * the latest quote, and the legacy "suggest from references" entry. Renders
 * nothing for staff (requireOwner) so pricing never shows outside the
 * owner's view.
 */
export async function QuoteFromPricing({ bookingId }: { bookingId: string }) {
  const owner = await requireOwner();
  if (!owner.ok) return null;
  const [latest, assessment] = await Promise.all([listQuotes({ bookingId, limit: 1 }).then((r) => r[0] ?? null), latestAssessmentForBooking(bookingId)]);
  const snapshot = assessment && (assessment.status === "ready" || assessment.status === "needs_detail") ? assessmentFromRow(assessment) : null;
  return (
    <div className="mt-4 border-t border-line pt-3">
      <p className="mb-2 text-xs font-semibold text-muted">Pricing (owner only)</p>
      {assessment ? (
        <div className="rounded-xl border border-line bg-page px-3 py-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <AssessmentStatusPill status={assessment.status} />
            <Link href={`/pricing/assessments/${assessment.id}`} className="font-semibold text-primary hover:underline">Assessment v{assessment.version}</Link>
            <span className="text-xs text-muted">{formatStamp(assessment.computed_at ?? assessment.created_at)}</span>
          </div>
          {snapshot && (
            <p className="mt-1 text-ink">
              Target <strong>{formatQr(snapshot.recommendation.recommended.target)}</strong> <span className="text-xs text-muted">({formatQr(snapshot.recommendation.recommended.low)} to {formatQr(snapshot.recommendation.recommended.high)}; cost floor {formatQr(snapshot.costFloor.total)}; confidence {snapshot.confidence})</span>
            </p>
          )}
          {assessment.status === "needs_detail" && snapshot && <p className="mt-1 text-xs text-warning">Missing: {snapshot.missingInputs.join(", ")}</p>}
          {assessment.status === "failed" && assessment.error && <p className="mt-1 text-xs text-danger">{assessment.error}</p>}
          <div className="mt-2 flex flex-wrap gap-2">
            <Link href={`/pricing/assessments/${assessment.id}`} className="btn-secondary min-h-10">Open assessment</Link>
            <RecomputeButton target={{ bookingId }} label="Re-assess" className="min-h-10" />
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <RecomputeButton target={{ bookingId }} label="Assess pricing" />
          <Link href={`/pricing/quote?booking=${bookingId}`} className="btn-ghost min-h-11 text-primary"><TagIcon size={16} /> Suggest from references</Link>
        </div>
      )}
      {latest && (
        <p className="mt-2 text-xs text-muted">
          Latest quote:{" "}
          <Link href={`/pricing/quote/${latest.id}`} className="font-semibold text-primary hover:underline">
            {latest.status === "applied" && latest.chosen_amount_qr !== null ? formatQr(latest.chosen_amount_qr) : `${formatQr(latest.suggested_from)}${latest.suggested_to !== null && Number(latest.suggested_to) !== Number(latest.suggested_from) ? ` to ${formatQr(latest.suggested_to)}` : ""}`}
          </Link>{" "}
          ({STATUS_LABEL[latest.status]}{latest.issued_at ? `, issued ${formatStamp(latest.issued_at)}` : ", not issued"})
        </p>
      )}
    </div>
  );
}
