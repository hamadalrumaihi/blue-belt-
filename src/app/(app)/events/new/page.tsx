import type { Metadata } from "next";
import { BrandHeader } from "@/components/BrandHeader";
import { PageBody } from "@/components/AppShell";
import { EventForm } from "@/components/EventForm";
import { createEvent } from "@/lib/actions/events";

export const metadata: Metadata = { title: "New event" };

export default function NewEventPage() {
  return (
    <>
      <BrandHeader title="New event" backHref="/events" />
      <PageBody className="max-w-2xl">
        <EventForm action={createEvent} submitLabel="Create event" />
      </PageBody>
    </>
  );
}
