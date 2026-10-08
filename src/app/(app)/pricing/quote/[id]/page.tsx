import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BrandHeader } from "@/components/BrandHeader";
import { PageBody } from "@/components/AppShell";
import { AlertIcon } from "@/components/icons";
import { BOOKING_STATUS_LABEL, BOOKING_TYPE_LABEL, formatQr } from "@/lib/bookings/state";
import { quoteInputsFromJson } from "@/lib/pricing/form";
import { getQuote } from "@/lib/pricing/queries";
import { CONFIDENCE_LABEL, suggestedMidpoint, suggestionFromJson } from "@/lib/pricing/suggest";
import { requireOwner } from "@/lib/roles";
import { formatStamp } from "@/lib/time";
import { cn } from "@/lib/utils";
import { isUuid } from "@/lib/validation";
import { OwnerOnly, QuoteStatusPill } from "../../OwnerOnly";
import { ApplyQuoteForm } from "./ApplyQuoteForm";
import { QuoteActions } from "./QuoteActions";

export const metadata: Metadata = { title: "Quote" };
export const dynamic = "force-dynamic";

export default async function QuoteDetailPage({ params }: PageProps<"/pricing/quote/[id]">) {
  const owner = await requireOwner();
  if (!owner.ok) return <OwnerOnly title="Quote" />;
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const quote = await getQuote(id);
  if (!quote) notFound();
  const suggestion = suggestionFromJson(quote.calculation);
  const inputs = quoteInputsFromJson(quote.inputs);
  const canApply = quote.status === "draft" && quote.booking !== null && quote.booking.booking_status !== "cancelled" && quote.booking.booking_status !== "completed";

  return (
    <>
      <BrandHeader title="Quote suggestion" subtitle={quote.booking ? `${quote.booking.customer_name} · ${quote.booking.public_ref ?? "Booking"}` : "Not linked to a booking"} backHref="/pricing" />
      <PageBody className="max-w-4xl">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <QuoteStatusPill status={quote.status} />
          <span className="text-xs text-muted">{formatStamp(quote.created_at)}</span>
          {quote.booking && <Link href={`/bookings/${quote.booking.id}`} className="text-xs font-semibold text-primary hover:underline">Open booking ({BOOKING_STATUS_LABEL[quote.booking.booking_status]})</Link>}
        </div>

        {!suggestion || !inputs ? (
          <p className="card p-4 text-sm text-danger" role="alert">The stored breakdown of this quote could not be read. Create a new one.</p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="space-y-4 lg:col-span-2">
              <section className="card p-4" aria-labelledby="sum-h">
                <h2 id="sum-h" className="eyebrow">Suggested range</h2>
                <p className="mt-1 text-3xl font-black text-ink">
                  {formatQr(suggestion.suggestedFrom)}{suggestion.suggestedTo !== suggestion.suggestedFrom ? <span className="text-lg font-bold text-muted"> to {formatQr(suggestion.suggestedTo)}</span> : null}
                </p>
                {quote.status === "applied" && quote.chosen_amount_qr !== null && <p className="mt-1 text-sm font-semibold text-success">Applied to the booking at {formatQr(quote.chosen_amount_qr)}.</p>}
                <p className={cn("mt-3 inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold", suggestion.confidence === "low" ? "bg-warning-soft text-warning" : suggestion.confidence === "high" ? "bg-success-soft text-success" : "bg-lightblue text-primary")}>
                  {suggestion.confidence === "low" && <AlertIcon size={14} />}
                  {CONFIDENCE_LABEL[suggestion.confidence]}
                </p>
                {suggestion.confidence === "low" && <p className="mt-2 text-sm text-muted">Fewer than two comparable references, or their scope differs on video or athlete count. Treat the figure as a starting point and set the price yourself.</p>}
                {suggestion.warnings.length > 0 && (
                  <ul className="mt-3 space-y-1 rounded-xl border border-warning/30 bg-warning-soft/60 px-3 py-2 text-xs text-ink">
                    {suggestion.warnings.map((w, i) => <li key={i} className="flex gap-2"><AlertIcon size={14} className="mt-0.5 shrink-0 text-warning" /><span>{w}</span></li>)}
                  </ul>
                )}
              </section>

              <section className="card p-4" aria-labelledby="steps-h">
                <h2 id="steps-h" className="eyebrow">How it was worked out</h2>
                <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm text-ink">
                  {suggestion.steps.map((s, i) => <li key={i}>{s}</li>)}
                </ol>
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 border-t border-line pt-3 text-xs sm:grid-cols-3">
                  {suggestion.baseline && <div><dt className="text-muted">Market baseline</dt><dd className="font-semibold text-ink">{formatQr(suggestion.baseline.from)} to {formatQr(suggestion.baseline.to)}</dd></div>}
                  {suggestion.costs.shooting > 0 && <div><dt className="text-muted">Shooting</dt><dd className="font-semibold text-ink">{formatQr(suggestion.costs.shooting)}</dd></div>}
                  <div><dt className="text-muted">Editing</dt><dd className="font-semibold text-ink">{formatQr(suggestion.costs.editing)}</dd></div>
                  <div><dt className="text-muted">Travel</dt><dd className="font-semibold text-ink">{formatQr(suggestion.costs.travel)}</dd></div>
                  <div><dt className="text-muted">Video partner</dt><dd className="font-semibold text-ink">{formatQr(suggestion.costs.videoPartner)}</dd></div>
                  <div><dt className="text-muted">Other</dt><dd className="font-semibold text-ink">{formatQr(suggestion.costs.other)}</dd></div>
                  <div><dt className="text-muted">Margin ({suggestion.marginPercent}%)</dt><dd className="font-semibold text-ink">{formatQr(suggestion.margin)}</dd></div>
                </dl>
              </section>

              <section className="card p-4" aria-labelledby="refs-h">
                <h2 id="refs-h" className="eyebrow">Reference prices used</h2>
                {suggestion.comparable.length === 0 ? (
                  <p className="mt-1 text-sm text-muted">None were comparable.</p>
                ) : (
                  <ul className="mt-2 divide-y divide-line text-sm">
                    {suggestion.comparable.map((c) => (
                      <li key={c.id} className="flex items-start justify-between gap-3 py-2">
                        <div className="min-w-0">
                          <p className="font-semibold text-ink">{c.provider}{c.stale ? <span className="ml-2 rounded-md bg-warning-soft px-1.5 py-0.5 text-[10px] font-bold uppercase text-warning">Stale</span> : null}</p>
                          <p className="text-xs text-muted">
                            {formatQr(c.priceFrom)}{c.priceTo !== c.priceFrom ? ` to ${formatQr(c.priceTo)}` : ""}
                            {c.method === "per_hour" && c.unitFrom !== null ? ` · ${formatQr(c.unitFrom)} per hour` : c.method === "per_athlete" && c.unitFrom !== null ? ` · ${formatQr(c.unitFrom)} per athlete` : " · flat"}
                          </p>
                          {c.scopeDiff.length > 0 && <p className="mt-0.5 text-xs text-warning">{c.scopeDiff.join(" ")}</p>}
                        </div>
                        <p className="shrink-0 text-right text-sm font-black tabular-nums text-ink">{formatQr(c.normalisedFrom)}{c.normalisedTo !== c.normalisedFrom ? <><br /><span className="text-xs font-semibold text-muted">to {formatQr(c.normalisedTo)}</span></> : null}</p>
                      </li>
                    ))}
                  </ul>
                )}
                {suggestion.notComparable.length > 0 && (
                  <div className="mt-3 border-t border-line pt-3">
                    <p className="text-xs font-semibold text-muted">Left out</p>
                    <ul className="mt-1 space-y-1 text-xs text-muted">
                      {suggestion.notComparable.map((n) => <li key={n.id}><span className="font-semibold text-ink">{n.provider}</span>: {n.reason}</li>)}
                    </ul>
                  </div>
                )}
              </section>
            </div>

            <div className="space-y-4">
              <section className="card p-4" aria-labelledby="apply-h">
                <h2 id="apply-h" className="eyebrow">Apply to booking</h2>
                {canApply ? (
                  <>
                    <p className="mt-1 text-sm text-muted">Sets the booking amount and marks an inquiry as quoted. Nothing is sent to the client; you share the price yourself.</p>
                    <div className="mt-3"><ApplyQuoteForm quoteId={quote.id} defaultAmount={suggestedMidpoint(suggestion)} /></div>
                  </>
                ) : quote.status === "applied" ? (
                  <p className="mt-1 text-sm text-muted">Already applied{quote.chosen_amount_qr !== null ? ` at ${formatQr(quote.chosen_amount_qr)}` : ""}.</p>
                ) : quote.status === "discarded" ? (
                  <p className="mt-1 text-sm text-muted">This quote was discarded.</p>
                ) : !quote.booking ? (
                  <p className="mt-1 text-sm text-muted">Not linked to a booking. Open a booking and choose Suggest a quote there to apply one.</p>
                ) : (
                  <p className="mt-1 text-sm text-muted">The booking is {BOOKING_STATUS_LABEL[quote.booking.booking_status].toLowerCase()}; its amount cannot change.</p>
                )}
                {quote.status === "draft" && <div className="mt-3 border-t border-line pt-3"><QuoteActions quoteId={quote.id} /></div>}
              </section>

              <section className="card p-4" aria-labelledby="in-h">
                <h2 id="in-h" className="eyebrow">Job inputs</h2>
                <dl className="mt-2 divide-y divide-line text-sm">
                  <Row label="Service" value={BOOKING_TYPE_LABEL[inputs.service_type]} />
                  <Row label="Hours" value={inputs.hours} />
                  <Row label="Athletes" value={inputs.athletes} />
                  <Row label="Photos" value={inputs.photos_expected} />
                  <Row label="Video" value={inputs.video ? "Yes" : "No"} />
                  <Row label="Editing" value={inputs.editing_hours !== null ? `${inputs.editing_hours} h` : null} />
                  <Row label="Travel" value={inputs.travel_cost_qr !== null ? formatQr(inputs.travel_cost_qr) : inputs.travel_km !== null ? `${inputs.travel_km} km` : null} />
                  <Row label="Video partner" value={inputs.video_partner_cost_qr !== null ? formatQr(inputs.video_partner_cost_qr) : null} />
                  <Row label="Other costs" value={inputs.other_costs_qr !== null ? formatQr(inputs.other_costs_qr) : null} />
                  <Row label="Margin" value={`${inputs.margin_percent}%`} />
                  <Row label="Hourly target" value={inputs.target_hourly_qr !== null ? formatQr(inputs.target_hourly_qr) : null} />
                  <Row label="Notes" value={quote.notes} />
                </dl>
                <Link href={quote.booking ? `/pricing/quote?booking=${quote.booking.id}` : "/pricing/quote"} className="btn-secondary mt-3 min-h-11 w-full">New suggestion with other inputs</Link>
              </section>
            </div>
          </div>
        )}
      </PageBody>
    </>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="flex gap-3 py-1.5">
      <dt className="w-24 shrink-0 text-muted">{label}</dt>
      <dd className="min-w-0 flex-1 break-words text-ink">{value}</dd>
    </div>
  );
}
