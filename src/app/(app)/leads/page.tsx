import type { Metadata } from "next";
import Link from "next/link";
import { BrandHeader } from "@/components/BrandHeader";
import { PageBody } from "@/components/AppShell";
import { EmptyState } from "@/components/EmptyState";
import { InboxIcon, InstagramIcon, MailIcon, PhoneIcon } from "@/components/icons";
import { BOOKING_TYPE_LABEL } from "@/lib/bookings/state";
import { LEAD_STATUSES, LEAD_STATUS_LABEL, isLeadStatus } from "@/lib/leads/labels";
import { listLeads } from "@/lib/leads/queries";
import { formatStamp } from "@/lib/time";
import { cn } from "@/lib/utils";
import { isPlainObject } from "@/lib/validation";
import { LeadControls } from "./LeadRow";

export const metadata: Metadata = { title: "Leads" };
export const dynamic = "force-dynamic";

const FILTERS = [{ value: "open", label: "Open" }, ...LEAD_STATUSES.map((s) => ({ value: s, label: LEAD_STATUS_LABEL[s] })), { value: "all", label: "All" }] as const;

function detailLine(details: unknown): string | null {
  if (!isPlainObject(details)) return null;
  const bits: string[] = [];
  if (typeof details.event_name === "string") bits.push(details.event_name);
  if (typeof details.competition_date === "string") bits.push(details.competition_date);
  if (typeof details.requested_date === "string") bits.push(`${details.requested_date}${typeof details.requested_time === "string" ? ` ${details.requested_time}` : ""}`);
  if (typeof details.service_name === "string") bits.push(details.service_name);
  if (typeof details.athlete_count === "number") bits.push(`${details.athlete_count} athletes`);
  if (typeof details.coverage === "string") bits.push(details.coverage === "both" ? "photo + video" : details.coverage);
  return bits.length ? bits.join(" · ") : null;
}

export default async function LeadsPage({ searchParams }: PageProps<"/leads">) {
  const params = await searchParams;
  const raw = Array.isArray(params.status) ? params.status[0] : params.status;
  const filter = raw === "all" ? "all" : isLeadStatus(raw) ? raw : "open";
  const leads = await listLeads(filter === "all" ? {} : { status: filter });
  const now = new Date();
  return (
    <>
      <BrandHeader title="Leads" subtitle="Website requests and messages. Convert the real ones into bookings." />
      <PageBody>
        <nav className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1" aria-label="Filter">
          {FILTERS.map((f) => (
            <Link key={f.value} href={f.value === "open" ? "/leads" : `/leads?status=${f.value}`} aria-current={filter === f.value ? "page" : undefined} className={cn("btn min-h-10 shrink-0 rounded-full px-4", filter === f.value ? "bg-navy text-white" : "border border-line bg-white text-ink hover:bg-lightblue")}>
              {f.label}
            </Link>
          ))}
        </nav>
        {leads.length === 0 ? (
          <EmptyState icon={<InboxIcon />} title={filter === "open" ? "No open leads" : "Nothing here"} description="Booking requests and contact messages from the website land here, with a Telegram ping if you have it set up." />
        ) : (
          <ul className="space-y-3">
            {leads.map((l) => {
              const detail = detailLine(l.details);
              const name = l.person?.full_name ?? "Unknown";
              return (
                <li key={l.id} className="card p-4 sm:p-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <p className="text-base font-extrabold text-ink">{name}</p>
                        {l.organization && <span className="text-sm text-muted">· {l.organization.name}</span>}
                        <span className="rounded-md bg-page px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted">{l.booking_type ? BOOKING_TYPE_LABEL[l.booking_type] : "Message"}</span>
                      </div>
                      <p className="mt-0.5 text-xs text-muted">{formatStamp(l.created_at, undefined, now)} · via {l.source}{l.event ? ` · ${l.event.name}` : ""}</p>
                      {detail && <p className="mt-2 text-sm text-ink">{detail}</p>}
                      {l.message && <p className="mt-2 whitespace-pre-line rounded-xl bg-page px-3 py-2 text-sm text-ink">{l.message}</p>}
                      {l.person && (
                        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                          {l.person.phone && <li><a href={`tel:${l.person.phone}`} className="inline-flex min-h-9 items-center gap-1.5 font-semibold text-primary"><PhoneIcon size={16} /> {l.person.phone}</a></li>}
                          {l.person.email && <li><a href={`mailto:${l.person.email}`} className="inline-flex min-h-9 items-center gap-1.5 font-semibold text-primary"><MailIcon size={16} /> {l.person.email}</a></li>}
                          {l.person.instagram && <li><a href={`https://instagram.com/${l.person.instagram}`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 items-center gap-1.5 font-semibold text-primary"><InstagramIcon size={16} /> @{l.person.instagram}</a></li>}
                        </ul>
                      )}
                    </div>
                    <div className="shrink-0">
                      <LeadControls id={l.id} status={l.status} bookingId={l.booking_id} />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </PageBody>
    </>
  );
}
