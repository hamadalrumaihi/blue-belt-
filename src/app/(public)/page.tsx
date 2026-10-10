import type { Metadata } from "next";
import Link from "next/link";
import { CalendarIcon, CameraIcon, CheckIcon, ChevronRightIcon, ExternalIcon, ImageIcon, SendIcon, SwordsIcon, UsersIcon, VideoIcon } from "@/components/icons";
import { Photo } from "@/components/public/Photo";
import { Testimonials } from "@/components/public/Testimonials";
import { PUBLIC_BOOKING_TYPES } from "@/lib/bookings/public-form";
import { loadSiteGallery } from "@/lib/photos/site";
import { buildFaqJsonLd, buildHomeJsonLd, DEFAULT_DESCRIPTION, DEFAULT_TITLE, FAQ_ITEMS, pageMetadata, serializeJsonLd } from "@/lib/seo";
import { priceLineFor } from "@/lib/services/pricing";
import { DEFAULT_STUDIO, loadPublicStudio, pictimeGalleryUrl, siteUrl } from "@/lib/studio/queries";
import { readTestimonials } from "@/lib/studio/site-content";
import type { BookingType } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata: Metadata = pageMetadata({ title: DEFAULT_TITLE, description: DEFAULT_DESCRIPTION, path: "/" });

const TYPE_ICON: Record<BookingType, typeof CameraIcon> = { tournament_athlete: SwordsIcon, club: UsersIcon, training_session: CameraIcon, private_session: VideoIcon, custom: SendIcon };

const STEPS = [
  { icon: SendIcon, title: "Send the request", body: "Pick the coverage you need and tell us about the day. It takes about two minutes and you get a reference straight away." },
  { icon: CheckIcon, title: "We confirm", body: "We check the date and confirm the price with you. You sign the agreement online and pay the 50% deposit. That secures the booking." },
  { icon: CameraIcon, title: "Shoot day", body: "At a tournament we follow your bracket, mat by mat. At a session we work to the plan agreed with you." },
  { icon: ImageIcon, title: "Your private gallery", body: "Edited photos and video arrive in a private online gallery. View, download and share from there. The remaining 50% is due after delivery." },
];

export default async function HomePage() {
  const [pub, gallery] = await Promise.all([loadPublicStudio(), loadSiteGallery()]);
  const studio = pub?.studio ?? null;
  const services = pub?.services ?? [];
  const bookingOpen = Boolean(studio?.public_booking);
  const name = studio?.business_name ?? DEFAULT_STUDIO.business_name;
  const city = studio?.city ?? DEFAULT_STUDIO.city;
  const testimonials = studio ? readTestimonials(studio.settings) : [];
  const galleryUrl = pictimeGalleryUrl(studio);
  const primaryHref = bookingOpen ? "/book" : "/contact";
  const primaryLabel = bookingOpen ? "Book coverage" : "Get in touch";
  const primaryEvent = bookingOpen ? "book-start" : "contact-click";
  const hero = gallery.hero;
  const textOnRight = hero?.textSpace === "right";
  const jsonLd = serializeJsonLd(buildHomeJsonLd({ base: siteUrl(), studio, services }));
  const faqLd = serializeJsonLd(buildFaqJsonLd());

  return (
    <main>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: faqLd }} />

      {/* Hero: the strongest approved photograph behind the headline; a photo-free layout until there is one. */}
      <section className="relative isolate overflow-hidden bg-navy text-white">
        {hero ? (
          <div aria-hidden className="absolute inset-0">
            <Photo photo={hero} sizes="100vw" priority />
            {/* Phones: the photo shows above the copy and fades into navy behind it. Wider screens: the copy sits on the photo's clean side. */}
            <div className={cn("absolute inset-0 bg-gradient-to-t from-navy via-navy/85 to-navy/20", textOnRight ? "md:bg-gradient-to-l md:from-navy md:via-navy/80 md:to-navy/10" : "md:bg-gradient-to-r md:from-navy md:via-navy/80 md:to-navy/10")} />
            <div className="absolute inset-0 hidden bg-gradient-to-t from-navy/60 via-transparent to-transparent md:block" />
          </div>
        ) : (
          <div aria-hidden className="pointer-events-none absolute inset-0">
            <div className="absolute -right-24 -top-24 h-[28rem] w-[28rem] rounded-full border border-white/10" />
            <div className="absolute -right-10 top-10 h-[20rem] w-[20rem] rounded-full border border-primary/40" />
            <div className="absolute -left-40 bottom-[-12rem] h-[24rem] w-[40rem] rotate-[-8deg] bg-primary/15 blur-2xl" />
          </div>
        )}
        <div className={cn("relative mx-auto flex max-w-6xl px-4 pb-16 pt-16 lg:px-8", hero ? "min-h-[34rem] items-end md:min-h-[40rem] md:items-center md:pb-24 md:pt-24" : "md:pb-24 md:pt-20", textOnRight && "md:justify-end")}>
          <div className="max-w-xl">
            <p className="eyebrow !text-white/70">{studio?.tagline ?? DEFAULT_STUDIO.tagline}{city ? ` · ${city}` : ""}</p>
            <h1 className="mt-4 text-[2.5rem] font-extrabold leading-[1.02] tracking-tight sm:text-6xl lg:text-7xl">Jiu-jitsu and martial arts photography in Qatar</h1>
            <p className="mt-6 max-w-xl text-base leading-relaxed text-white/80 sm:text-lg">
              {studio?.about?.trim() || `${name} photographs and films tournaments, academy training and private athlete sessions in Doha. Your photos are delivered in a private online gallery.`}
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link href={primaryHref} data-umami-event={primaryEvent} className="btn-primary min-h-12 px-6 text-base shadow-hero">
                {primaryLabel}
                <ChevronRightIcon size={18} />
              </Link>
              <a href={galleryUrl} target="_blank" rel="noopener noreferrer" data-umami-event="gallery-click" className="btn min-h-12 border border-white/30 bg-white/5 px-6 text-base text-white backdrop-blur hover:bg-white/15">
                View and buy photos
                <ExternalIcon size={16} />
                <span className="sr-only">(opens your gallery in a new tab)</span>
              </a>
            </div>
            <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-white/70">
              <li className="inline-flex items-center gap-2"><CheckIcon size={16} className="text-bright" /> Bracket-matched tournament coverage</li>
              <li className="inline-flex items-center gap-2"><CheckIcon size={16} className="text-bright" /> Secure online payment</li>
              <li className="inline-flex items-center gap-2"><CheckIcon size={16} className="text-bright" /> <Link href="/services" className="underline-offset-2 hover:underline">Prices in QAR</Link></li>
            </ul>
          </div>
        </div>
        {gallery.pending && <p className="relative border-t border-white/10 bg-navy-800 px-4 py-2 text-center text-xs font-semibold text-white/80">Preview for the studio: these photographs are not published yet. Publish them under Studio, Featured work.</p>}
      </section>

      {/* Services */}
      <section className="mx-auto max-w-6xl px-4 py-16 lg:px-8 lg:py-24" aria-labelledby="services-heading">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="max-w-2xl">
            <p className="eyebrow">What we shoot</p>
            <h2 id="services-heading" className="mt-2 text-3xl font-extrabold tracking-tight text-navy sm:text-4xl">Tournament, training and athlete coverage</h2>
            <p className="mt-3 text-base text-muted">Pick the one that fits. Team days and custom work are quoted; everything else has its price on the services page before you book.</p>
          </div>
          <Link href="/services" className="btn-secondary shrink-0">All services and prices <ChevronRightIcon size={16} /></Link>
        </div>
        <ul className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {PUBLIC_BOOKING_TYPES.map((t) => {
            const Icon = TYPE_ICON[t.value];
            const photo = gallery.services[t.value][0] ?? null;
            return (
              <li key={t.value}>
                <Link href={bookingOpen ? `/book?type=${t.value}` : "/contact"} data-umami-event={primaryEvent} className="card group flex h-full flex-col overflow-hidden transition-colors hover:border-primary/40">
                  {photo ? (
                    <div className="relative aspect-[4/3] w-full overflow-hidden bg-navy">
                      <Photo photo={photo} sizes="(min-width: 1024px) 30vw, (min-width: 640px) 50vw, 100vw" alt="" className="transition-transform duration-500 group-hover:scale-[1.03]" />
                    </div>
                  ) : (
                    <div className="flex aspect-[4/3] w-full items-center justify-center bg-navy text-white/80"><Icon size={40} /></div>
                  )}
                  <div className="flex flex-1 flex-col p-6">
                    <h3 className="text-lg font-extrabold text-ink">{t.title}</h3>
                    <p className="mt-2 flex-1 text-sm leading-relaxed text-muted">{t.body}</p>
                    <p className="mt-5 flex items-center justify-between text-sm font-bold text-primary">
                      {priceLineFor(services.filter((s) => s.booking_type === t.value))}
                      <ChevronRightIcon size={18} className="transition-transform group-hover:translate-x-0.5" />
                    </p>
                  </div>
                </Link>
              </li>
            );
          })}
          <li>
            <Link href="/services" className="flex h-full min-h-48 flex-col justify-between rounded-card border border-dashed border-line p-6 transition-colors hover:border-primary/40">
              <p className="eyebrow">Full list</p>
              <p className="text-lg font-extrabold text-navy">All packages and prices <ChevronRightIcon size={18} className="inline" /></p>
            </Link>
          </li>
        </ul>
      </section>

      {/* Featured work */}
      {gallery.featured.length > 0 && (
        <section id="featured-work" className="bg-navy text-white" aria-labelledby="featured-heading">
          <div className="mx-auto max-w-6xl px-4 py-16 lg:px-8 lg:py-24">
            <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
              <div className="max-w-2xl">
                <p className="eyebrow !text-white/60">Featured work</p>
                <h2 id="featured-heading" className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">From the mat</h2>
                <p className="mt-3 text-base text-white/75">Competition days, academy sessions and athlete portraits shot in Qatar.</p>
              </div>
              <a href={galleryUrl} target="_blank" rel="noopener noreferrer" data-umami-event="gallery-click" className="btn shrink-0 border border-white/30 text-white hover:bg-white/10">
                View and buy photos <ExternalIcon size={16} />
                <span className="sr-only">(opens your gallery in a new tab)</span>
              </a>
            </div>
            <ul className="mt-10 grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
              {gallery.featured.map((p, i) => {
                const landscape = p.width > p.height * 1.15;
                // A wide tile every fifth frame once there are enough photos to fill the rows around it.
                const wide = landscape && gallery.featured.length >= 8 && i % 5 === 0;
                return (
                  <li key={p.id} className={cn("relative overflow-hidden rounded-xl bg-navy-800", wide ? "col-span-2 aspect-[16/10]" : landscape ? "aspect-[4/3]" : "aspect-[3/4]")}>
                    <Photo photo={p} sizes={wide ? "(min-width: 1024px) 50vw, 100vw" : "(min-width: 1024px) 25vw, 50vw"} />
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      )}

      {/* How it works */}
      <section className={cn("border-y border-line bg-page", gallery.featured.length === 0 && "border-t-0")} aria-labelledby="how-heading">
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
          <p className="mt-8 text-sm text-muted">
            Already shot with us? <a href={galleryUrl} target="_blank" rel="noopener noreferrer" data-umami-event="gallery-click" className="font-semibold text-primary">View and buy your photos<span className="sr-only"> (opens in a new tab)</span></a>. Questions first? <Link href="/contact" className="font-semibold text-primary">Contact us</Link>.
          </p>
        </div>
      </section>

      {/* Real client reviews (none are invented; the section renders only with approved quotes) */}
      <Testimonials reviews={testimonials} />

      {/* FAQ */}
      <section className="mx-auto max-w-6xl px-4 py-16 lg:px-8 lg:py-24" aria-labelledby="faq-heading">
        <div className="grid gap-10 lg:grid-cols-[1fr_2fr]">
          <div>
            <p className="eyebrow">Good to know</p>
            <h2 id="faq-heading" className="mt-2 text-3xl font-extrabold tracking-tight text-navy sm:text-4xl">Questions before you book</h2>
            <p className="mt-3 text-base text-muted">Anything else? <Link href="/contact" className="font-semibold text-primary">Write to us</Link> and we reply within 24 hours.</p>
          </div>
          <dl className="divide-y divide-line rounded-card border border-line">
            {FAQ_ITEMS.map((f) => (
              <details key={f.question} className="group px-5 py-4">
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 text-base font-bold text-ink">
                  <dt>{f.question}</dt>
                  <ChevronRightIcon size={18} className="shrink-0 text-muted transition-transform group-open:rotate-90" />
                </summary>
                <dd className="pb-2 pt-2 text-sm leading-relaxed text-muted">{f.answer}</dd>
              </details>
            ))}
          </dl>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-navy text-white">
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-4 py-16 md:flex-row md:items-center md:justify-between lg:px-8">
          <div>
            <p className="eyebrow !text-white/60"><CalendarIcon size={14} className="mr-1 inline" /> Competing soon?</p>
            <h2 className="mt-2 text-2xl font-extrabold tracking-tight sm:text-3xl">Book your tournament photographer before the bracket is out.</h2>
            <p className="mt-2 max-w-lg text-sm text-white/70">Send the request now. We confirm the date and the price with you, then you secure the booking with a 50% deposit paid online.</p>
          </div>
          <Link href={primaryHref} data-umami-event={primaryEvent} className="btn-primary min-h-12 shrink-0 px-6 text-base shadow-hero">
            {primaryLabel}
            <ChevronRightIcon size={18} />
          </Link>
        </div>
      </section>
    </main>
  );
}
