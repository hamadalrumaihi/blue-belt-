import type { Metadata } from "next";
import Link from "next/link";
import { CalendarIcon, CameraIcon, CheckIcon, ChevronRightIcon, ImageIcon, SendIcon, SwordsIcon, UsersIcon, VideoIcon } from "@/components/icons";
import { PUBLIC_BOOKING_TYPES } from "@/lib/bookings/public-form";
import { formatQr } from "@/lib/bookings/state";
import { DEFAULT_STUDIO, loadPublicStudio } from "@/lib/studio/queries";
import { PictimeTestimonials } from "@/components/public/PictimeTestimonials";
import { readTestimonials } from "@/lib/studio/site-content";
import type { BookingType, PhotoServiceRow } from "@/lib/supabase/database.types";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Blue Belt Media — Combat sports photography & video", description: "Tournament, club and private session photography and video for jiu-jitsu and combat sports athletes in Doha, Qatar." };

const TYPE_ICON: Record<BookingType, typeof CameraIcon> = { tournament_athlete: SwordsIcon, club: UsersIcon, training_session: CameraIcon, private_session: VideoIcon, custom: SendIcon };

/** "from 350 QAR" for the cheapest priced service of a type, "Quote on request" otherwise. */
function priceLine(services: PhotoServiceRow[], type: BookingType): string {
  const prices = services.filter((s) => s.booking_type === type && s.price_qr !== null).map((s) => Number(s.price_qr));
  return prices.length ? `from ${formatQr(Math.min(...prices))}` : "Quote on request";
}

const STEPS = [
  { icon: SendIcon, title: "Tell us about the day", body: "Pick what you need and send the request. It takes two minutes and nothing is paid up front." },
  { icon: CheckIcon, title: "We confirm within 24 hours", body: "You get a reference straight away. We check the schedule, confirm, and send a payment link by e-mail or WhatsApp when a price is agreed." },
  { icon: CameraIcon, title: "Shoot day", body: "We follow your bracket or session so no match is missed — from warm-up to the podium." },
  { icon: ImageIcon, title: "Your gallery in Pic-Time", body: "Edited photos and video land in a private online gallery you can share, download and order prints from." },
];

export default async function HomePage() {
  const pub = await loadPublicStudio();
  const studio = pub?.studio ?? null;
  const services = pub?.services ?? [];
  const bookingOpen = Boolean(studio?.public_booking);
  const name = studio?.business_name ?? DEFAULT_STUDIO.business_name;
  const tagline = studio?.tagline ?? DEFAULT_STUDIO.tagline;
  const city = studio?.city ?? DEFAULT_STUDIO.city;
  const testimonials = studio ? readTestimonials(studio.settings) : [];
  const primaryHref = bookingOpen ? "/book" : "/contact";
  const primaryLabel = bookingOpen ? "Book your coverage" : "Get in touch";

  return (
    <main>
      {/* Hero */}
      <section className="relative overflow-hidden bg-navy text-white">
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="absolute -right-24 -top-24 h-[28rem] w-[28rem] rounded-full border border-white/10" />
          <div className="absolute -right-10 top-10 h-[20rem] w-[20rem] rounded-full border border-primary/40" />
          <div className="absolute bottom-0 left-0 right-0 h-px bg-white/10" />
          <div className="absolute -left-40 bottom-[-12rem] h-[24rem] w-[40rem] rotate-[-8deg] bg-primary/15 blur-2xl" />
        </div>
        <div className="relative mx-auto grid max-w-6xl gap-10 px-4 pb-16 pt-14 md:grid-cols-[1.2fr_1fr] md:items-center md:pb-24 md:pt-20 lg:px-8">
          <div>
            <p className="eyebrow !text-white/60">{tagline}{city ? ` · ${city}` : ""}</p>
            <h1 className="mt-4 text-[2.5rem] font-extrabold leading-[1.02] tracking-tight sm:text-6xl lg:text-7xl">
              Every match,
              <br />
              shot like it matters.
            </h1>
            <p className="mt-6 max-w-xl text-base leading-relaxed text-white/75 sm:text-lg">
              {studio?.about?.trim() || `${name} covers tournaments, academies and private sessions for jiu-jitsu and combat sports athletes. Clean, honest images delivered fast through a private gallery.`}
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link href={primaryHref} className="btn-primary min-h-12 px-6 text-base shadow-hero">
                {primaryLabel}
                <ChevronRightIcon size={18} />
              </Link>
              <Link href="/services" className="btn min-h-12 border border-white/25 px-6 text-base text-white hover:bg-white/10">
                See services & prices
              </Link>
            </div>
            <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-white/60">
              <li className="inline-flex items-center gap-2"><CheckIcon size={16} className="text-bright" /> Confirmed within 24 hours</li>
              <li className="inline-flex items-center gap-2"><CheckIcon size={16} className="text-bright" /> Galleries via Pic-Time</li>
            </ul>
          </div>
          {/* CSS-only frame: a stand-in for a hero image, never a fabricated photo. */}
          <div aria-hidden className="relative mx-auto hidden aspect-[4/5] w-full max-w-sm md:block">
            <div className="absolute inset-0 rounded-[2rem] border border-white/15 bg-navy-800" />
            <div className="absolute inset-4 rounded-[1.5rem] border border-white/10 bg-navy-700" />
            <div className="absolute left-8 top-8 h-2 w-16 rounded-full bg-primary" />
            <div className="absolute bottom-10 left-8 right-8">
              <div className="h-3 w-3/4 rounded-full bg-white/20" />
              <div className="mt-2 h-3 w-1/2 rounded-full bg-white/10" />
            </div>
            <div className="absolute right-8 top-1/3 flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-navy">
              <CameraIcon size={28} />
            </div>
          </div>
        </div>
      </section>

      {/* Services */}
      <section className="mx-auto max-w-6xl px-4 py-16 lg:px-8 lg:py-24" aria-labelledby="services-heading">
        <div className="max-w-2xl">
          <p className="eyebrow">What we shoot</p>
          <h2 id="services-heading" className="mt-2 text-3xl font-extrabold tracking-tight text-navy sm:text-4xl">Five ways to book</h2>
          <p className="mt-3 text-base text-muted">Pick the one that fits. Team days and custom work are quoted; everything else has a clear price before you commit.</p>
        </div>
        <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PUBLIC_BOOKING_TYPES.map((t) => {
            const Icon = TYPE_ICON[t.value];
            return (
              <li key={t.value}>
                <Link href={bookingOpen ? `/book?type=${t.value}` : "/contact"} className="card group flex h-full flex-col p-6 transition-colors hover:border-primary/40">
                  <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-lightblue text-primary"><Icon size={24} /></span>
                  <h3 className="mt-5 text-lg font-extrabold text-ink">{t.title}</h3>
                  <p className="mt-2 flex-1 text-sm leading-relaxed text-muted">{t.body}</p>
                  <p className="mt-5 flex items-center justify-between text-sm font-bold text-primary">
                    {priceLine(services, t.value)}
                    <ChevronRightIcon size={18} className="transition-transform group-hover:translate-x-0.5" />
                  </p>
                </Link>
              </li>
            );
          })}
          <li>
            <Link href="/services" className="flex h-full min-h-40 flex-col justify-between rounded-card border border-dashed border-line p-6 transition-colors hover:border-primary/40">
              <p className="eyebrow">Full list</p>
              <p className="text-lg font-extrabold text-navy">All packages & prices <ChevronRightIcon size={18} className="inline" /></p>
            </Link>
          </li>
        </ul>
      </section>

      {/* How it works */}
      <section className="border-y border-line bg-page" aria-labelledby="how-heading">
        <div className="mx-auto max-w-6xl px-4 py-16 lg:px-8 lg:py-24">
          <div className="max-w-2xl">
            <p className="eyebrow">How it works</p>
            <h2 id="how-heading" className="mt-2 text-3xl font-extrabold tracking-tight text-navy sm:text-4xl">From request to gallery</h2>
          </div>
          <ol className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s, i) => {
              const Icon = s.icon;
              return (
                <li key={s.title} className="relative rounded-card border border-line bg-white p-6">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-navy text-white"><Icon size={20} /></span>
                    <span className="text-xs font-bold uppercase tracking-[0.14em] text-muted">Step {i + 1}</span>
                  </div>
                  <h3 className="mt-4 text-base font-extrabold text-ink">{s.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted">{s.body}</p>
                </li>
              );
            })}
          </ol>
        </div>
      </section>

      {/* Testimonials */}
      <section className="mx-auto max-w-6xl px-4 py-16 lg:px-8 lg:py-24" aria-labelledby="stories-heading">
        <div className="max-w-2xl">
          <p className="eyebrow">Athletes & clubs</p>
          <h2 id="stories-heading" className="mt-2 text-3xl font-extrabold tracking-tight text-navy sm:text-4xl">In their words</h2>
        </div>
        <div className="mt-10">
          <PictimeTestimonials fallback={testimonials.length ? (
          <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {testimonials.map((t) => (
              <li key={`${t.name}-${t.quote.slice(0, 16)}`} className="card flex flex-col p-6">
                <blockquote className="flex-1 text-base leading-relaxed text-ink">“{t.quote}”</blockquote>
                <p className="mt-5 text-sm font-bold text-navy">{t.name}{t.role ? <span className="font-normal text-muted"> · {t.role}</span> : null}</p>
              </li>
            ))}
          </ul>
        ) : (
          <div className="rounded-card border border-dashed border-line p-8 text-center">
            <p className="text-base font-semibold text-ink">Stories from the mats are on their way.</p>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted">We only publish words athletes and coaches actually said. Until then, the work speaks on Instagram and in the galleries we deliver.</p>
            {studio?.instagram && (
              <a href={`https://instagram.com/${studio.instagram.replace(/^@/, "")}`} target="_blank" rel="noopener noreferrer" className="btn-secondary mt-5">
                See recent work on Instagram
              </a>
            )}
          </div>
        )} />
        </div>
      </section>

      {/* CTA */}
      <section className="bg-navy text-white">
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-4 py-16 md:flex-row md:items-center md:justify-between lg:px-8">
          <div>
            <p className="eyebrow !text-white/60"><CalendarIcon size={14} className="mr-1 inline" /> Competing soon?</p>
            <h2 className="mt-2 text-2xl font-extrabold tracking-tight sm:text-3xl">Lock in your coverage before the bracket is out.</h2>
            <p className="mt-2 max-w-lg text-sm text-white/70">Send the request now; we confirm within a day and nothing is charged until you have a confirmed price.</p>
          </div>
          <Link href={primaryHref} className="btn-primary min-h-12 shrink-0 px-6 text-base shadow-hero">
            {primaryLabel}
            <ChevronRightIcon size={18} />
          </Link>
        </div>
      </section>
    </main>
  );
}
