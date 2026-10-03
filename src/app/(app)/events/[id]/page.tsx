import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BrandHeader } from "@/components/BrandHeader";
import { PageBody } from "@/components/AppShell";
import { ChangeHistory } from "@/components/ChangeHistory";
import { EmptyState } from "@/components/EmptyState";
import { eventStatus } from "@/components/EventCard";
import { LiveIndicator } from "@/components/LiveIndicator";
import { PlatformBadge } from "@/components/PlatformBadge";
import { SourceLinkButton } from "@/components/SourceLinkButton";
import { EditIcon, EyeIcon, MapPinIcon, PlusIcon, UsersIcon } from "@/components/icons";
import { rankAthletes } from "@/lib/eta";
import { getEvent, listAthletes, listHistory } from "@/lib/queries";
import { formatEventDate } from "@/lib/time";
import { EventClientsList } from "./EventClientsList";
import { EventDangerZone } from "./EventDangerZone";
import { EventTeam } from "./EventTeam";
import { loadEventTeam } from "@/lib/collaborator";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/events/[id]">): Promise<Metadata> {
  const { id } = await params;
  const event = await getEvent(id);
  return { title: event?.name ?? "Event" };
}

export default async function EventDetailPage({ params }: PageProps<"/events/[id]">) {
  const { id } = await params;
  const event = await getEvent(id);
  if (!event) notFound();

  const [athletes, history, team] = await Promise.all([listAthletes(id), listHistory({ eventId: id, limit: 30 }), loadEventTeam(id)]);
  const ranked = rankAthletes(athletes);
  const matchCount = athletes.reduce((n, a) => n + a.matches.length, 0);
  const next = ranked.find((r) => r.match && r.eta.bucket !== "COMPLETE" && r.eta.bucket !== "UNKNOWN");

  return (
    <>
      <BrandHeader title={event.name} backHref="/events" actions={<Link href={`/events/${id}/edit`} className="btn-secondary min-h-10"><EditIcon size={16} /> Edit</Link>} />
      <PageBody>
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <section className="card p-4">
              <div className="flex flex-wrap items-center gap-2">
                <PlatformBadge platform={event.platform} />
                <LiveIndicator status={eventStatus(event)} />
              </div>
              <h2 className="mt-2 text-xl font-extrabold leading-snug text-ink">{event.name}</h2>
              <p className="mt-1 flex items-center gap-1 text-sm text-muted"><MapPinIcon size={14} /> {[event.venue, event.country].filter(Boolean).join(", ") || "Venue TBC"}</p>
              <p className="text-sm font-semibold text-ink">{formatEventDate(event.event_date)} · {event.timezone}</p>
              <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-line pt-3 text-center">
                <div><dt className="eyebrow">Clients</dt><dd className="text-2xl font-black">{athletes.length}</dd></div>
                <div><dt className="eyebrow">Matches</dt><dd className="text-2xl font-black">{matchCount}</dd></div>
                <div className="min-w-0"><dt className="eyebrow">Next up</dt><dd className="truncate text-sm font-bold text-primary">{next?.athlete.name ?? "—"}</dd></div>
              </dl>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link href={`/watcher?event=${event.id}`} className="btn-primary"><EyeIcon size={18} /> Open Match Watcher</Link>
                <Link href={`/clients/new?event=${event.id}`} className="btn-secondary"><PlusIcon size={18} /> Add client</Link>
                {event.source_url && <SourceLinkButton url={event.source_url} platform={event.platform} label="Event page" />}
              </div>
            </section>

            <section>
              <h3 className="mb-2 text-sm font-extrabold uppercase tracking-wider text-muted">Clients</h3>
              {athletes.length === 0 ? (
                <EmptyState compact icon={<UsersIcon />} title="No clients added yet." action={<Link href={`/clients/new?event=${event.id}`} className="btn-primary"><PlusIcon size={18} /> Add First Client</Link>} />
              ) : (
                <EventClientsList entries={ranked} timezone={event.timezone} />
              )}
            </section>
          </div>

          <div className="space-y-4">
            <section>
              <h3 className="mb-2 text-sm font-extrabold uppercase tracking-wider text-muted">Recent changes</h3>
              <ChangeHistory entries={history} timezone={event.timezone} />
              {history.length > 0 && <Link href={`/history?event=${event.id}`} className="btn-ghost mt-2 w-full text-primary">View full history</Link>}
            </section>

            <EventTeam eventId={event.id} members={team} />

            <EventDangerZone eventId={event.id} eventName={event.name} clients={athletes.length} matches={matchCount} />
          </div>
        </div>
      </PageBody>
    </>
  );
}
