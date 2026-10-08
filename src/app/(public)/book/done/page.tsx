import type { Metadata } from "next";
import Link from "next/link";
import { CopyButton } from "@/components/CopyButton";
import { CheckIcon } from "@/components/icons";
import { isPublicRef } from "@/lib/bookings/public-form";
import { loadPublicStudio } from "@/lib/studio/queries";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Request received | Blue Belt Media" };

export default async function BookingDonePage({ searchParams }: PageProps<"/book/done">) {
  const [pub, params] = await Promise.all([loadPublicStudio(), searchParams]);
  const raw = Array.isArray(params.ref) ? params.ref[0] : params.ref;
  const ref = isPublicRef(raw) ? raw : null;
  const name = pub?.studio.business_name ?? "Blue Belt Media";
  const wa = pub?.studio.whatsapp?.replace(/\D/g, "") ?? null;
  return (
    <main className="bg-page">
      <div className="mx-auto max-w-2xl px-4 py-12 lg:px-8 lg:py-16">
        <div className="card p-6 sm:p-10" role="status" aria-live="polite" data-umami-event="booking-submitted">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-success-soft text-success"><CheckIcon size={28} /></span>
          <p className="eyebrow mt-6">Request received</p>
          <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-navy">Thank you. We are on it.</h1>
          {ref ? (
            <div className="mt-6 rounded-card border border-line bg-page p-4">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">Your reference</p>
              <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
                <p className="font-mono text-2xl font-extrabold text-navy">{ref}</p>
                <CopyButton value={ref} label="Copy" />
              </div>
              <p className="mt-2 text-xs text-muted">Quote it if you message us. It is also in the e-mail we just sent.</p>
            </div>
          ) : (
            <p className="mt-6 text-sm text-muted">Your reference is in the confirmation e-mail.</p>
          )}
          <h2 className="mt-8 text-base font-extrabold text-ink">What happens next</h2>
          <ol className="mt-3 space-y-3 text-sm text-ink">
            <li className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-navy text-xs font-bold text-white">1</span> {name} checks the schedule and confirms within 24 hours, by e-mail or WhatsApp.</li>
            <li className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-navy text-xs font-bold text-white">2</span> No payment is needed to book. After the shoot you pay online through MyFatoorah.</li>
            <li className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-navy text-xs font-bold text-white">3</span> Your gallery arrives as a private Pic-Time link.</li>
          </ol>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link href="/client" className="btn-primary min-h-12">Open the client portal</Link>
            {wa && <a href={`https://wa.me/${wa}`} target="_blank" rel="noopener noreferrer" className="btn-secondary min-h-12">Message us on WhatsApp</a>}
            <Link href="/" className="btn-ghost min-h-12">Back to home</Link>
          </div>
          <p className="mt-4 text-xs text-muted">The portal signs you in with the e-mail you used for this booking.</p>
        </div>
      </div>
    </main>
  );
}
