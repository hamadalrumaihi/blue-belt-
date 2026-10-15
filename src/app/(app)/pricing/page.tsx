import type { Metadata } from "next";
import Link from "next/link";
import { BrandHeader } from "@/components/BrandHeader";
import { PageBody } from "@/components/AppShell";
import { EmptyState } from "@/components/EmptyState";
import { AlertIcon, DownloadIcon, EditIcon, ExternalIcon, PlusIcon, TagIcon } from "@/components/icons";
import { BOOKING_TYPE_LABEL, BOOKING_TYPES, formatQr, isBookingType } from "@/lib/bookings/state";
import { COMPARABLE_SCOPE_LABEL } from "@/lib/pricing/engine/types";
import { includesSummary, PRICE_CONFIDENCE_LABEL, PRICE_CONFIDENCES, PRICE_MEDIA_TYPE_LABEL, PRICE_REGION_LABEL, PRICE_REGIONS, PRICE_SOURCE_TYPE_LABEL, priceReferenceIncludes } from "@/lib/pricing/form";
import { listAssessments, listPriceReferences, listQuotes, type ReferenceFilter } from "@/lib/pricing/queries";
import { requireOwner } from "@/lib/roles";
import { formatEventDate, formatStamp } from "@/lib/time";
import { cn } from "@/lib/utils";
import { AssessmentStatusPill, ConfidencePill, OwnerOnly, QuoteStatusPill } from "./OwnerOnly";
import { ReferenceRowActions } from "./ReferenceRowActions";

export const metadata: Metadata = { title: "Pricing" };
export const dynamic = "force-dynamic";

const SHOW = ["active", "reverify", "excluded", "all"] as const;
const SHOW_LABEL: Record<(typeof SHOW)[number], string> = { active: "Active", reverify: "Needs re-verification", excluded: "Excluded", all: "All (with history)" };

function one(v: string | string[] | undefined): string | null {
  return typeof v === "string" ? v : Array.isArray(v) ? v[0] ?? null : null;
}

export default async function PricingPage({ searchParams }: PageProps<"/pricing">) {
  const owner = await requireOwner();
  if (!owner.ok) return <OwnerOnly />;
  const params = await searchParams;
  const type = isBookingType(one(params.type)) ? (one(params.type) as ReferenceFilter["serviceType"]) : null;
  const confidenceRaw = one(params.confidence);
  const confidence = (PRICE_CONFIDENCES as readonly string[]).includes(confidenceRaw ?? "") ? (confidenceRaw as ReferenceFilter["confidence"]) : null;
  const regionRaw = one(params.region);
  const region = (PRICE_REGIONS as readonly string[]).includes(regionRaw ?? "") ? (regionRaw as ReferenceFilter["region"]) : null;
  const showRaw = one(params.show);
  const show = (SHOW as readonly string[]).includes(showRaw ?? "") ? (showRaw as ReferenceFilter["show"]) : "active";
  const [references, quotes, assessments] = await Promise.all([listPriceReferences({ serviceType: type, confidence, region, show }), listQuotes({ limit: 20 }), listAssessments({ limit: 20 })]);
  const reverifyCount = references.filter((r) => r.reverify).length;

  const href = (patch: Record<string, string | null>) => {
    const q = new URLSearchParams();
    const next = { type, confidence, region, show: show === "active" ? null : show, ...patch };
    for (const [k, v] of Object.entries(next)) if (v) q.set(k, v);
    const s = q.toString();
    return s ? `/pricing?${s}` : "/pricing";
  };
  const chip = (active: boolean) => cn("rounded-md px-2 py-1 text-xs font-semibold", active ? "bg-ink text-white" : "text-muted hover:text-ink");

  return (
    <>
      <BrandHeader
        title="Pricing"
        subtitle="Observed market evidence, private assessments and quote drafts. Owner only; nothing here reaches a client."
        actions={<Link href="/pricing/quote" className="btn-primary min-h-10"><TagIcon size={18} /> Suggest a quote</Link>}
      />
      <PageBody className="max-w-5xl space-y-8">
        <section aria-labelledby="assess-h">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 id="assess-h" className="eyebrow">Assessments</h2>
            <Link href="/pricing/assessments" className="text-xs font-semibold text-primary hover:underline">All assessments</Link>
          </div>
          {assessments.length === 0 ? (
            <EmptyState compact title="No assessments yet" description="A private assessment is created for every website request. Open a booking and choose Assess pricing to run one by hand." />
          ) : (
            <ul className="card divide-y divide-line">
              {assessments.slice(0, 8).map((a) => (
                <li key={a.id}>
                  <Link href={`/pricing/assessments/${a.id}`} className="flex min-h-14 items-center gap-3 px-4 py-3 hover:bg-page">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-ink">{a.booking ? <>{a.booking.customer_name} <span className="font-mono text-xs text-muted">{a.booking.public_ref ?? ""}</span></> : <span className="text-muted">Lead (no booking yet)</span>}</p>
                      <p className="text-xs text-muted">v{a.version} · {formatStamp(a.created_at)}</p>
                    </div>
                    <AssessmentStatusPill status={a.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="refs-h">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 id="refs-h" className="eyebrow">Market evidence</h2>
            <div className="flex gap-2">
              <Link href="/pricing/references/import" className="btn-secondary min-h-10"><DownloadIcon size={16} /> Import</Link>
              <Link href="/pricing/references/new" className="btn-secondary min-h-10"><PlusIcon size={16} /> New observation</Link>
            </div>
          </div>
          <div className="mb-2 flex flex-wrap gap-1.5">
            <Link href={href({ type: null })} className={chip(!type)}>Any service</Link>
            {BOOKING_TYPES.map((t) => <Link key={t} href={href({ type: t })} className={chip(type === t)}>{BOOKING_TYPE_LABEL[t]}</Link>)}
          </div>
          <div className="mb-2 flex flex-wrap gap-1.5">
            <Link href={href({ confidence: null })} className={chip(!confidence)}>Any confidence</Link>
            {PRICE_CONFIDENCES.map((c) => <Link key={c} href={href({ confidence: c })} className={chip(confidence === c)}>{PRICE_CONFIDENCE_LABEL[c]}</Link>)}
            <span className="mx-1 text-line">|</span>
            <Link href={href({ region: null })} className={chip(!region)}>Any region</Link>
            {PRICE_REGIONS.map((r) => <Link key={r} href={href({ region: r })} className={chip(region === r)}>{PRICE_REGION_LABEL[r]}</Link>)}
          </div>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {SHOW.map((s) => <Link key={s} href={href({ show: s === "active" ? null : s })} className={chip(show === s)}>{SHOW_LABEL[s]}</Link>)}
          </div>
          {show === "active" && reverifyCount > 0 && (
            <p className="mb-3 flex items-center gap-2 rounded-xl border border-warning/30 bg-warning-soft px-3 py-2 text-xs font-semibold text-warning"><AlertIcon size={14} /> {reverifyCount} observation{reverifyCount === 1 ? "" : "s"} need re-verification and do not price anything until re-checked.</p>
          )}
          {references.length === 0 ? (
            <EmptyState
              compact
              icon={<TagIcon />}
              title="No observations match"
              description="Record what other providers advertise (with the page, the date and how sure you are). Only comparable, verified evidence prices a job."
              action={<Link href="/pricing/references/new" className="btn-primary">Add an observation</Link>}
            />
          ) : (
            <ul className="card divide-y divide-line">
              {references.map((r) => {
                const inc = priceReferenceIncludes(r);
                const summary = includesSummary(inc);
                return (
                  <li key={r.id} className={cn("px-4 py-3", (r.excluded || r.superseded_by) && "opacity-70")}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-extrabold text-ink">{r.provider}{r.location ? <span className="font-normal text-muted"> · {r.location}</span> : null}</p>
                        <p className="text-xs text-muted">
                          {BOOKING_TYPE_LABEL[r.service_type]}{r.comparable_scope ? ` · ${COMPARABLE_SCOPE_LABEL[r.comparable_scope as keyof typeof COMPARABLE_SCOPE_LABEL] ?? r.comparable_scope}` : ""}{r.media_type ? ` · ${PRICE_MEDIA_TYPE_LABEL[r.media_type]}` : ""} · observed {formatEventDate(r.observed_on ?? r.checked_on, "short")} · {PRICE_SOURCE_TYPE_LABEL[r.source_type ?? "other"]}
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          <ConfidencePill confidence={r.confidence} />
                          <span className="rounded-full border border-line bg-page px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted">{PRICE_REGION_LABEL[r.region]}</span>
                          {r.reverify && <span className="rounded-full border border-warning/30 bg-warning-soft px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-warning">Re-verify: {r.reverify}</span>}
                          {r.excluded && <span className="rounded-full border border-line bg-page px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted">Excluded</span>}
                          {r.superseded_by && <span className="rounded-full border border-line bg-page px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted">Superseded</span>}
                        </div>
                        {(summary || r.deliverables) && <p className="mt-1 text-xs text-muted">{[r.duration_hours !== null && !inc.hours ? `${r.duration_hours} h` : null, summary, r.deliverables].filter(Boolean).join(" · ")}</p>}
                        {r.excluded && r.excluded_reason && <p className="mt-1 text-xs text-muted">Excluded: {r.excluded_reason}</p>}
                        {r.notes && <p className="mt-1 line-clamp-2 text-xs text-muted">{r.notes}</p>}
                      </div>
                      <p className="shrink-0 text-right text-sm font-black tabular-nums text-ink">
                        {formatQr(r.price_from)}{r.price_to !== null && Number(r.price_to) !== Number(r.price_from) ? <><br /><span className="text-xs font-semibold text-muted">to {formatQr(r.price_to)}</span></> : null}
                        {r.currency !== "QAR" && <span className="block text-[10px] font-bold uppercase text-warning">{r.currency}</span>}
                      </p>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {r.source_url && <a href={r.source_url} target="_blank" rel="noopener noreferrer nofollow" className="btn-ghost min-h-10 text-primary"><ExternalIcon size={16} /> Source</a>}
                      <Link href={`/pricing/references/${r.id}/edit`} className="btn-secondary min-h-10"><EditIcon size={16} /> {r.reverify ? "Re-verify" : "Edit"}</Link>
                      <ReferenceRowActions id={r.id} provider={r.provider} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section aria-labelledby="quotes-h">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 id="quotes-h" className="eyebrow">Quotes</h2>
            <Link href="/pricing/quote" className="btn-secondary min-h-10"><PlusIcon size={16} /> New quote</Link>
          </div>
          {quotes.length === 0 ? (
            <EmptyState compact title="No quotes yet" description="Accept an assessment, or describe a job by hand, to get a draft. You decide the final amount." action={<Link href="/pricing/quote" className="btn-primary">Suggest a quote</Link>} />
          ) : (
            <ul className="card divide-y divide-line">
              {quotes.map((q) => (
                <li key={q.id}>
                  <Link href={`/pricing/quote/${q.id}`} className="flex min-h-14 items-center gap-3 px-4 py-3 hover:bg-page">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-ink">
                        {q.booking ? <>{q.booking.customer_name} <span className="font-mono text-xs text-muted">{q.booking.public_ref ?? ""}</span></> : <span className="text-muted">No booking</span>}
                      </p>
                      <p className="text-xs text-muted">{formatStamp(q.created_at)}{q.assessment_id ? " · from assessment" : ""}{q.issued_at ? ` · issued ${formatStamp(q.issued_at)}` : ""}</p>
                      <div className="mt-1"><QuoteStatusPill status={q.status} /></div>
                    </div>
                    <p className="shrink-0 text-right text-sm font-black tabular-nums text-ink">
                      {q.status === "applied" && q.chosen_amount_qr !== null ? formatQr(q.chosen_amount_qr) : <>{formatQr(q.suggested_from)}{q.suggested_to !== null && Number(q.suggested_to) !== Number(q.suggested_from) ? <><br /><span className="text-xs font-semibold text-muted">to {formatQr(q.suggested_to)}</span></> : null}</>}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </PageBody>
    </>
  );
}
