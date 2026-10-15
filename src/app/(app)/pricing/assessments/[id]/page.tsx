import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BrandHeader } from "@/components/BrandHeader";
import { PageBody } from "@/components/AppShell";
import { AlertIcon } from "@/components/icons";
import { BOOKING_STATUS_LABEL, BOOKING_TYPE_LABEL, formatQr } from "@/lib/bookings/state";
import { assessmentFromRow } from "@/lib/pricing/engine";
import { COMPARABLE_SCOPE_LABEL, type MarketGroup } from "@/lib/pricing/engine/types";
import { followUpDraft } from "@/lib/pricing/follow-up";
import { getAssessment, listAssessmentVersions, quoteForAssessment } from "@/lib/pricing/queries";
import { requireOwner } from "@/lib/roles";
import { formatStamp } from "@/lib/time";
import { cn } from "@/lib/utils";
import { isUuid } from "@/lib/validation";
import { AssessmentStatusPill, ConfidencePill, OwnerOnly, QuoteStatusPill } from "../../OwnerOnly";
import { RecomputeButton } from "../RecomputeButton";
import { AssessmentActions } from "./AssessmentActions";
import { AssessmentEditForm } from "./AssessmentEditForm";

export const metadata: Metadata = { title: "Pricing assessment" };
export const dynamic = "force-dynamic";

const UNIT_LABEL = { per_hour: "per hour", per_athlete: "per athlete", per_session: "per session", per_image: "per edited image", flat: "flat" } as const;

export default async function AssessmentPage({ params }: { params: Promise<{ id: string }> }) {
  const owner = await requireOwner();
  if (!owner.ok) return <OwnerOnly title="Pricing assessment" />;
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const row = await getAssessment(id);
  if (!row) notFound();
  const [versions, quote] = await Promise.all([listAssessmentVersions(row), quoteForAssessment(row.id)]);
  const a = row.status === "ready" || row.status === "needs_detail" ? assessmentFromRow(row) : null;
  const subtitle = row.booking ? `${row.booking.customer_name} · ${row.booking.public_ref ?? "Booking"}` : "Lead (no booking yet)";

  return (
    <>
      <BrandHeader title={`Assessment v${row.version}`} subtitle={subtitle} backHref="/pricing" />
      <PageBody className="max-w-5xl space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <AssessmentStatusPill status={row.status} />
          {row.confidence && <ConfidencePill confidence={row.confidence} />}
          <span className="text-xs text-muted">{formatStamp(row.created_at)}{row.computed_at ? ` · computed ${formatStamp(row.computed_at)}` : ""}</span>
          {row.booking && <Link href={`/bookings/${row.booking.id}`} className="text-xs font-semibold text-primary hover:underline">Open booking ({BOOKING_STATUS_LABEL[row.booking.booking_status]})</Link>}
          {quote && <Link href={`/pricing/quote/${quote.id}`} className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">Quote draft <QuoteStatusPill status={quote.status} /></Link>}
        </div>
        {row.error && <p className="rounded-xl border border-danger/30 bg-danger-soft px-3 py-2 text-sm font-semibold text-danger" role="alert">{row.error}</p>}

        {!a ? (
          <section className="card p-4">
            <p className="text-sm text-muted">{row.status === "queued" ? "Queued: it is computed by the next pricing run, or re-assess now." : row.status === "failed" ? "This version failed. Re-assess to try again." : "The stored snapshot could not be read."}</p>
            <div className="mt-3"><RecomputeButton target={{ assessmentId: row.id }} /></div>
          </section>
        ) : (
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="space-y-4 lg:col-span-2">
              {/* 3. Recommendation */}
              <section className="card p-4" aria-labelledby="rec-h">
                <h2 id="rec-h" className="eyebrow">Recommendation</h2>
                <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                  {(["low", "target", "high"] as const).map((k) => (
                    <div key={k} className={cn("rounded-xl border px-2 py-3", k === "target" ? "border-primary/30 bg-lightblue" : "border-line bg-page")}>
                      <p className="text-[10px] font-bold uppercase tracking-wide text-muted">{k}</p>
                      <p className={cn("font-black tabular-nums text-ink", k === "target" ? "text-2xl" : "text-lg")}>{formatQr(a.recommendation.recommended[k])}</p>
                      <p className="text-[10px] text-muted">{a.recommendation.marginPercent[k]}% margin</p>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-sm text-ink">At the target: profit <strong>{formatQr(a.recommendation.profitAtTarget)}</strong> after the {a.recommendation.feePercent}% payment fee, a <strong>{a.recommendation.marginAtTarget}%</strong> margin. Cost floor {formatQr(a.costFloor.total)}.</p>
                {a.recommendation.team && (
                  <p className="mt-2 rounded-xl border border-line bg-page px-3 py-2 text-sm text-ink">Team of {a.recommendation.team.athletes}: total <strong>{formatQr(a.recommendation.team.total)}</strong>, effectively <strong>{formatQr(a.recommendation.team.perAthlete)}</strong> per athlete. {a.recommendation.team.basis}</p>
                )}
                {a.recommendation.flags.length > 0 && (
                  <ul className="mt-3 space-y-1 text-xs">
                    {a.recommendation.flags.map((f, i) => (
                      <li key={i} className={cn("flex gap-2 rounded-lg px-3 py-2", f.severity === "blocker" ? "bg-danger-soft text-danger" : f.severity === "warning" ? "bg-warning-soft text-ink" : "bg-page text-muted")}>
                        {f.severity !== "info" && <AlertIcon size={14} className="mt-0.5 shrink-0" />}
                        <span>{f.message}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <ol className="mt-3 list-decimal space-y-1 border-t border-line pt-3 pl-5 text-xs text-ink">
                  {a.recommendation.steps.map((s, i) => <li key={i}>{s}</li>)}
                </ol>
                {a.recommendation.alternatives.length > 0 && (
                  <div className="mt-3 border-t border-line pt-3">
                    <p className="text-xs font-semibold text-muted">Scope alternatives (cost-based, same margins)</p>
                    <ul className="mt-1 divide-y divide-line text-sm">
                      {a.recommendation.alternatives.map((alt) => (
                        <li key={alt.key} className="flex items-center justify-between gap-3 py-2">
                          <div className="min-w-0"><p className="font-semibold text-ink">{alt.label}</p><p className="text-xs text-muted">{alt.changes.join("; ")} · cost {formatQr(alt.costTotal)}</p></div>
                          <p className="shrink-0 text-right tabular-nums text-ink"><strong>{formatQr(alt.band.target)}</strong><br /><span className="text-xs text-muted">{formatQr(alt.band.low)} to {formatQr(alt.band.high)}</span></p>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </section>

              {/* 1. Market comparison */}
              <section className="card p-4" aria-labelledby="market-h">
                <h2 id="market-h" className="eyebrow">Market comparison</h2>
                <p className="mt-1 text-xs text-muted">Primary scope: {COMPARABLE_SCOPE_LABEL[a.market.primaryScope]}. Prices are normalised only within one scope and never across product types.</p>
                {a.market.range ? (
                  <p className="mt-2 text-sm text-ink">Qatar range <strong>{formatQr(a.market.range.low)}</strong> to <strong>{formatQr(a.market.range.high)}</strong> (median {formatQr(a.market.range.median)}, {a.market.range.count} observation{a.market.range.count === 1 ? "" : "s"}, {UNIT_LABEL[a.market.range.unit]}) · confidence {a.market.confidence}.</p>
                ) : (
                  <p className="mt-2 text-sm font-semibold text-warning">No active Qatar evidence for this scope.</p>
                )}
                {a.market.notes.map((n, i) => <p key={i} className="mt-1 text-xs text-muted">{n}</p>)}
                {a.market.groups.map((g) => <MarketGroupView key={`${g.scope}-${g.media}-${g.region}-${g.role}`} group={g} />)}
                {a.market.needsReverification.length > 0 && (
                  <div className="mt-3 border-t border-line pt-3">
                    <p className="text-xs font-semibold text-warning">Needs re-verification (not used)</p>
                    <ul className="mt-1 space-y-1 text-xs text-muted">{a.market.needsReverification.map((n) => <li key={n.id}><Link href={`/pricing/references/${n.id}/edit`} className="font-semibold text-ink hover:underline">{n.provider}</Link>: {n.reason}</li>)}</ul>
                  </div>
                )}
                {a.market.excluded.length > 0 && (
                  <div className="mt-3 border-t border-line pt-3">
                    <p className="text-xs font-semibold text-muted">Excluded</p>
                    <ul className="mt-1 space-y-1 text-xs text-muted">{a.market.excluded.map((n) => <li key={n.id}><span className="font-semibold text-ink">{n.provider}</span>: {n.reason}</li>)}</ul>
                  </div>
                )}
              </section>

              {/* 2. Cost floor */}
              <section className="card p-4" aria-labelledby="cost-h">
                <h2 id="cost-h" className="eyebrow">Cost floor</h2>
                <p className="mt-1 text-xs text-muted">Staffing: {a.costFloor.staffing.basis}. Owner time {a.costFloor.workload.ownerHours} h (of which editing {a.costFloor.workload.editingHours} h); {a.costFloor.workload.expectedImages} expected images.</p>
                <table className="mt-2 w-full text-sm">
                  <tbody className="divide-y divide-line">
                    {a.costFloor.lines.map((l) => (
                      <tr key={l.key}>
                        <td className="py-1.5 pr-2"><p className="font-semibold text-ink">{l.label}</p><p className="text-xs text-muted">{l.basis}</p></td>
                        <td className="py-1.5 text-right tabular-nums text-ink">{formatQr(l.amount)}</td>
                      </tr>
                    ))}
                    <tr><td className="py-1.5 text-muted">Contingency ({a.costAssumptions.contingencyPercent}%)</td><td className="py-1.5 text-right tabular-nums text-ink">{formatQr(a.costFloor.contingency)}</td></tr>
                    <tr><td className="py-1.5 font-black text-ink">Total cost floor</td><td className="py-1.5 text-right font-black tabular-nums text-ink">{formatQr(a.costFloor.total)}</td></tr>
                  </tbody>
                </table>
                {a.costFloor.warnings.map((w, i) => <p key={i} className="mt-2 text-xs font-semibold text-warning">{w}</p>)}
                <details className="mt-3 border-t border-line pt-3 text-xs">
                  <summary className="cursor-pointer font-semibold text-muted">Assumptions ({a.costFloor.assumptions.length})</summary>
                  <ul className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-2">
                    {a.costFloor.assumptions.map((s) => <li key={s.key} className="flex justify-between gap-2"><span className="text-muted">{s.label}</span><span className={cn("font-semibold tabular-nums", s.source === "owner" ? "text-primary" : "text-ink")}>{String(s.value)}{s.source === "owner" ? " (yours)" : ""}</span></li>)}
                  </ul>
                </details>
              </section>
            </div>

            <div className="space-y-4">
              <section className="card p-4" aria-labelledby="act-h">
                <h2 id="act-h" className="eyebrow">Actions</h2>
                <AssessmentActions assessmentId={row.id} status={row.status} hasBooking={Boolean(row.booking_id)} quoteId={quote?.id ?? null} followUp={followUpDraft(a.request)} missing={a.missingInputs} />
              </section>

              <section className="card p-4" aria-labelledby="req-h">
                <h2 id="req-h" className="eyebrow">Request (public scope)</h2>
                <dl className="mt-2 divide-y divide-line text-sm">
                  <Row label="Service" value={BOOKING_TYPE_LABEL[a.request.bookingType]} />
                  <Row label="Media" value={a.request.media.replace("_", " + ")} />
                  <Row label="Video" value={a.request.videoDeliverables.length ? a.request.videoDeliverables.map((v) => v.replace("_", " ")).join(", ") : null} />
                  <Row label="Hours" value={a.request.hoursOnSite !== null ? `${a.request.hoursOnSite} h × ${a.request.days} day${a.request.days === 1 ? "" : "s"}` : null} />
                  <Row label="Athletes" value={a.request.athleteCount} />
                  <Row label="Mats" value={a.request.simultaneousMats} />
                  <Row label="Images" value={a.request.expectedImages} />
                  <Row label="Location" value={a.request.locationKind} />
                  <Row label="Usage" value={a.request.usage} />
                  <Row label="Date" value={a.request.eventDate} />
                  <Row label="Deadline" value={a.request.deadlineDays !== null ? `${a.request.deadlineDays} days` : null} />
                </dl>
                {a.missingInputs.length > 0 && <p className="mt-2 text-xs text-warning"><strong>Missing:</strong> {a.missingInputs.join(", ")}{a.request.criticalMissing.length ? ` (critical: ${a.request.criticalMissing.join(", ")})` : ""}</p>}
                {a.request.assumptions.length > 0 && <p className="mt-1 text-xs text-muted"><strong>Assumed:</strong> {a.request.assumptions.map((s) => `${s.label} ${String(s.value)}`).join("; ")}</p>}
                {a.recommendation.capacity.date && (a.recommendation.capacity.conflicts.length > 0 || a.recommendation.capacity.tentative.length > 0) && (
                  <p className="mt-2 text-xs text-muted">Same day: {[...a.recommendation.capacity.conflicts, ...a.recommendation.capacity.tentative].map((c) => <Link key={c.bookingId} href={`/bookings/${c.bookingId}`} className="font-semibold text-primary hover:underline">{c.publicRef ?? c.bookingId.slice(0, 8)} ({c.status.replace("_", " ")}) </Link>)}</p>
                )}
              </section>

              <section className="card p-4" aria-labelledby="edit-h">
                <h2 id="edit-h" className="eyebrow">Edit inputs → new version</h2>
                <AssessmentEditForm assessmentId={row.id} request={a.request} assumptions={a.costAssumptions} margins={a.recommendation.marginPercent} />
              </section>

              <section className="card p-4" aria-labelledby="ver-h">
                <h2 id="ver-h" className="eyebrow">Versions</h2>
                <ul className="mt-2 divide-y divide-line text-sm">
                  {versions.map((v) => (
                    <li key={v.id} className="flex items-center justify-between gap-2 py-1.5">
                      {v.id === row.id ? <span className="font-bold text-ink">v{v.version} (this)</span> : <Link href={`/pricing/assessments/${v.id}`} className="font-semibold text-primary hover:underline">v{v.version}</Link>}
                      <span className="flex items-center gap-2 text-xs text-muted"><AssessmentStatusPill status={v.status} />{formatStamp(v.created_at)}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-3"><RecomputeButton target={{ bookingId: row.booking_id, leadId: row.lead_id }} label="Re-extract from the booking" className="w-full" /></div>
              </section>
            </div>
          </div>
        )}
      </PageBody>
    </>
  );
}

function MarketGroupView({ group: g }: { group: MarketGroup }) {
  return (
    <div className="mt-3 border-t border-line pt-3">
      <p className="text-xs font-semibold text-ink">
        {COMPARABLE_SCOPE_LABEL[g.scope]} · {g.media.replace("_", " + ")} · {g.region.toUpperCase()} · {g.role}{g.role === "component" ? " (one side of a photo + video job)" : ""}
        <span className="ml-2 font-normal text-muted">{g.count} obs · {formatQr(g.low)} to {formatQr(g.high)} ({UNIT_LABEL[g.unit]}) · confidence {g.confidence}</span>
      </p>
      <ul className="mt-1 divide-y divide-line text-sm">
        {g.items.map((i) => (
          <li key={i.id} className="flex items-start justify-between gap-3 py-1.5">
            <div className="min-w-0">
              <p className="font-semibold text-ink">{i.provider} <ConfidencePill confidence={i.confidence} /></p>
              <p className="text-xs text-muted">{formatQr(i.priceFrom)}{i.priceTo !== i.priceFrom ? ` to ${formatQr(i.priceTo)}` : ""}{i.unitFrom !== null ? ` · ${formatQr(i.unitFrom)}${i.unitTo !== null && i.unitTo !== i.unitFrom ? ` to ${formatQr(i.unitTo)}` : ""} ${UNIT_LABEL[i.unit]}` : ""} · {i.observedOn}</p>
              {i.notes.length > 0 && <p className="text-xs text-warning">{i.notes.join(" ")}</p>}
            </div>
            <p className="shrink-0 text-right text-sm font-black tabular-nums text-ink">{formatQr(i.scaledFrom)}{i.scaledTo !== i.scaledFrom ? <><br /><span className="text-xs font-semibold text-muted">to {formatQr(i.scaledTo)}</span></> : null}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="flex gap-3 py-1.5">
      <dt className="w-20 shrink-0 text-muted">{label}</dt>
      <dd className="min-w-0 flex-1 break-words text-ink">{value}</dd>
    </div>
  );
}
