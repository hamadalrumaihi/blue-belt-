import type { Metadata } from "next";
import Link from "next/link";
import { ShieldIcon } from "@/components/icons";
import { pageMetadata } from "@/lib/seo";
import { listPublicEvents } from "@/lib/studio/public-events";
import { loadPublicStudio } from "@/lib/studio/queries";
import { BookingWizard } from "./BookingWizard";

export const dynamic = "force-dynamic";
export const metadata: Metadata = pageMetadata({
  title: "Book a jiu-jitsu photographer in Doha",
  description: "Request tournament, club, training session or private athlete coverage in Qatar. About two minutes. We confirm within 24 hours; secure online payment.",
  path: "/book",
});

function first(v: string | string[] | undefined): string | null {
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === "string" && s ? s : null;
}

export default async function BookPage({ searchParams }: PageProps<"/book">) {
  const [pub, params] = await Promise.all([loadPublicStudio(), searchParams]);
  if (!pub || !pub.studio.public_booking) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16 text-center lg:px-8">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-lightblue text-primary"><ShieldIcon size={24} /></span>
        <h1 className="mt-4 text-3xl font-extrabold tracking-tight text-navy">Online booking opens soon</h1>
        <p className="mt-3 text-base text-muted">We are not taking bookings through the website yet. Send us a message and we will arrange it with you.</p>
        <Link href="/contact" data-umami-event="contact-click" className="btn-primary mt-6">Contact us</Link>
      </main>
    );
  }
  const events = await listPublicEvents(pub.studio.owner_id);
  const services = pub.services.map((s) => ({ id: s.id, name: s.name, booking_type: s.booking_type, price_qr: s.price_qr === null ? null : Number(s.price_qr), currency: s.currency, description: s.description }));
  return (
    <main className="bg-page">
      <div className="mx-auto max-w-2xl px-4 py-10 lg:px-8 lg:py-14">
        <p className="eyebrow">Book {pub.studio.business_name}</p>
        <h1 className="mt-2 text-xl font-bold text-ink">Booking request</h1>
        <div className="card mt-6 p-5 sm:p-8">
          <BookingWizard events={events} services={services} initialType={first(params.type)} initialKind={first(params.kind)} initialEventId={first(params.event)} initialServiceId={first(params.service)} />
        </div>
        <p className="mt-6 text-center text-xs text-muted">Prefer to talk first? <Link href="/contact" data-umami-event="contact-click" className="font-semibold text-primary">Send a message</Link> instead. Prices are on the <Link href="/services" className="font-semibold text-primary">services page</Link>.</p>
      </div>
    </main>
  );
}
