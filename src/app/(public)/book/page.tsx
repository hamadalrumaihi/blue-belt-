import type { Metadata } from "next";
import Link from "next/link";
import { ShieldIcon } from "@/components/icons";
import { resolveWizardEntry, toPublicServiceOption } from "@/lib/bookings/public-form";
import { pageMetadata } from "@/lib/seo";
import { listPublicEvents } from "@/lib/studio/public-events";
import { loadPublicStudio } from "@/lib/studio/queries";
import { BookingWizard } from "./BookingWizard";

export const dynamic = "force-dynamic";
export const metadata: Metadata = pageMetadata({
  title: "Request jiu-jitsu photography or video in Doha",
  description: "Request tournament, team, training, portrait or event coverage in Qatar: photos, video or both. About two minutes. We come back within 24 hours; nothing is paid until the date and price are confirmed.",
  path: "/book",
});

function first(v: string | string[] | undefined): string | null {
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === "string" && s ? s : null;
}

/**
 * The request wizard. Entry points keep working: `?service=<catalog key>`,
 * `?audience=`, legacy `?type=<booking type>` and `?kind=<legacy kind>`,
 * `?media=<scope>`, `?service=<package id>` from the services page and
 * `?event=`. Prices reach the wizard only as labels (quote-mode packages
 * never show or book a number) and descriptions are stripped of seed
 * placeholders.
 */
export default async function BookPage({ searchParams }: PageProps<"/book">) {
  const [pub, params] = await Promise.all([loadPublicStudio(), searchParams]);
  if (!pub || !pub.studio.public_booking) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16 text-center lg:px-8">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-lightblue text-primary"><ShieldIcon size={24} /></span>
        <h1 className="mt-4 text-3xl font-extrabold tracking-tight text-navy">Online requests open soon</h1>
        <p className="mt-3 text-base text-muted">We are not taking requests through the website yet. Send us a message and we will arrange it with you.</p>
        <Link href="/contact" data-umami-event="contact-click" className="btn-primary mt-6">Contact us</Link>
      </main>
    );
  }
  const events = await listPublicEvents(pub.studio.owner_id);
  // Prices reach the browser only as a label; quote-mode packages carry no number.
  const services = pub.services.map(toPublicServiceOption);
  const entry = resolveWizardEntry({ service: first(params.service), audience: first(params.audience), type: first(params.type), kind: first(params.kind), event: first(params.event), media: first(params.media) }, { events, services });
  return (
    <main className="bg-page">
      <div className="mx-auto max-w-2xl px-4 py-10 lg:px-8 lg:py-14">
        <p className="eyebrow">Request {pub.studio.business_name}</p>
        <h1 className="mt-2 text-xl font-bold text-ink">Coverage request</h1>
        <div className="card mt-6 p-5 sm:p-8">
          <BookingWizard events={events} services={services} entry={entry} />
        </div>
        <p className="mt-6 text-center text-xs text-muted">
          Prefer to talk first? <Link href="/contact" data-umami-event="contact-click" className="font-semibold text-primary">Send a message</Link> instead. What each service includes is on the <Link href="/services" className="font-semibold text-primary">services page</Link>.
        </p>
      </div>
    </main>
  );
}
