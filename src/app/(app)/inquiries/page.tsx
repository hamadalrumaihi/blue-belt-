import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BrandHeader } from "@/components/BrandHeader";
import { PageBody } from "@/components/AppShell";
import { EmptyState } from "@/components/EmptyState";
import { MailIcon, SearchIcon } from "@/components/icons";
import { INQUIRY_CATEGORIES, INQUIRY_CATEGORY_LABEL, INQUIRY_STATUS_LABEL, INQUIRY_STATUSES, isInquiryCategory, isInquiryStatus, readInquiryNotes } from "@/lib/inquiries/labels";
import { listInquiries, summariseInquiries } from "@/lib/inquiries/queries";
import { requireOwner } from "@/lib/roles";
import { formatStamp } from "@/lib/time";
import { cn } from "@/lib/utils";
import { InquiryControls } from "./InquiryRow";

export const metadata: Metadata = { title: "Inquiries" };
export const dynamic = "force-dynamic";

const FILTERS = [{ value: "open", label: "Open" }, ...INQUIRY_STATUSES.map((s) => ({ value: s, label: INQUIRY_STATUS_LABEL[s] })), { value: "all", label: "All" }] as const;

function one(v: string | string[] | undefined): string | null {
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === "string" && s ? s : null;
}

/**
 * The Contact & Inquiries inbox: filter by status and category, search by
 * reference, name, e-mail, subject or message, change status, keep private
 * notes and convert an inquiry to a quote-first booking. Owner only; nothing
 * here is ever public.
 */
export default async function InquiriesPage({ searchParams }: PageProps<"/inquiries">) {
  if (!(await requireOwner()).ok) redirect("/coverage");
  const params = await searchParams;
  const rawStatus = one(params.status);
  const status = rawStatus === "all" ? "all" : isInquiryStatus(rawStatus) ? rawStatus : "open";
  const rawCategory = one(params.category);
  const category = isInquiryCategory(rawCategory) ? rawCategory : null;
  const q = one(params.q);
  const rows = await listInquiries({ status, category, q });
  const stats = summariseInquiries(rows);
  const now = new Date();
  const href = (next: { status?: string; category?: string | null; q?: string | null }) => {
    const p = new URLSearchParams();
    const s = next.status ?? status;
    if (s !== "open") p.set("status", s);
    const c = next.category === undefined ? category : next.category;
    if (c) p.set("category", c);
    const term = next.q === undefined ? q : next.q;
    if (term) p.set("q", term);
    const str = p.toString();
    return str ? `/inquiries?${str}` : "/inquiries";
  };

  return (
    <>
      <BrandHeader title="Inquiries" subtitle="Messages from the Contact & Inquiries page. Answer by e-mail, keep notes here, convert the real ones into bookings." />
      <PageBody>
        <form action="/inquiries" method="get" role="search" className="mb-4">
          {status !== "open" && <input type="hidden" name="status" value={status} />}
          {category && <input type="hidden" name="category" value={category} />}
          <label htmlFor="inquiry-search" className="sr-only">Search inquiries</label>
          <div className="flex min-h-11 items-center gap-2 rounded-xl border border-line bg-white px-3">
            <SearchIcon size={16} className="text-muted" />
            <input id="inquiry-search" name="q" type="search" defaultValue={q ?? ""} placeholder="Reference, name, e-mail, subject or words from the message" className="min-w-0 flex-1 bg-transparent text-sm focus:outline-none" />
            <button type="submit" className="btn-primary min-h-9 px-3 text-xs">Search</button>
          </div>
        </form>
        <nav className="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4 pb-1" aria-label="Filter by status">
          {FILTERS.map((f) => (
            <Link key={f.value} href={href({ status: f.value })} aria-current={status === f.value ? "page" : undefined} className={cn("btn min-h-10 shrink-0 rounded-full px-4", status === f.value ? "bg-navy text-white" : "border border-line bg-white text-ink hover:bg-lightblue")}>
              {f.label}
            </Link>
          ))}
        </nav>
        <nav className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1" aria-label="Filter by inquiry type">
          <Link href={href({ category: null })} aria-current={!category ? "page" : undefined} className={cn("btn min-h-9 shrink-0 rounded-full px-3 text-xs", !category ? "bg-primary text-white" : "border border-line bg-white text-ink hover:bg-lightblue")}>All types</Link>
          {INQUIRY_CATEGORIES.map((c) => (
            <Link key={c} href={href({ category: c })} aria-current={category === c ? "page" : undefined} className={cn("btn min-h-9 shrink-0 rounded-full px-3 text-xs", category === c ? "bg-primary text-white" : "border border-line bg-white text-ink hover:bg-lightblue")}>
              {INQUIRY_CATEGORY_LABEL[c].en}
            </Link>
          ))}
        </nav>
        <p className="mb-3 text-xs text-muted">{rows.length} shown · {stats.new} new · {stats.quoted} quoted · {stats.converted} converted to a booking. <Link href="/studio/metrics#inquiries" className="font-semibold text-primary hover:underline">Inquiry metrics</Link></p>
        {rows.length === 0 ? (
          <EmptyState icon={<MailIcon />} title={status === "open" && !category && !q ? "No open inquiries" : "Nothing matches"} description="Messages sent from the website's Contact & Inquiries page land here, with a Telegram ping if you have it set up and an acknowledgment e-mail to the sender when e-mail is on." />
        ) : (
          <ul className="space-y-3">
            {rows.map((r) => (
              <li key={r.id} className="card p-4 sm:p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <p className="text-base font-extrabold text-ink" dir="auto">{r.full_name}</p>
                      <span className="rounded-md bg-page px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted">{INQUIRY_CATEGORY_LABEL[r.category].en}</span>
                      <span className="font-mono text-xs text-muted" dir="ltr">{r.reference}</span>
                    </div>
                    <p className="mt-0.5 text-xs text-muted">{formatStamp(r.created_at, undefined, now)}{r.source_page ? ` · from ${r.source_page}` : ""}{r.booking_reference ? ` · customer ref ${r.booking_reference}` : ""}</p>
                    <p className="mt-2 text-sm font-semibold text-ink" dir="auto">{r.subject}</p>
                    <p className="mt-1 whitespace-pre-line rounded-xl bg-page px-3 py-2 text-sm text-ink" dir="auto">{r.message}</p>
                    <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                      <li><a href={`mailto:${r.email}?subject=${encodeURIComponent(`Re: ${r.subject} (${r.reference})`)}`} className="inline-flex min-h-9 items-center gap-1.5 font-semibold text-primary"><MailIcon size={16} /> <span dir="ltr">{r.email}</span></a></li>
                      {r.person_id && <li><Link href={`/people/${r.person_id}`} className="inline-flex min-h-9 items-center font-semibold text-primary">Client record</Link></li>}
                    </ul>
                  </div>
                  <div className="shrink-0 sm:max-w-sm">
                    <InquiryControls id={r.id} status={r.status} bookingId={r.booking_id} notes={readInquiryNotes(r.notes)} />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </PageBody>
    </>
  );
}
