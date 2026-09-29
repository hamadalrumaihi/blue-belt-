import type { Metadata } from "next";
import Link from "next/link";
import { BrandHeader } from "@/components/BrandHeader";
import { PageBody } from "@/components/AppShell";
import { ClientForm } from "@/components/ClientForm";
import { EmptyState } from "@/components/EmptyState";
import { CalendarIcon } from "@/components/icons";
import { createAthlete } from "@/lib/actions/clients";
import { listEvents } from "@/lib/queries";

export const metadata: Metadata = { title: "Add client" };
export const dynamic = "force-dynamic";

export default async function NewClientPage({ searchParams }: PageProps<"/clients/new">) {
  const params = await searchParams;
  const events = await listEvents();
  const defaultEventId = typeof params.event === "string" ? params.event : events.find((e) => e.active)?.id ?? null;

  return (
    <>
      <BrandHeader title="Add client" backHref="/clients" />
      <PageBody className="max-w-2xl">
        {events.length === 0 ? (
          <EmptyState icon={<CalendarIcon />} title="Create an event first" description="Clients are always attached to a tournament." action={<Link href="/events/new" className="btn-primary">Create event</Link>} />
        ) : (
          <ClientForm action={createAthlete} events={events} defaultEventId={defaultEventId} submitLabel="Add client" />
        )}
      </PageBody>
    </>
  );
}
