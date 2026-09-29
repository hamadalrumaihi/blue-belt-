import type { Metadata } from "next";
import Link from "next/link";
import { BrandHeader } from "@/components/BrandHeader";
import { PageBody } from "@/components/AppShell";
import { EmptyState } from "@/components/EmptyState";
import { EventCard } from "@/components/EventCard";
import { CalendarIcon, PlusIcon } from "@/components/icons";
import { pickCurrentMatch, computeEta } from "@/lib/eta";
import { eventStats, listAthletes, listEvents } from "@/lib/queries";
import { SeedFirstEventButton } from "../dashboard/SeedFirstEventButton";

export const metadata: Metadata = { title: "Events" };
export const dynamic = "force-dynamic";

export default async function EventsPage() {
  const events = await listEvents();
  const [stats, athletes] = await Promise.all([eventStats(events.map((e) => e.id)), listAthletes()]);

  const now = new Date();
  const nextByEvent = new Map<string, string>();
  for (const e of events) {
    const mine = athletes.filter((a) => a.event_id === e.id && a.active);
    let best: { name: string; priority: number } | null = null;
    for (const a of mine) {
      const m = pickCurrentMatch(a.matches, now);
      if (!m) continue;
      const eta = computeEta(m, now);
      if (eta.bucket === "COMPLETE" || eta.bucket === "UNKNOWN") continue;
      if (!best || eta.priority < best.priority) best = { name: a.name, priority: eta.priority };
    }
    if (best) nextByEvent.set(e.id, best.name);
  }

  return (
    <>
      <BrandHeader title="Events" subtitle="Tournaments you are covering" actions={<Link href="/events/new" className="btn-primary min-h-10"><PlusIcon size={18} /> New</Link>} />
      <PageBody>
        {events.length === 0 ? (
          <EmptyState
            icon={<CalendarIcon />}
            title="No events yet"
            description="Set up the first live test event or create your own."
            action={<div className="flex flex-col gap-2 sm:flex-row"><SeedFirstEventButton /><Link href="/events/new" className="btn-secondary">Create event</Link></div>}
          />
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {events.map((e) => (
              <li key={e.id}>
                <EventCard event={e} clients={stats.get(e.id)?.clients ?? 0} matches={stats.get(e.id)?.matches ?? 0} nextClient={nextByEvent.get(e.id) ?? null} />
              </li>
            ))}
          </ul>
        )}
      </PageBody>
    </>
  );
}
