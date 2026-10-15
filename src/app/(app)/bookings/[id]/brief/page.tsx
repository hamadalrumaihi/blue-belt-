import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BrandHeader } from "@/components/BrandHeader";
import { PageBody } from "@/components/AppShell";
import { Logo } from "@/components/Logo";
import { briefToText, buildBrief, type BriefAthlete } from "@/lib/bookings/brief";
import { getBooking } from "@/lib/bookings/queries";
import { BOOKING_TYPE_LABEL } from "@/lib/bookings/state";
import { loadEventTeam } from "@/lib/collaborator";
import { createClient } from "@/lib/supabase/server";
import { formatEventDate, formatStamp } from "@/lib/time";
import { cn } from "@/lib/utils";
import { isUuid } from "@/lib/validation";
import { CopyBriefButton } from "../BriefPanel";

export const dynamic = "force-dynamic";

const ATHLETE_COLS = "id,name,division,academy,belt,weight,age_category,source_url";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const detail = isUuid(id) ? await getBooking(id) : null;
  return { title: detail ? `Brief: ${detail.booking.public_ref ?? detail.booking.customer_name}` : "Brief" };
}

/** Printable shoot brief. The print stylesheet below hides the shell and keeps the sheet to the page. */
export default async function BriefPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const detail = await getBooking(id);
  if (!detail) notFound();
  const { booking, client, organization, service, event, documents } = detail;
  const supabase = await createClient();
  const [athlete, roster, coverage, team] = await Promise.all([
    booking.watcher_athlete_id ? supabase.from("photo_athletes").select(ATHLETE_COLS).eq("id", booking.watcher_athlete_id).maybeSingle() : Promise.resolve({ data: null }),
    booking.event_id && (booking.booking_type === "club" || booking.booking_type === "custom") ? supabase.from("photo_athletes").select(ATHLETE_COLS).eq("event_id", booking.event_id).eq("active", true).order("name").limit(200) : Promise.resolve({ data: [] as BriefAthlete[] }),
    booking.event_id ? supabase.from("photo_coverage").select("athlete_id,photographer_id,videographer_id").eq("event_id", booking.event_id).limit(500) : Promise.resolve({ data: [] }),
    booking.event_id ? loadEventTeam(booking.event_id) : Promise.resolve([]),
  ]);
  const now = new Date();
  const brief = buildBrief({ booking, client, organization, service, event, athlete: (athlete?.data as BriefAthlete | null) ?? null, roster: (roster.data ?? []) as BriefAthlete[], coverage: coverage.data ?? [], team, documents, now });
  const text = briefToText(brief);

  return (
    <>
      <style>{`@media print { header, nav, aside, .print\\:hidden { display: none !important; } main { padding: 0 !important; max-width: none !important; } .card { box-shadow: none !important; border: 1px solid #ddd !important; break-inside: avoid; } body { background: #fff !important; } .lg\\:pl-64 { padding-left: 0 !important; } }`}</style>
      <div className="print:hidden"><BrandHeader title="Shoot brief" subtitle={`${brief.ref} · ${BOOKING_TYPE_LABEL[brief.bookingType]}`} backHref={`/bookings/${id}`} actions={<Link href={`/bookings/${id}`} className="btn-secondary min-h-10">Booking</Link>} /></div>
      <PageBody className="max-w-3xl space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="hidden print:block"><Logo variant="mark" size={32} href={null} /></div>
            <h1 className="text-2xl font-black text-ink">{brief.title}</h1>
            <p className="text-sm text-muted">{brief.ref} · {BOOKING_TYPE_LABEL[brief.bookingType]} · {brief.sessionLine}</p>
          </div>
          <CopyBriefButton text={text} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {brief.sections.map((s) => (
            <section key={s.title} className="card p-4" aria-labelledby={`brief-${s.title}`}>
              <h2 id={`brief-${s.title}`} className="eyebrow">{s.title}</h2>
              <dl className="mt-2 divide-y divide-line">
                {s.lines.map((l) => (
                  <div key={l.label} className="flex gap-3 py-1.5 text-sm">
                    <dt className="w-28 shrink-0 text-muted">{l.label}</dt>
                    <dd className="min-w-0 flex-1 break-words text-ink">{/^https?:\/\//.test(l.value) ? <a href={l.value} className="text-primary hover:underline" target="_blank" rel="noopener noreferrer">{l.value}</a> : l.value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}

          <section className="card p-4" aria-labelledby="brief-shots">
            <h2 id="brief-shots" className="eyebrow">Shot priorities</h2>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-ink">{brief.shotPriorities.map((p) => <li key={p}>{p}</li>)}</ol>
          </section>

          <section className="card p-4" aria-labelledby="brief-deliv">
            <h2 id="brief-deliv" className="eyebrow">Deliverables</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink">{brief.deliverables.map((d) => <li key={d}>{d}</li>)}</ul>
          </section>

          <section className="card p-4" aria-labelledby="brief-crew">
            <h2 id="brief-crew" className="eyebrow">Crew</h2>
            {brief.crew.length === 0 ? <p className="mt-2 text-sm text-muted">Not assigned yet. Assign on the booking (Who shoots it) or on the event&rsquo;s coverage board.</p> : (
              <ul className="mt-2 space-y-1 text-sm text-ink">
                {brief.crew.map((c) => <li key={`${c.role}:${c.userId}`}><span className="font-semibold capitalize">{c.role}</span>: {c.email ?? c.userId} <span className="text-[11px] text-muted">({c.source})</span></li>)}
              </ul>
            )}
          </section>

          {brief.roster.length > 0 && (
            <section className="card p-4 sm:col-span-2" aria-labelledby="brief-roster">
              <h2 id="brief-roster" className="eyebrow">Roster · {brief.roster.length}</h2>
              <ul className="mt-2 grid gap-1 text-sm text-ink sm:grid-cols-2">
                {brief.roster.map((a) => <li key={a.id}>{a.name}{a.division ? <span className="text-muted"> · {a.division}</span> : null}{a.belt ? <span className="text-muted"> · {a.belt}</span> : null}</li>)}
              </ul>
            </section>
          )}

          <section className="card p-4 sm:col-span-2" aria-labelledby="brief-check">
            <h2 id="brief-check" className="eyebrow">Client checklist &amp; reminders</h2>
            <p className="mt-1 text-xs text-muted">Due dates are relative to the session date. These reminders are for you; nothing is sent to the client automatically.</p>
            <ul className="mt-2 divide-y divide-line">
              {brief.checklist.map((i) => (
                <li key={i.key} className="flex items-start gap-3 py-2 text-sm">
                  <span className={cn("mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] font-bold", i.done ? "border-success bg-success-soft text-success" : i.overdue ? "border-danger bg-danger-soft text-danger" : "border-muted")} aria-hidden>{i.done ? "✓" : ""}</span>
                  <span className="min-w-0 flex-1">
                    <span className={cn("font-semibold", i.done ? "text-muted" : "text-ink")}>{i.label}</span>
                    {i.due && !i.done && <span className={cn("ml-2 text-[11px] font-bold uppercase tracking-wide", i.overdue ? "text-danger" : "text-muted")}>{i.overdue ? "overdue · " : "by "}{formatEventDate(i.due, "short")}</span>}
                    <span className="block text-xs text-muted">{i.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>
        <p className="text-[11px] text-muted">Generated {formatStamp(brief.generatedAt)}. Edit the booking to change anything here.</p>
      </PageBody>
    </>
  );
}
