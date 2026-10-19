import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/roles";
import { BrandHeader } from "@/components/BrandHeader";
import { PageBody } from "@/components/AppShell";
import { formatQr } from "@/lib/bookings/state";
import { INQUIRY_CATEGORY_LABEL, INQUIRY_STATUS_LABEL } from "@/lib/inquiries/labels";
import { loadStudioMetrics } from "@/lib/studio/dashboard";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Metrics" };
export const dynamic = "force-dynamic";

function Stat({ label, value, definition, tone }: { label: string; value: string; definition: string; tone?: "warning" | "success" }) {
  return (
    <div className="card p-4">
      <p className="text-xs font-semibold text-muted">{label}</p>
      <p className={cn("mt-1 text-2xl font-black tabular-nums", tone === "warning" ? "text-warning" : tone === "success" ? "text-success" : "text-ink")}>{value}</p>
      <p className="mt-1 text-[11px] leading-snug text-muted">{definition}</p>
    </div>
  );
}

const hours = (h: number | null) => (h === null ? "—" : h < 48 ? `${h} h` : `${Math.round((h / 24) * 10) / 10} days`);
const days = (d: number | null) => (d === null ? "—" : `${d} days`);

/** Internal numbers with their definitions spelled out; nothing here is shown to clients. */
export default async function MetricsPage() {
  // Owner only: money and website content are never for staff/collaborator accounts.
  if (!(await requireOwner()).ok) redirect("/coverage");
  const m = await loadStudioMetrics();
  const maxMonth = Math.max(1, ...m.months.map((x) => Math.max(x.forecastQr, x.collectedQr)));
  return (
    <>
      <BrandHeader title="Metrics" subtitle="How fast you answer, where leads come from, how quotes convert, how long delivery takes" backHref="/studio" />
      <PageBody className="max-w-5xl space-y-4">
        <p className="text-xs text-muted">Every number says what it counts. Based on {m.leadCount} lead{m.leadCount === 1 ? "" : "s"} and {m.bookingCount} booking{m.bookingCount === 1 ? "" : "s"} you have access to. <Link href="/studio" className="font-semibold text-primary hover:underline">Back to overview</Link></p>

        <section aria-labelledby="inq-h" id="inquiries" className="scroll-mt-20">
          <h2 id="inq-h" className="eyebrow mb-2">Inquiries (Contact &amp; Inquiries page)</h2>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Total inquiries" value={String(m.inquiries.total)} definition="Every message submitted through the website's Contact & Inquiries form, all time." />
            <Stat label="New inquiries" value={String(m.inquiries.new)} definition={`Not touched yet. ${m.inquiries.open} open in total (new, in progress, waiting for customer, quoted).`} tone={m.inquiries.new ? "warning" : undefined} />
            <Stat label="Quoted" value={String(m.inquiries.quoted)} definition="Inquiries you marked Quoted and that have not moved on yet." />
            <Stat label="Converted to booking" value={String(m.inquiries.converted)} definition={`Inquiries turned into a booking from the inquiries board${m.inquiries.total ? ` (${Math.round((m.inquiries.converted / m.inquiries.total) * 1000) / 10}% of all inquiries)` : ""}.`} tone={m.inquiries.converted ? "success" : undefined} />
          </div>
          {m.inquiries.byCategory.length > 0 && (
            <div className="card mt-2 p-4">
              <p className="text-[11px] text-muted">Inquiries per service / type, all time. Status split: {m.inquiries.byStatus.map((s) => `${INQUIRY_STATUS_LABEL[s.status]} ${s.count}`).join(" · ")}.</p>
              <ul className="mt-2 divide-y divide-line">
                {m.inquiries.byCategory.map((c) => (
                  <li key={c.category} className="flex items-center justify-between py-2 text-sm"><span className="text-ink">{INQUIRY_CATEGORY_LABEL[c.category].en}</span><span className="font-bold tabular-nums text-ink">{c.count}</span></li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section aria-labelledby="resp-h">
          <h2 id="resp-h" className="eyebrow mb-2">Responsiveness</h2>
          <div className="grid gap-2 sm:grid-cols-3">
            <Stat label="Median response time" value={hours(m.responseTime.medianHours)} definition="Lead created → first status change you made on it (from the audit log). Median over leads that got a response." tone={m.responseTime.medianHours !== null && m.responseTime.medianHours > 24 ? "warning" : undefined} />
            <Stat label="Average response time" value={hours(m.responseTime.meanHours)} definition={`Same measure, averaged over ${m.responseTime.count} answered lead${m.responseTime.count === 1 ? "" : "s"}.`} />
            <Stat label="Leads never touched" value={String(m.responseTime.unanswered)} definition="Leads with no status change at all, however old. Includes brand-new ones." tone={m.responseTime.unanswered ? "warning" : undefined} />
          </div>
        </section>

        <section aria-labelledby="src-h">
          <h2 id="src-h" className="eyebrow mb-2">Lead sources</h2>
          <div className="card p-4">
            <p className="text-[11px] text-muted">Count of leads per <code>source</code> value (website form, contact page, Instagram, manual…). All time.</p>
            {m.leadSources.length === 0 ? <p className="mt-2 text-sm text-muted">No leads yet.</p> : (
              <ul className="mt-2 divide-y divide-line">
                {m.leadSources.map((s) => (
                  <li key={s.source} className="flex items-center justify-between py-2 text-sm"><span className="text-ink">{s.source}</span><span className="font-bold tabular-nums text-ink">{s.count}</span></li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section aria-labelledby="conv-h">
          <h2 id="conv-h" className="eyebrow mb-2">Quotes and money</h2>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Quote conversion" value={m.quoteConversion.rate === null ? "—" : `${m.quoteConversion.rate}%`} definition={`Quoted bookings that were later confirmed ÷ quoted bookings that are decided (confirmed ${m.quoteConversion.confirmed} + cancelled ${m.quoteConversion.cancelled}). ${m.quoteConversion.open} quote${m.quoteConversion.open === 1 ? "" : "s"} still open, not counted.`} />
            <Stat label="Outstanding balance" value={formatQr(m.outstandingQr)} definition={`Deposit or balance still owed on ${m.outstandingCount} live booking${m.outstandingCount === 1 ? "" : "s"} (awaiting payment → delivered). Any month.`} tone={m.outstandingQr > 0 ? "warning" : undefined} />
            <Stat label="Median delivery time" value={days(m.deliveryDelay.medianDays)} definition="Session date → gallery delivered, over delivered / completed bookings with both dates." tone={m.deliveryDelay.medianDays !== null && m.deliveryDelay.medianDays > 14 ? "warning" : undefined} />
            <Stat label="Deliveries over 14 days" value={`${m.deliveryDelay.over14} of ${m.deliveryDelay.count}`} definition={`Average ${days(m.deliveryDelay.meanDays)}. A booking counts once it has a session date and a delivered date.`} tone={m.deliveryDelay.over14 ? "warning" : undefined} />
          </div>
        </section>

        <section className="card p-4" aria-labelledby="fc-h">
          <h2 id="fc-h" className="eyebrow">Forecast vs collected · last 6 months</h2>
          <p className="mt-1 text-[11px] text-muted">Forecast = total price of bookings confirmed in the month (what was booked). Collected = payment records with a paid date in the month (what came in). They are different things and rarely match within a month.</p>
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] font-bold uppercase tracking-wide text-muted"><th className="py-1">Month</th><th className="py-1">Forecast (booked)</th><th className="py-1">Collected (paid)</th><th className="hidden py-1 sm:table-cell" aria-hidden /></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {m.months.map((x) => (
                <tr key={x.range.start}>
                  <td className="py-2 text-ink">{x.range.label}</td>
                  <td className="py-2 tabular-nums text-ink">{formatQr(x.forecastQr)}</td>
                  <td className="py-2 tabular-nums text-success">{formatQr(x.collectedQr)}</td>
                  <td className="hidden py-2 pl-3 sm:table-cell">
                    <div className="space-y-0.5" aria-hidden>
                      <div className="h-1.5 rounded bg-ink/30" style={{ width: `${Math.round((x.forecastQr / maxMonth) * 100)}%` }} />
                      <div className="h-1.5 rounded bg-success" style={{ width: `${Math.round((x.collectedQr / maxMonth) * 100)}%` }} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </PageBody>
    </>
  );
}
