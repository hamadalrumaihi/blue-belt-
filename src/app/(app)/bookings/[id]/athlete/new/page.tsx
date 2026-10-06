import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BrandHeader } from "@/components/BrandHeader";
import { PageBody } from "@/components/AppShell";
import { ClientForm } from "@/components/ClientForm";
import { EmptyState } from "@/components/EmptyState";
import { CalendarIcon } from "@/components/icons";
import { createAthleteFromBooking } from "@/lib/actions/bookings";
import { getBooking } from "@/lib/bookings/queries";
import { bookingDetails } from "@/lib/bookings/state";
import { listEvents } from "@/lib/queries";
import type { AthleteRow } from "@/lib/types";
import { isUuid } from "@/lib/validation";
import { guessPlatform } from "@/lib/watchers/url-policy";

export const metadata: Metadata = { title: "Create tracked athlete" };
export const dynamic = "force-dynamic";

/**
 * EXPLICIT owner step: turn a booking into a Tournament Watcher athlete.
 * The form is prefilled from the booking and validated exactly like the
 * Athletes module; nothing is created until the owner submits it.
 */
export default async function AthleteFromBookingPage({ params }: PageProps<"/bookings/[id]/athlete/new">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const detail = await getBooking(id);
  if (!detail) notFound();
  const { booking, client } = detail;
  const d = bookingDetails(booking);
  const allEvents = await listEvents();
  const events = booking.event_id ? allEvents.filter((e) => e.id === booking.event_id) : allEvents;
  const initial: Partial<AthleteRow> = {
    name: booking.athlete_name || d.athlete_name || booking.customer_name,
    event_id: booking.event_id,
    phone: client?.phone ?? booking.customer_phone ?? null,
    email: client?.email ?? booking.customer_email ?? null,
    academy: d.academy ?? booking.academy ?? null,
    belt: d.belt ?? null,
    age_category: d.age_division ?? null,
    weight: d.weight_division ?? null,
    division: booking.division ?? ([d.age_division, d.weight_division].filter(Boolean).join(" · ") || null),
    source_url: d.source_url ?? null,
    platform: guessPlatform(d.source_url) ?? (events[0]?.platform === "LOCAL" ? "LOCAL" : undefined),
    package_name: booking.package_name,
    notes: booking.public_ref ? `Booking ${booking.public_ref}` : null,
  };

  return (
    <>
      <BrandHeader title="Create tracked athlete" subtitle={`From booking ${booking.public_ref ?? ""}`.trim()} backHref={`/bookings/${id}`} />
      <PageBody className="max-w-2xl">
        {events.length === 0 ? (
          <EmptyState icon={<CalendarIcon />} title="Create an event first" description="Tracked athletes are always attached to a tournament." action={<Link href="/events/new" className="btn-primary">Create event</Link>} />
        ) : (
          <>
            {linkedNotice(detail.linkedAthlete)}
            <ClientForm action={createAthleteFromBooking.bind(null, id)} events={events} initial={initial} defaultEventId={booking.event_id} submitLabel="Create and link athlete" cancelHref={`/bookings/${id}`} />
          </>
        )}
      </PageBody>
    </>
  );
}

function linkedNotice(linked: { id: string; name: string } | null) {
  if (!linked) return null;
  return (
    <p className="mb-4 rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
      This booking is already linked to <Link href={`/clients/${linked.id}`} className="underline">{linked.name}</Link>. Creating another athlete will replace that link.
    </p>
  );
}
