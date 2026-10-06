import type { Metadata } from "next";
import { BrandHeader } from "@/components/BrandHeader";
import { PageBody } from "@/components/AppShell";
import { createBooking } from "@/lib/actions/bookings";
import { listOrganizationOptions } from "@/lib/organizations/queries";
import { listPeopleOptions } from "@/lib/people/queries";
import { listEvents } from "@/lib/queries";
import { listServices } from "@/lib/studio/queries";
import { isUuid } from "@/lib/validation";
import { BookingForm } from "../BookingForm";

export const metadata: Metadata = { title: "New booking" };
export const dynamic = "force-dynamic";

export default async function NewBookingPage({ searchParams }: PageProps<"/bookings/new">) {
  const params = await searchParams;
  const [people, organizations, services, events] = await Promise.all([listPeopleOptions(), listOrganizationOptions(), listServices(), listEvents()]);
  const defaultClientId = typeof params.client === "string" && isUuid(params.client) ? params.client : null;
  const defaultEventId = typeof params.event === "string" && isUuid(params.event) ? params.event : null;
  return (
    <>
      <BrandHeader title="New booking" subtitle="Capture a request by hand — the client is matched or created for you" backHref="/bookings" />
      <PageBody className="max-w-2xl">
        <BookingForm action={createBooking} people={people} organizations={organizations} services={services} events={events} defaultClientId={defaultClientId} defaultEventId={defaultEventId} submitLabel="Create booking" />
      </PageBody>
    </>
  );
}
