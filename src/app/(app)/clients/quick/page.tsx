import type { Metadata } from "next";
import Link from "next/link";
import { BrandHeader } from "@/components/BrandHeader";
import { PageBody } from "@/components/AppShell";
import { EmptyState } from "@/components/EmptyState";
import { CalendarIcon } from "@/components/icons";
import { listEvents } from "@/lib/queries";
import { QuickClientForm } from "./QuickClientForm";

export const metadata: Metadata = { title: "Quick add client" };
export const dynamic = "force-dynamic";

export default async function QuickClientPage({ searchParams }: PageProps<"/clients/quick">) {
  const params = await searchParams;
  const events = await listEvents();
  const defaultEventId = typeof params.event === "string" ? params.event : events.find((e) => e.active)?.id ?? null;
  return (
    <>
      <BrandHeader title="Quick add" subtitle="Just the essentials; fill in the rest later" backHref="/clients" />
      <PageBody className="max-w-xl">
        {events.length === 0 ? (
          <EmptyState icon={<CalendarIcon />} title="Create an event first" description="Clients are always attached to a tournament." action={<Link href="/events/new" className="btn-primary">Create event</Link>} />
        ) : (
          <QuickClientForm events={events} defaultEventId={defaultEventId} />
        )}
      </PageBody>
    </>
  );
}
