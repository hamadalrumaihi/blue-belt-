import type { Metadata } from "next";
import Link from "next/link";
import { BrandHeader } from "@/components/BrandHeader";
import { PageBody } from "@/components/AppShell";
import { bookingDetails } from "@/lib/bookings/state";
import { createQuoteForm } from "@/lib/actions/pricing";
import { listPriceReferences } from "@/lib/pricing/queries";
import { requireOwner } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/validation";
import { OwnerOnly } from "../OwnerOnly";
import { QuoteForm, type QuotePrefill } from "./QuoteForm";

export const metadata: Metadata = { title: "Suggest a quote" };
export const dynamic = "force-dynamic";

/** Job inputs read off the booking (owner's own row through RLS). */
async function prefillFromBooking(bookingId: string): Promise<{ prefill: QuotePrefill; label: string } | null> {
  const supabase = await createClient();
  const { data: booking } = await supabase.from("photo_bookings").select("*").eq("id", bookingId).maybeSingle();
  if (!booking) return null;
  const d = bookingDetails(booking);
  const service = booking.service_id ? (await supabase.from("photo_services").select("includes_video,duration_minutes").eq("id", booking.service_id).maybeSingle()).data : null;
  let hours: number | null = null;
  if (booking.session_at && booking.session_end_at) {
    const ms = Date.parse(booking.session_end_at) - Date.parse(booking.session_at);
    if (Number.isFinite(ms) && ms > 0) hours = Math.round((ms / 3_600_000) * 10) / 10;
  } else if (service?.duration_minutes) hours = Math.round((service.duration_minutes / 60) * 10) / 10;
  const video = d.coverage === "video" || d.coverage === "both" || d.wants_videographer === true || service?.includes_video === true;
  const athletes = typeof d.athlete_count === "number" && d.athlete_count > 0 ? d.athlete_count : booking.booking_type === "tournament_athlete" || booking.booking_type === "private_session" ? 1 : null;
  return {
    prefill: { service_type: booking.booking_type, hours, athletes, video },
    label: `${booking.customer_name}${booking.public_ref ? ` · ${booking.public_ref}` : ""}`,
  };
}

export default async function QuotePage({ searchParams }: PageProps<"/pricing/quote">) {
  const owner = await requireOwner();
  if (!owner.ok) return <OwnerOnly title="Suggest a quote" />;
  const params = await searchParams;
  const bookingId = isUuid(params.booking) ? params.booking : null;
  const [booking, references] = await Promise.all([bookingId ? prefillFromBooking(bookingId) : null, listPriceReferences()]);
  const action = createQuoteForm.bind(null, booking ? bookingId : null);

  return (
    <>
      <BrandHeader title="Suggest a quote" subtitle="Describe the job; the suggestion comes from your reference prices plus your costs and margin." backHref="/pricing" />
      <PageBody className="max-w-2xl space-y-4">
        {bookingId && !booking && <p className="rounded-xl border border-warning/30 bg-warning-soft px-3 py-2 text-sm font-semibold text-warning" role="alert">That booking was not found. The quote will not be linked to a booking.</p>}
        {booking && (
          <p className="rounded-xl border border-primary/20 bg-lightblue px-3 py-2 text-sm text-ink">
            For booking <strong>{booking.label}</strong> (<Link href={`/bookings/${bookingId}`} className="font-semibold text-primary hover:underline">open</Link>). Service, hours and athletes were filled from it; check them.
          </p>
        )}
        {references.length === 0 && (
          <p className="rounded-xl border border-line bg-page px-3 py-2 text-sm text-muted">
            You have no reference prices yet, so the suggestion will be costs plus margin only. <Link href="/pricing/references/new" className="font-semibold text-primary hover:underline">Add a reference</Link> first for a market-based range.
          </p>
        )}
        <QuoteForm action={action} prefill={booking?.prefill ?? null} referenceCount={references.length} />
      </PageBody>
    </>
  );
}
