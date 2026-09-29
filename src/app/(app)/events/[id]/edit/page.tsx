import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BrandHeader } from "@/components/BrandHeader";
import { PageBody } from "@/components/AppShell";
import { EventForm } from "@/components/EventForm";
import { updateEvent } from "@/lib/actions/events";
import { getEvent } from "@/lib/queries";

export const metadata: Metadata = { title: "Edit event" };

export default async function EditEventPage({ params }: PageProps<"/events/[id]/edit">) {
  const { id } = await params;
  const event = await getEvent(id);
  if (!event) notFound();
  const action = updateEvent.bind(null, id);
  return (
    <>
      <BrandHeader title="Edit event" backHref={`/events/${id}`} />
      <PageBody className="max-w-2xl">
        <EventForm action={action} initial={event} submitLabel="Save changes" cancelHref={`/events/${id}`} />
      </PageBody>
    </>
  );
}
