import type { Metadata } from "next";
import Link from "next/link";
import { BrandHeader } from "@/components/BrandHeader";
import { PageBody } from "@/components/AppShell";
import { EmptyState } from "@/components/EmptyState";
import { EditIcon, ExternalIcon, PlusIcon, TagIcon } from "@/components/icons";
import { BOOKING_TYPE_LABEL, BOOKING_TYPES, formatQr, isBookingType } from "@/lib/bookings/state";
import { includesSummary, priceReferenceIncludes } from "@/lib/pricing/form";
import { listPriceReferences, listQuotes } from "@/lib/pricing/queries";
import { requireOwner } from "@/lib/roles";
import { formatEventDate, formatStamp } from "@/lib/time";
import { cn } from "@/lib/utils";
import { OwnerOnly, QuoteStatusPill } from "./OwnerOnly";
import { ReferenceRowActions } from "./ReferenceRowActions";

export const metadata: Metadata = { title: "Pricing" };
export const dynamic = "force-dynamic";

export default async function PricingPage({ searchParams }: PageProps<"/pricing">) {
  const owner = await requireOwner();
  if (!owner.ok) return <OwnerOnly />;
  const params = await searchParams;
  const type = typeof params.type === "string" && isBookingType(params.type) ? params.type : null;
  const [references, quotes] = await Promise.all([listPriceReferences({ serviceType: type }), listQuotes({ limit: 20 })]);

  return (
    <>
      <BrandHeader
        title="Pricing"
        subtitle="What other providers charge, and quote suggestions built from it. Owner only; nothing here reaches a client."
        actions={<Link href="/pricing/quote" className="btn-primary min-h-10"><TagIcon size={18} /> Suggest a quote</Link>}
      />
      <PageBody className="max-w-4xl space-y-8">
        <section aria-labelledby="refs-h">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 id="refs-h" className="eyebrow">Reference prices</h2>
            <Link href="/pricing/references/new" className="btn-secondary min-h-10"><PlusIcon size={16} /> New reference</Link>
          </div>
          <div className="mb-3 flex flex-wrap gap-1.5 text-xs">
            <Link href="/pricing" className={cn("rounded-md px-2 py-1 font-semibold", !type ? "bg-ink text-white" : "text-muted hover:text-ink")}>Any service</Link>
            {BOOKING_TYPES.map((t) => (
              <Link key={t} href={`/pricing?type=${t}`} className={cn("rounded-md px-2 py-1 font-semibold", type === t ? "bg-ink text-white" : "text-muted hover:text-ink")}>{BOOKING_TYPE_LABEL[t]}</Link>
            ))}
          </div>
          {references.length === 0 ? (
            <EmptyState
              compact
              icon={<TagIcon />}
              title={type ? `No references for ${BOOKING_TYPE_LABEL[type].toLowerCase()} yet` : "No reference prices yet"}
              description="Add what other photographers and studios charge for comparable work. Quote suggestions are built from these."
              action={<Link href="/pricing/references/new" className="btn-primary">Add a reference</Link>}
            />
          ) : (
            <ul className="card divide-y divide-line">
              {references.map((r) => {
                const inc = priceReferenceIncludes(r);
                const summary = includesSummary(inc);
                return (
                  <li key={r.id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-extrabold text-ink">{r.provider}{r.location ? <span className="font-normal text-muted"> · {r.location}</span> : null}</p>
                        <p className="text-xs text-muted">{BOOKING_TYPE_LABEL[r.service_type]} · checked {formatEventDate(r.checked_on, "short")}</p>
                        {summary && <p className="mt-1 text-xs text-muted">{summary}</p>}
                        {r.notes && <p className="mt-1 line-clamp-2 text-xs text-muted">{r.notes}</p>}
                      </div>
                      <p className="shrink-0 text-right text-sm font-black tabular-nums text-ink">
                        {formatQr(r.price_from)}{r.price_to !== null && Number(r.price_to) !== Number(r.price_from) ? <><br /><span className="text-xs font-semibold text-muted">to {formatQr(r.price_to)}</span></> : null}
                        {r.currency !== "QAR" && <span className="block text-[10px] font-bold uppercase text-warning">{r.currency}</span>}
                      </p>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {r.source_url && <a href={r.source_url} target="_blank" rel="noopener noreferrer nofollow" className="btn-ghost min-h-10 text-primary"><ExternalIcon size={16} /> Source</a>}
                      <Link href={`/pricing/references/${r.id}/edit`} className="btn-secondary min-h-10"><EditIcon size={16} /> Edit</Link>
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
            <EmptyState compact title="No quotes yet" description="Describe a job and get a suggested price range from your reference prices. You decide the final amount." action={<Link href="/pricing/quote" className="btn-primary">Suggest a quote</Link>} />
          ) : (
            <ul className="card divide-y divide-line">
              {quotes.map((q) => (
                <li key={q.id}>
                  <Link href={`/pricing/quote/${q.id}`} className="flex min-h-14 items-center gap-3 px-4 py-3 hover:bg-page">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-ink">
                        {q.booking ? <>{q.booking.customer_name} <span className="font-mono text-xs text-muted">{q.booking.public_ref ?? ""}</span></> : <span className="text-muted">No booking</span>}
                      </p>
                      <p className="text-xs text-muted">{formatStamp(q.created_at)}</p>
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
