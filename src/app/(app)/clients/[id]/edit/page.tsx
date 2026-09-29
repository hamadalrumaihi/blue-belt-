import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BrandHeader } from "@/components/BrandHeader";
import { PageBody } from "@/components/AppShell";
import { ClientForm } from "@/components/ClientForm";
import { updateAthlete } from "@/lib/actions/clients";
import { getAthlete, listEvents } from "@/lib/queries";

export const metadata: Metadata = { title: "Edit client" };

export default async function EditClientPage({ params }: PageProps<"/clients/[id]/edit">) {
  const { id } = await params;
  const [athlete, events] = await Promise.all([getAthlete(id), listEvents()]);
  if (!athlete) notFound();
  const action = updateAthlete.bind(null, id);
  return (
    <>
      <BrandHeader title="Edit client" backHref={`/clients/${id}`} />
      <PageBody className="max-w-2xl">
        <ClientForm action={action} events={events} initial={athlete} submitLabel="Save changes" cancelHref={`/clients/${id}`} />
      </PageBody>
    </>
  );
}
