import type { Metadata } from "next";
import Link from "next/link";
import { CameraIcon, CheckIcon, ChevronRightIcon, ClockIcon, ExternalIcon, VideoIcon } from "@/components/icons";
import { Photo } from "@/components/public/Photo";
import { PUBLIC_BOOKING_TYPES } from "@/lib/bookings/public-form";
import { loadSiteGallery } from "@/lib/photos/site";
import type { ServiceSlot, SitePhoto } from "@/lib/photos/manifest";
import { pageMetadata } from "@/lib/seo";
import { publicPrice } from "@/lib/services/pricing";
import { loadPublicStudio, pictimeGalleryUrl } from "@/lib/studio/queries";
import type { BookingType, PhotoServiceRow } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata: Metadata = pageMetadata({
  title: "BJJ photography and video services in Qatar",
  description: "Jiu-jitsu tournament photographer in Doha, club and team days, training session photography, athlete photoshoots and video coverage. Prices in QAR, quotes for team days.",
  path: "/services",
});

type Card = {
  id: string;
  slot: ServiceSlot;
  type: BookingType;
  title: string;
  lead: string;
  included: string[];
  /** For quoted work: what the price depends on. */
  dependsOn?: string[];
  bookHref: string;
  bookLabel: string;
  packages: PhotoServiceRow[];
};

function buildCards(services: PhotoServiceRow[], bookingOpen: boolean): Card[] {
  const by = (type: BookingType) => services.filter((s) => s.booking_type === type);
  const book = (query: string) => (bookingOpen ? `/book?${query}` : "/contact");
  const tournament = by("tournament_athlete");
  const info = (type: BookingType) => PUBLIC_BOOKING_TYPES.find((t) => t.value === type)!;
  return [
    {
      id: "tournament-photography",
      slot: "tournament_athlete",
      type: "tournament_athlete",
      title: "Tournament athlete photography",
      lead: "One athlete's competition day, photographed. We take the athlete's name, academy and division in advance, match them on the day from the bracket and follow it mat by mat.",
      included: ["Every match in the agreed scope, from warm-up to podium where access allows", "Edited photos in a private online gallery, ready to download and share", "Coverage depends on the agreed booking scope, the athlete's schedule and venue access"],
      bookHref: book("kind=tournament_athlete_photo"),
      bookLabel: "Book tournament photography",
      packages: tournament.filter((s) => !s.includes_video),
    },
    {
      id: "tournament-photo-video",
      slot: "tournament_photo_video",
      type: "tournament_athlete",
      title: "Tournament photography and video",
      lead: "The same competition coverage with video of the matches as well. The exact video deliverables are written into your booking agreement before you pay.",
      included: ["Photos as above, plus video of the agreed matches", "What is edited, how long the clips are and how they are delivered is set out in the agreement", "No highlight reels, full-match recordings or unlimited deliverables unless the agreement includes them"],
      bookHref: book("kind=tournament_athlete_photo_video"),
      bookLabel: "Book photo and video",
      packages: tournament.filter((s) => s.includes_video),
    },
    {
      id: "team-club-coverage",
      slot: "club",
      type: "club",
      title: info("club").title,
      lead: "A photographer, a videographer or both for your whole academy or team at a competition. Quoted per day.",
      included: ["The team's athletes covered across mats as the schedule allows", "Team and podium photographs where the day permits", "A private gallery for the club, shareable with every athlete"],
      dependsOn: ["Team size and how many athletes compete", "The tournament schedule and how long we are needed", "Photography only or photo and video", "The deliverables you want"],
      bookHref: book("type=club"),
      bookLabel: "Request a team quote",
      packages: by("club"),
    },
    {
      id: "training-sessions",
      slot: "training_session",
      type: "training_session",
      title: info("training_session").title,
      lead: "Photography or video at your academy during a regular class, open mat or sparring round: technique, atmosphere and the people who train there.",
      included: ["A session of the agreed length at your academy", "Edited photos or video delivered in a private gallery", "Images you can use for the academy's social media and website (club use is covered by the licence in your quote)"],
      bookHref: book("type=training_session"),
      bookLabel: "Book a training session",
      packages: by("training_session"),
    },
    {
      id: "athlete-sessions",
      slot: "private_session",
      type: "private_session",
      title: info("private_session").title,
      lead: "A dedicated session for one athlete: portraits, controlled action, sponsor and profile images, promotional content.",
      included: ["Planned with you: location, look and the shots you need", "Edited photos delivered in a private gallery", "Brand or sponsor use licensed as part of the quote"],
      bookHref: book("type=private_session"),
      bookLabel: "Book an athlete session",
      packages: by("private_session"),
    },
    {
      id: "custom-coverage",
      slot: "custom",
      type: "custom",
      title: info("custom").title,
      lead: "Seminars, grading days, promotions, event coverage for organisers and anything that does not fit the options above. Tell us what you have in mind and we come back with a plan and a price.",
      included: ["Scope, deliverables and timing agreed in writing", "Photo, video or both", "Private gallery delivery"],
      bookHref: book("type=custom"),
      bookLabel: "Describe your event",
      packages: by("custom"),
    },
  ];
}

function PackageRow({ service, bookingOpen, type }: { service: PhotoServiceRow; bookingOpen: boolean; type: BookingType }) {
  const price = publicPrice(service);
  const inner = (
    <>
      <div className="min-w-0 flex-1">
        <p className="font-bold text-ink">{service.name}</p>
        {service.description && <p className="mt-0.5 text-sm text-muted">{service.description}</p>}
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          {service.includes_photo && <span className="inline-flex items-center gap-1"><CameraIcon size={14} /> Photo</span>}
          {service.includes_video && <span className="inline-flex items-center gap-1"><VideoIcon size={14} /> Video</span>}
          {service.duration_minutes && <span className="inline-flex items-center gap-1"><ClockIcon size={14} /> {service.duration_minutes} min</span>}
        </p>
      </div>
      <p className={cn("shrink-0 text-right font-extrabold", price.mode === "quote" ? "text-sm text-muted" : "text-base text-navy")}>{price.label}</p>
    </>
  );
  return bookingOpen ? (
    <Link href={`/book?type=${type}&service=${service.id}`} data-umami-event="book-start" className="flex min-h-14 items-center gap-4 px-4 py-3 transition-colors hover:bg-page" aria-label={`Book ${service.name}`}>
      {inner}
    </Link>
  ) : (
    <div className="flex min-h-14 items-center gap-4 px-4 py-3">{inner}</div>
  );
}

function ServiceCard({ card, photos, bookingOpen, flip }: { card: Card; photos: SitePhoto[]; bookingOpen: boolean; flip: boolean }) {
  const photo = photos[0] ?? null;
  return (
    <article id={card.id} className="card overflow-hidden scroll-mt-24" aria-labelledby={`${card.id}-title`}>
      <div className={cn("grid md:grid-cols-[5fr_7fr]", flip && "md:[&>*:first-child]:order-2")}>
        <div className="relative min-h-56 bg-navy md:min-h-full">
          {photo ? (
            <Photo photo={photo} sizes="(min-width: 768px) 40vw, 100vw" alt="" className="absolute inset-0" />
          ) : (
            <div className="flex h-full min-h-56 items-center justify-center text-white/70"><CameraIcon size={40} /></div>
          )}
          {photos.length > 1 && (
            <ul className="absolute bottom-3 left-3 right-3 hidden grid-cols-3 gap-2 md:grid" aria-label="More examples">
              {photos.slice(1, 4).map((p) => (
                <li key={p.id} className="relative aspect-[4/3] overflow-hidden rounded-lg border border-white/30 bg-navy-800"><Photo photo={p} sizes="12vw" alt="" /></li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex flex-col p-6 md:p-8">
          <h2 id={`${card.id}-title`} className="text-2xl font-extrabold tracking-tight text-navy">{card.title}</h2>
          <p className="mt-2 text-base leading-relaxed text-muted">{card.lead}</p>
          <div className="mt-5 grid gap-5 sm:grid-cols-2">
            <div>
              <p className="eyebrow">What is included</p>
              <ul className="mt-2 space-y-1.5 text-sm text-ink">
                {card.included.map((i) => (
                  <li key={i} className="flex gap-2"><CheckIcon size={16} className="mt-0.5 shrink-0 text-primary" /> {i}</li>
                ))}
              </ul>
            </div>
            {card.dependsOn && (
              <div>
                <p className="eyebrow">The quote depends on</p>
                <ul className="mt-2 space-y-1.5 text-sm text-ink">
                  {card.dependsOn.map((i) => (
                    <li key={i} className="flex gap-2"><ChevronRightIcon size={16} className="mt-0.5 shrink-0 text-muted" /> {i}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <div className="mt-6">
            <p className="eyebrow">Packages and prices</p>
            {card.packages.length ? (
              <ul className="mt-2 divide-y divide-line rounded-xl border border-line">
                {card.packages.map((s) => (
                  <li key={s.id}><PackageRow service={s} bookingOpen={bookingOpen} type={card.type} /></li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 rounded-xl border border-dashed border-line px-4 py-3 text-sm text-muted">Quoted individually. Tell us about the day and we send a price within 24 hours.</p>
            )}
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link href={card.bookHref} data-umami-event={bookingOpen ? "book-start" : "contact-click"} className="btn-primary min-h-12 px-6">{bookingOpen ? card.bookLabel : "Ask about this"} <ChevronRightIcon size={16} /></Link>
            <p className="text-xs text-muted">Prices are confirmed with you before you sign and pay.</p>
          </div>
        </div>
      </div>
    </article>
  );
}

export default async function ServicesPage() {
  const [pub, gallery] = await Promise.all([loadPublicStudio(), loadSiteGallery()]);
  const services = pub?.services ?? [];
  const bookingOpen = Boolean(pub?.studio.public_booking);
  const galleryUrl = pictimeGalleryUrl(pub?.studio ?? null);
  const cards = buildCards(services, bookingOpen);

  return (
    <main>
      <section className="bg-navy text-white">
        <div className="mx-auto max-w-6xl px-4 py-14 lg:px-8 lg:py-20">
          <p className="eyebrow !text-white/60">Services and prices</p>
          <h1 className="mt-3 max-w-2xl text-4xl font-extrabold tracking-tight sm:text-5xl">Photography and video for jiu-jitsu and martial arts in Doha</h1>
          <p className="mt-4 max-w-xl text-base text-white/75">Prices are in Qatari riyal and confirmed with you before you sign and pay. Team days and unusual requests are quoted individually.</p>
          <nav aria-label="Services on this page" className="mt-8 flex flex-wrap gap-2">
            {cards.map((c) => (
              <a key={c.id} href={`#${c.id}`} className="inline-flex min-h-10 items-center rounded-full border border-white/25 px-4 text-sm font-semibold text-white/90 hover:bg-white/10">{c.title}</a>
            ))}
          </nav>
        </div>
      </section>

      <div className="mx-auto max-w-6xl space-y-8 px-4 py-14 lg:px-8 lg:py-20">
        {cards.map((c, i) => (
          <ServiceCard key={c.id} card={c} photos={gallery.services[c.slot]} bookingOpen={bookingOpen} flip={i % 2 === 1} />
        ))}

        <section className="rounded-card bg-page p-6 md:p-10" aria-labelledby="payment-heading">
          <h2 id="payment-heading" className="text-xl font-extrabold text-navy">How booking and payment work</h2>
          <ol className="mt-5 grid gap-4 text-sm text-ink md:grid-cols-4">
            {[
              ["Request received", "You send the form and get a reference straight away. Nothing is paid yet."],
              ["Confirmed and quoted", "We check the date and confirm the price, or send a quote for team and custom work."],
              ["Deposit paid, booking confirmed", "For commissioned coverage you sign the agreement online and pay a 50% deposit by secure online payment. That secures the booking."],
              ["Delivered, balance due", "Your edited photos and video arrive in your private gallery. The remaining 50% is due after delivery."],
            ].map(([title, body], i) => (
              <li key={title} className="rounded-xl border border-line bg-white p-4">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-navy text-xs font-bold text-white">{i + 1}</span>
                <p className="mt-3 font-bold text-ink">{title}</p>
                <p className="mt-1 text-muted">{body}</p>
              </li>
            ))}
          </ol>
          <p className="mt-6 text-sm text-ink">
            <span className="font-bold">Buying photos from an event gallery is separate:</span> public event galleries are published in the same place as your private gallery, and photos bought there are paid in the gallery, not through a booking.{" "}
            <a href={galleryUrl} target="_blank" rel="noopener noreferrer" data-umami-event="gallery-click" className="inline-flex items-center gap-1 font-semibold text-primary">
              View and buy photos <ExternalIcon size={14} />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          </p>
          <p className="mt-3 text-sm text-muted">
            Not sure which option fits? <Link href="/contact" className="font-semibold text-primary">Contact us</Link> and we will suggest one. Full terms are on the <Link href="/terms" className="font-semibold text-primary">terms page</Link>.
          </p>
        </section>
      </div>
    </main>
  );
}
