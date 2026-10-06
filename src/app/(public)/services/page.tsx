import type { Metadata } from "next";
import Link from "next/link";
import { CameraIcon, CheckIcon, ChevronRightIcon, ClockIcon, VideoIcon } from "@/components/icons";
import { PUBLIC_BOOKING_TYPES } from "@/lib/bookings/public-form";
import { formatQr } from "@/lib/bookings/state";
import { loadPublicStudio } from "@/lib/studio/queries";
import type { PhotoServiceRow } from "@/lib/supabase/database.types";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Services & prices — Blue Belt Media", description: "Tournament coverage, club days, training and private sessions. Clear prices, quotes for team days." };

function Price({ service }: { service: PhotoServiceRow }) {
  if (service.price_qr === null) return <span className="text-base font-bold text-navy">Quote on request</span>;
  return (
    <span className="text-base font-bold text-navy">
      <span className="text-xs font-semibold uppercase tracking-wider text-muted">from </span>
      {formatQr(Number(service.price_qr))}
    </span>
  );
}

export default async function ServicesPage() {
  const pub = await loadPublicStudio();
  const services = pub?.services ?? [];
  const bookingOpen = Boolean(pub?.studio.public_booking);
  const groups = PUBLIC_BOOKING_TYPES.map((t) => ({ ...t, services: services.filter((s) => s.booking_type === t.value) }));

  return (
    <main>
      <section className="bg-navy text-white">
        <div className="mx-auto max-w-6xl px-4 py-14 lg:px-8 lg:py-20">
          <p className="eyebrow !text-white/60">Services & prices</p>
          <h1 className="mt-3 max-w-2xl text-4xl font-extrabold tracking-tight sm:text-5xl">Clear packages. No surprises.</h1>
          <p className="mt-4 max-w-xl text-base text-white/75">Prices are in Qatari riyal and confirmed with you before anything is paid. Team days and unusual requests are quoted individually.</p>
        </div>
      </section>

      <div className="mx-auto max-w-6xl space-y-14 px-4 py-14 lg:px-8 lg:py-20">
        {groups.map((g) => (
          <section key={g.value} aria-labelledby={`svc-${g.value}`}>
            <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <div className="max-w-2xl">
                <h2 id={`svc-${g.value}`} className="text-2xl font-extrabold tracking-tight text-navy">{g.title}</h2>
                <p className="mt-1 text-sm text-muted">{g.body}</p>
              </div>
              <Link href={bookingOpen ? `/book?type=${g.value}` : "/contact"} className="btn-secondary shrink-0">
                {bookingOpen ? "Book this" : "Ask about this"}
                <ChevronRightIcon size={16} />
              </Link>
            </div>
            {g.services.length ? (
              <ul className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {g.services.map((s) => (
                  <li key={s.id} className="card flex flex-col p-6">
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="text-lg font-extrabold text-ink">{s.name}</h3>
                      <span className="flex shrink-0 items-center gap-1 text-muted">
                        {s.includes_photo && <CameraIcon size={18} aria-label="Photo" />}
                        {s.includes_video && <VideoIcon size={18} aria-label="Video" />}
                      </span>
                    </div>
                    {s.description && <p className="mt-2 flex-1 text-sm leading-relaxed text-muted">{s.description}</p>}
                    <dl className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
                      {s.duration_minutes && (
                        <div className="inline-flex items-center gap-1"><ClockIcon size={14} /> {s.duration_minutes} min</div>
                      )}
                      {s.deposit_qr !== null && Number(s.deposit_qr) > 0 && (
                        <div className="inline-flex items-center gap-1"><CheckIcon size={14} /> Deposit {formatQr(Number(s.deposit_qr))}</div>
                      )}
                    </dl>
                    <div className="mt-4 flex items-center justify-between border-t border-line pt-4">
                      <Price service={s} />
                      {bookingOpen && (
                        <Link href={`/book?type=${g.value}&service=${s.id}`} className="text-sm font-bold text-primary hover:underline">Book</Link>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-6 rounded-card border border-dashed border-line p-6 text-sm text-muted">Quoted individually — tell us about the day and we send a price within 24 hours.</p>
            )}
          </section>
        ))}

        <section className="rounded-card bg-page p-6 md:p-10">
          <h2 className="text-xl font-extrabold text-navy">Good to know</h2>
          <ul className="mt-4 grid gap-3 text-sm text-ink md:grid-cols-3">
            <li className="flex gap-3"><CheckIcon size={18} className="mt-0.5 shrink-0 text-primary" /> Nothing is charged on the website. After we confirm, a payment link follows by e-mail or WhatsApp.</li>
            <li className="flex gap-3"><CheckIcon size={18} className="mt-0.5 shrink-0 text-primary" /> Galleries are delivered through Pic-Time: private link, downloads and print orders in one place.</li>
            <li className="flex gap-3"><CheckIcon size={18} className="mt-0.5 shrink-0 text-primary" /> Tournament bookings are matched to your bracket, so we are mat-side when your name is called.</li>
          </ul>
        </section>
      </div>
    </main>
  );
}
