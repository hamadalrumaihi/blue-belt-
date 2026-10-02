import type { Metadata } from "next";
import Link from "next/link";
import { BrandHeader } from "@/components/BrandHeader";
import { PageBody } from "@/components/AppShell";
import { EmptyState } from "@/components/EmptyState";
import { CalendarIcon } from "@/components/icons";
import { listEvents } from "@/lib/queries";
import { ImportForm } from "./ImportForm";

export const metadata: Metadata = { title: "Import clients" };
export const dynamic = "force-dynamic";

export default async function ImportClientsPage({ searchParams }: PageProps<"/clients/import">) {
  const params = await searchParams;
  const events = await listEvents();
  const defaultEventId = typeof params.event === "string" ? params.event : events.find((e) => e.active)?.id ?? null;
  return (
    <>
      <BrandHeader title="Import clients" subtitle="CSV with a header row" backHref="/clients" />
      <PageBody className="max-w-2xl">
        {events.length === 0 ? (
          <EmptyState icon={<CalendarIcon />} title="Create an event first" description="Clients are always attached to a tournament." action={<Link href="/events/new" className="btn-primary">Create event</Link>} />
        ) : (
          <ImportForm events={events} defaultEventId={defaultEventId} />
        )}
      </PageBody>
    </>
  );
}
