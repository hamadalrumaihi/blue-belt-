import type { Metadata } from "next";
import Link from "next/link";
import { CheckIcon, InstagramIcon, MailIcon, MapPinIcon, PhoneIcon, WhatsAppIcon } from "@/components/icons";
import { loadPublicStudio } from "@/lib/studio/queries";
import { ContactForm } from "./ContactForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Contact — Blue Belt Media", description: "Questions about a tournament, club day or session? Send a message; we reply within 24 hours." };

export default async function ContactPage({ searchParams }: PageProps<"/contact">) {
  const [pub, params] = await Promise.all([loadPublicStudio(), searchParams]);
  const studio = pub?.studio ?? null;
  const sent = params.sent === "1";
  const ig = studio?.instagram?.replace(/^@/, "") ?? null;
  const wa = studio?.whatsapp?.replace(/\D/g, "") ?? null;
  const bookingOpen = Boolean(studio?.public_booking);

  return (
    <main>
      <section className="bg-navy text-white">
        <div className="mx-auto max-w-6xl px-4 py-14 lg:px-8 lg:py-20">
          <p className="eyebrow !text-white/60">Contact</p>
          <h1 className="mt-3 max-w-2xl text-4xl font-extrabold tracking-tight sm:text-5xl">Let&apos;s talk about your day</h1>
          <p className="mt-4 max-w-xl text-base text-white/75">Questions, team days, something unusual — write to us. We reply within 24 hours.</p>
        </div>
      </section>

      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 md:grid-cols-[1fr_1.4fr] lg:px-8 lg:py-20">
        <aside className="space-y-6">
          <div>
            <p className="eyebrow">Direct</p>
            <ul className="mt-3 space-y-1 text-sm">
              {wa && <li><a href={`https://wa.me/${wa}`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-3 font-semibold text-ink hover:text-primary"><WhatsAppIcon size={20} className="text-primary" /> WhatsApp</a></li>}
              {studio?.phone && <li><a href={`tel:${studio.phone}`} className="inline-flex min-h-11 items-center gap-3 font-semibold text-ink hover:text-primary"><PhoneIcon size={20} className="text-primary" /> {studio.phone}</a></li>}
              {studio?.email && <li><a href={`mailto:${studio.email}`} className="inline-flex min-h-11 items-center gap-3 font-semibold text-ink hover:text-primary"><MailIcon size={20} className="text-primary" /> {studio.email}</a></li>}
              {ig && <li><a href={`https://instagram.com/${ig}`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-3 font-semibold text-ink hover:text-primary"><InstagramIcon size={20} className="text-primary" /> @{ig}</a></li>}
              {studio?.city && <li className="inline-flex min-h-11 items-center gap-3 text-muted"><MapPinIcon size={20} className="text-primary" /> {studio.city}</li>}
              {!wa && !studio?.phone && !studio?.email && !ig && <li className="text-muted">Contact details are being set up — use the form.</li>}
            </ul>
          </div>
          {bookingOpen && (
            <div className="rounded-card bg-page p-5">
              <p className="text-sm font-bold text-ink">Ready to book?</p>
              <p className="mt-1 text-sm text-muted">The booking form takes two minutes and gives you a reference straight away.</p>
              <Link href="/book" className="btn-secondary mt-3">Go to booking</Link>
            </div>
          )}
        </aside>

        <div>
          {sent ? (
            <div className="card p-6 sm:p-8" role="status" aria-live="polite">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-success-soft text-success"><CheckIcon size={24} /></span>
              <h2 className="mt-4 text-2xl font-extrabold text-navy">Message received</h2>
              <p className="mt-2 text-base text-muted">Thanks — we reply within 24 hours, usually sooner. If it is urgent, WhatsApp is fastest.</p>
              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <Link href="/" className="btn-secondary">Back to home</Link>
                {bookingOpen && <Link href="/book" className="btn-primary">Make a booking</Link>}
              </div>
            </div>
          ) : (
            <ContactForm />
          )}
        </div>
      </div>
    </main>
  );
}
