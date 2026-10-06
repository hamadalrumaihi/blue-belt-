import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BrandHeader } from "@/components/BrandHeader";
import { PageBody } from "@/components/AppShell";
import { updateBooking } from "@/lib/actions/bookings";
import { getBooking } from "@/lib/bookings/queries";
import { listOrganizationOptions } from "@/lib/organizations/queries";
import { listPeopleOptions } from "@/lib/people/queries";
import { listEvents } from "@/lib/queries";
import { listServices } from "@/lib/studio/queries";
import { isUuid } from "@/lib/validation";
import { BookingForm } from "../../BookingForm";

export const metadata: Metadata = { title: "Edit booking" };
export const dynamic = "force-dynamic";

export default async function EditBookingPage({ params }: PageProps<"/bookings/[id]/edit">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const detail = await getBooking(id);
  if (!detail) notFound();
  const [people, organizations, services, events] = await Promise.all([listPeopleOptions(), listOrganizationOptions(), listServices(), listEvents()]);
  const action = updateBooking.bind(null, id);
  return (
    <>
      <BrandHeader title="Edit booking" subtitle={detail.booking.public_ref ?? undefined} backHref={`/bookings/${id}`} />
      <PageBody className="max-w-2xl">
        {detail.booking.booking_status === "confirmed" && <p className="mb-4 rounded-xl bg-lightblue px-3 py-2 text-xs text-primary">This booking is confirmed: changing the date, time or place e-mails the client about the change.</p>}
        <BookingForm action={action} initial={detail.booking} people={people} organizations={organizations} services={services} events={events} submitLabel="Save changes" cancelHref={`/bookings/${id}`} />
      </PageBody>
    </>
  );
}
