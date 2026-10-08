import type { Metadata } from "next";
import Link from "next/link";
import { CheckIcon, InstagramIcon, MailIcon, MapPinIcon, PhoneIcon, WhatsAppIcon } from "@/components/icons";
import { pageMetadata } from "@/lib/seo";
import { businessIdentity, businessLegalLine, formatPhone, whatsappUrl } from "@/lib/studio/business";
import { loadPublicStudio } from "@/lib/studio/queries";
import { ContactForm } from "./ContactForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = pageMetadata({
  title: "Contact a martial arts photographer in Doha",
  description: "Ask about jiu-jitsu tournament coverage, a club day, training session photography or an athlete photoshoot in Qatar. We reply within 24 hours.",
  path: "/contact",
});

export default async function ContactPage({ searchParams }: PageProps<"/contact">) {
  const [pub, params] = await Promise.all([loadPublicStudio(), searchParams]);
  const studio = pub?.studio ?? null;
  const sent = params.sent === "1";
  const identity = businessIdentity();
  const ig = studio?.instagram?.replace(/^@/, "") ?? null;
  const wa = whatsappUrl(studio?.whatsapp || identity.phone);
  const phone = studio?.phone?.trim() || formatPhone(identity.phone);
  const email = studio?.email || identity.email;
  const bookingOpen = Boolean(studio?.public_booking);

  return (
    <main>
      <section className="bg-navy text-white">
        <div className="mx-auto max-w-6xl px-4 py-14 lg:px-8 lg:py-20">
          <p className="eyebrow !text-white/60">Contact</p>
          <h1 className="mt-3 max-w-2xl text-4xl font-extrabold tracking-tight sm:text-5xl">Contact Blue Belt Media</h1>
          <p className="mt-4 max-w-xl text-base text-white/75">Questions, team days or something unusual: write to us. We reply within 24 hours.</p>
        </div>
      </section>

      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 md:grid-cols-[1fr_1.4fr] lg:px-8 lg:py-20">
        <aside className="space-y-6">
          <div>
            <p className="eyebrow">Direct</p>
            <ul className="mt-3 space-y-1 text-sm">
              {wa && <li><a href={wa} target="_blank" rel="noopener noreferrer" data-umami-event="contact-click" className="inline-flex min-h-11 items-center gap-3 font-semibold text-ink hover:text-primary"><WhatsAppIcon size={20} className="text-primary" /> WhatsApp</a></li>}
              {phone && <li><a href={`tel:${phone.replace(/\s/g, "")}`} data-umami-event="contact-click" className="inline-flex min-h-11 items-center gap-3 font-semibold text-ink hover:text-primary"><PhoneIcon size={20} className="text-primary" /> {phone}</a></li>}
              <li><a href={`mailto:${email}`} data-umami-event="contact-click" className="inline-flex min-h-11 items-center gap-3 font-semibold text-ink hover:text-primary"><MailIcon size={20} className="text-primary" /> {email}</a></li>
              {ig && <li><a href={`https://instagram.com/${ig}`} target="_blank" rel="noopener noreferrer" data-umami-event="contact-click" className="inline-flex min-h-11 items-center gap-3 font-semibold text-ink hover:text-primary"><InstagramIcon size={20} className="text-primary" /> @{ig}</a></li>}
              <li className="inline-flex min-h-11 items-center gap-3 text-muted"><MapPinIcon size={20} className="text-primary" /> {studio?.city || identity.location}</li>
            </ul>
          </div>
          <div>
            <p className="eyebrow">Business</p>
            <p className="mt-3 text-sm text-muted">{businessLegalLine(identity)}</p>
          </div>
          {bookingOpen && (
            <div className="rounded-card bg-page p-5">
              <p className="text-sm font-bold text-ink">Ready to book?</p>
              <p className="mt-1 text-sm text-muted">The booking form takes about two minutes and gives you a reference straight away. We confirm within 24 hours; the deposit is paid online after that.</p>
              <Link href="/book" data-umami-event="book-start" className="btn-secondary mt-3">Go to booking</Link>
            </div>
          )}
          <p className="text-sm text-muted">
            Prices for each option are on the <Link href="/services" className="font-semibold text-primary">services page</Link>.
          </p>
        </aside>

        <div>
          {sent ? (
            <div className="card p-6 sm:p-8" role="status" aria-live="polite">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-success-soft text-success"><CheckIcon size={24} /></span>
              <h2 className="mt-4 text-2xl font-extrabold text-navy">Message received</h2>
              <p className="mt-2 text-base text-muted">Thanks. We reply within 24 hours, usually sooner.{wa ? " If it is urgent, WhatsApp is fastest." : ""}</p>
              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <Link href="/" className="btn-secondary">Back to home</Link>
                {bookingOpen && <Link href="/book" data-umami-event="book-start" className="btn-primary">Make a booking</Link>}
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
