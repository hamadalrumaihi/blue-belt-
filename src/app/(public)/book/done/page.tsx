import type { Metadata } from "next";
import Link from "next/link";
import { CopyButton } from "@/components/CopyButton";
import { CheckIcon } from "@/components/icons";
import { isPublicRef } from "@/lib/bookings/public-form";
import { loadPublicStudio } from "@/lib/studio/queries";
import { businessIdentity, whatsappUrl } from "@/lib/studio/business";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Request received | Blue Belt Media", robots: { index: false, follow: false } };

/**
 * Shown only after `submitPublicBooking` redirected here with the reference
 * of a booking row it just wrote (or found again by idempotency key). Without
 * a valid reference the page does not claim anything was received.
 */
export default async function BookingDonePage({ searchParams }: PageProps<"/book/done">) {
  const [pub, params] = await Promise.all([loadPublicStudio(), searchParams]);
  const raw = Array.isArray(params.ref) ? params.ref[0] : params.ref;
  const ref = isPublicRef(raw) ? raw : null;
  const name = pub?.studio.business_name ?? "Blue Belt Media";
  const identity = businessIdentity();
  const wa = whatsappUrl(pub?.studio.whatsapp || identity.phone);

  if (!ref) {
    return (
      <main className="bg-page">
        <div className="mx-auto max-w-2xl px-4 py-12 lg:px-8 lg:py-16">
          <div className="card p-6 sm:p-10">
            <p className="eyebrow">Booking</p>
            <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-navy">No booking reference</h1>
            <p className="mt-3 text-base text-muted">This page shows a booking after it has been sent. If you just sent a request and did not get a reference, it was not saved. Please send it again.</p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link href="/book" className="btn-primary min-h-12">Start a booking</Link>
              {wa && <a href={wa} target="_blank" rel="noopener noreferrer" className="btn-secondary min-h-12">Message us on WhatsApp</a>}
            </div>
          </div>
        </div>
      </main>
    );
  }

  const steps = [
    `${name} checks availability and confirms within 24 hours, by e-mail or WhatsApp.`,
    "You sign your agreement online and pay the 50% deposit on our secure payment page. That secures the date.",
    "After the shoot your edited photos and video arrive in your private online gallery. The remaining 50% is due after delivery.",
  ];

  return (
    <main className="bg-page">
      <div className="mx-auto max-w-2xl px-4 py-12 lg:px-8 lg:py-16">
        <div className="card p-6 sm:p-10" role="status" aria-live="polite" data-umami-event="booking-submitted">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-success-soft text-success"><CheckIcon size={28} /></span>
          <p className="eyebrow mt-6">Request received</p>
          <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-navy">Thank you. We are on it.</h1>
          <div className="mt-6 rounded-card border border-line bg-page p-4">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">Your reference</p>
            <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
              <p className="font-mono text-2xl font-extrabold text-navy">{ref}</p>
              <CopyButton value={ref} label="Copy" />
            </div>
            <p className="mt-2 text-xs text-muted">Quote it if you message us. It is also in the e-mail we just sent.</p>
          </div>
          <h2 className="mt-8 text-base font-extrabold text-ink">What happens next</h2>
          <ol className="mt-3 space-y-3 text-sm text-ink">
            {steps.map((text, i) => (
              <li key={text} className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-navy text-xs font-bold text-white">{i + 1}</span>
                <span>{text}</span>
              </li>
            ))}
          </ol>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link href="/client" className="btn-primary min-h-12">Open the client portal</Link>
            {wa && <a href={wa} target="_blank" rel="noopener noreferrer" className="btn-secondary min-h-12">Message us on WhatsApp</a>}
            <Link href="/" className="btn-ghost min-h-12">Back to home</Link>
          </div>
          <p className="mt-4 text-xs text-muted">The portal signs you in with the e-mail you used for this booking.</p>
        </div>
      </div>
    </main>
  );
}
