import type { Metadata } from "next";
import Link from "next/link";
import { CopyButton } from "@/components/CopyButton";
import { CheckIcon } from "@/components/icons";
import { isPublicRef } from "@/lib/bookings/public-form";
import { loadPublicStudio } from "@/lib/studio/queries";
import { createServiceClient, isServiceClientConfigured } from "@/lib/supabase/service";
import type { PaymentMode } from "@/lib/supabase/database.types";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Request received | Blue Belt Media", robots: { index: false, follow: false } };

/**
 * Shown only after `submitPublicBooking` redirected here with the reference
 * of a booking row it just wrote (or found again by idempotency key). The
 * reference is looked up (id and payment mode only, nothing else leaves the
 * studio); without a matching booking the page does not claim anything was
 * received.
 *
 * The next steps repeat the approved policy only (the booking e-mail, the
 * FAQ and docs/studio-platform.md): a reply by e-mail (no reply-time promise), a quote first
 * where the work is quoted, the agreement and the 50% deposit confirm the
 * date, the balance is due after delivery. Availability is never promised.
 */
/** The booking behind a reference, for this studio only: id and payment mode, nothing more. */
async function findBooking(ownerId: string, ref: string): Promise<{ id: string; payment_mode: PaymentMode } | null> {
  if (!isServiceClientConfigured()) return null;
  const { data } = await createServiceClient().from("photo_bookings").select("id,payment_mode").eq("owner_id", ownerId).eq("public_ref", ref).maybeSingle();
  return data ?? null;
}

export default async function BookingDonePage({ searchParams }: PageProps<"/book/done">) {
  const [pub, params] = await Promise.all([loadPublicStudio(), searchParams]);
  const raw = Array.isArray(params.ref) ? params.ref[0] : params.ref;
  const booking = pub && isPublicRef(raw) ? await findBooking(pub.studio.owner_id, raw) : null;
  const ref = booking ? raw : null;
  const name = pub?.studio.business_name ?? "Blue Belt Media";

  if (!ref || !booking) {
    return (
      <main className="bg-page">
        <div className="mx-auto max-w-2xl px-4 py-12 lg:px-8 lg:py-16">
          <div className="card p-6 sm:p-10">
            <p className="eyebrow">Request</p>
            <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-navy">No request reference</h1>
            <p className="mt-3 text-base text-muted">This page shows a request after it has been sent. If you just sent one and did not get a reference, it was not saved. Please send it again.</p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link href="/book" className="btn-primary min-h-12">Start a request</Link>
              <Link href="/contact" className="btn-secondary min-h-12">Contact us</Link>
            </div>
          </div>
        </div>
      </main>
    );
  }

  const quoted = booking.payment_mode === "quote";
  const steps: Array<{ title: string; text: string }> = [
    {
      title: "We reply by e-mail",
      text: quoted
        ? `${name} reads your request and replies by e-mail with a price first. Nothing is due until you approve it.`
        : `${name} reads your request and replies by e-mail. If the date is free we confirm the date and the price with you.`,
    },
    { title: "You sign and pay the deposit", text: "Once the date and price are agreed you sign the agreement online and pay the 50% deposit on the secure payment page. That is the moment the date is reserved for you; until then it stays open." },
    { title: "Shoot and delivery", text: "After the shoot your edited photos and video arrive in a private online gallery sent to the e-mail you used. The remaining 50% is due after the gallery is delivered." },
  ];

  return (
    <main className="bg-page">
      <div className="mx-auto max-w-2xl px-4 py-12 lg:px-8 lg:py-16">
        <div className="card p-6 sm:p-10" role="status" aria-live="polite" data-umami-event="booking-submitted">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-success-soft text-success"><CheckIcon size={28} /></span>
          <p className="eyebrow mt-6">Request received</p>
          <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-navy">Thank you. We are on it.</h1>
          <p className="mt-3 text-base text-muted">Your request is saved and a copy is on its way to your inbox. It is not a confirmed reservation yet: the date is held for you only once the agreement is signed and the deposit is paid.</p>
          <div className="mt-6 rounded-card border border-line bg-page p-4">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">Your reference</p>
            <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
              <p className="font-mono text-2xl font-extrabold text-navy">{ref}</p>
              <CopyButton value={ref} label="Copy" />
            </div>
            <p className="mt-2 text-xs text-muted">Quote it if you message us. It is also in the e-mail we just sent.</p>
          </div>
          <h2 className="mt-8 text-base font-extrabold text-ink">What happens next</h2>
          <ol className="mt-3 space-y-4 text-sm text-ink">
            {steps.map((s, i) => (
              <li key={s.title} className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-navy text-xs font-bold text-white">{i + 1}</span>
                <span>
                  <span className="block font-bold">{s.title}</span>
                  <span className="block text-muted">{s.text}</span>
                </span>
              </li>
            ))}
          </ol>
          <p className="mt-6 text-sm text-muted">No reply after a working day? Message us with your reference and we will look it up. Personal use of the photos is included; club, team, brand or commercial use is licensed in the quote.</p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link href="/client" className="btn-primary min-h-12">Open the client portal</Link>
            <Link href="/contact" className="btn-secondary min-h-12">Contact us</Link>
            <Link href="/" className="btn-ghost min-h-12">Back to home</Link>
          </div>
          <p className="mt-4 text-xs text-muted">The portal signs you in with the e-mail you used for this request.</p>
        </div>
      </div>
    </main>
  );
}
