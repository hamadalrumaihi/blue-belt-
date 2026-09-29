import type { Metadata } from "next";
import Link from "next/link";
import { BrandHeader } from "@/components/BrandHeader";
import { PageBody } from "@/components/AppShell";
import { EmptyState } from "@/components/EmptyState";
import { EventSwitcher } from "@/components/EventSwitcher";
import { EyeIcon } from "@/components/icons";
import { listAthletes, listEvents, listHistory, pickCurrentEvent } from "@/lib/queries";
import { WatcherLive } from "./WatcherLive";

export const metadata: Metadata = { title: "Match Watcher" };
export const dynamic = "force-dynamic";

export default async function WatcherPage({ searchParams }: PageProps<"/watcher">) {
  const params = await searchParams;
  const preferred = typeof params.event === "string" ? params.event : null;
  const events = await listEvents();
  const current = pickCurrentEvent(events, preferred);

  if (!current) {
    return (
      <>
        <BrandHeader title="Match Watcher" />
        <PageBody>
          <EmptyState icon={<EyeIcon />} title="No event to watch" description="Create an event and add clients first." action={<Link href="/events/new" className="btn-primary">Create event</Link>} />
        </PageBody>
      </>
    );
  }

  const [athletes, history] = await Promise.all([listAthletes(current.id), listHistory({ eventId: current.id, limit: 60 })]);

  return (
    <>
      <BrandHeader title="Match Watcher" subtitle={current.name} actions={<EventSwitcher events={events} currentId={current.id} />} />
      <PageBody>
        <WatcherLive event={current} athletes={athletes} history={history} />
      </PageBody>
    </>
  );
}
