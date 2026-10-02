import type { Metadata } from "next";
import Link from "next/link";
import { BrandHeader } from "@/components/BrandHeader";
import { PageBody } from "@/components/AppShell";
import { EmptyState } from "@/components/EmptyState";
import { PlusIcon, UsersIcon } from "@/components/icons";
import { listAthletes, listEvents } from "@/lib/queries";
import { ClientsList } from "./ClientsList";

export const metadata: Metadata = { title: "Clients" };
export const dynamic = "force-dynamic";

export default async function ClientsPage({ searchParams }: PageProps<"/clients">) {
  const params = await searchParams;
  const eventFilter = typeof params.event === "string" ? params.event : null;
  const [athletes, events] = await Promise.all([listAthletes(), listEvents()]);

  return (
    <>
      <BrandHeader title="Clients" subtitle="Pre-booked athletes" actions={
          <div className="flex gap-2">
            <Link href="/clients/quick" className="btn-secondary min-h-10 px-3 text-xs">Quick add</Link>
            <Link href="/clients/new" className="btn-primary min-h-10"><PlusIcon size={18} /> Add</Link>
          </div>
        } />
      <PageBody>
        {athletes.length === 0 ? (
          <EmptyState
            icon={<UsersIcon />}
            title="No clients added yet."
            description="Add each pre-booked athlete with their AJP or Smoothcomp link."
            action={<Link href="/clients/new" className="btn-primary"><PlusIcon size={18} /> Add First Client</Link>}
          />
        ) : (
          <>
            <ClientsList athletes={athletes} events={events} initialEventId={eventFilter} />
            <p className="pt-3 text-center text-xs text-muted">
              <Link href="/clients/import" className="font-semibold text-primary">Import clients from CSV</Link>
            </p>
          </>
        )}
      </PageBody>
    </>
  );
}
