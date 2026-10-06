import type { Metadata } from "next";
import Link from "next/link";
import { BrandHeader } from "@/components/BrandHeader";
import { PageBody } from "@/components/AppShell";
import { EmptyState } from "@/components/EmptyState";
import { EventSwitcher } from "@/components/EventSwitcher";
import { CalendarIcon } from "@/components/icons";
import { redirect } from "next/navigation";
import { resolveViewerMode } from "@/lib/collaborator";
import { listAthletes, listEvents, listHistory, pickCurrentEvent } from "@/lib/queries";
import { OpenIssuesLink } from "@/components/OpenIssuesLink";
import { DashboardLive } from "./DashboardLive";
import { SeedFirstEventButton } from "./SeedFirstEventButton";

export const metadata: Metadata = { title: "Tournament day" };
export const dynamic = "force-dynamic";

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  // Sign-in lands everyone here; a collaborator-only account has no dashboard
  // of its own, so send it to its coverage board.
  if ((await resolveViewerMode()).collaboratorOnly) redirect("/coverage");
  const params = await searchParams;
  const preferred = typeof params.event === "string" ? params.event : null;
  const events = await listEvents();
  const current = pickCurrentEvent(events, preferred);

  if (!current) {
    return (
      <>
        <BrandHeader title="Tournament day" subtitle="Who do I photograph next, where, and how soon?" />
        <PageBody>
          <EmptyState
            icon={<CalendarIcon />}
            title="No event yet"
            description="Set up the first live test event, or create your own."
            action={
              <div className="flex flex-col gap-2 sm:flex-row">
                <SeedFirstEventButton />
                <Link href="/events/new" className="btn-secondary">Create event</Link>
              </div>
            }
          />
        </PageBody>
      </>
    );
  }

  const [athletes, history] = await Promise.all([
    listAthletes(current.id),
    listHistory({ eventId: current.id, limit: 60 }),
  ]);

  return (
    <>
      <BrandHeader
        title="Tournament day"
        subtitle="Who do I photograph next, where, and how soon?"
        actions={<EventSwitcher events={events} currentId={current.id} />}
      />
      <PageBody>
        <OpenIssuesLink />
        <DashboardLive event={current} athletes={athletes} history={history} />
      </PageBody>
    </>
  );
}
