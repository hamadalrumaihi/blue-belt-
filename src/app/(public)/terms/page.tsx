import type { Metadata } from "next";
import Link from "next/link";
import { loadPublicStudio } from "@/lib/studio/queries";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Photography terms — Blue Belt Media" };

export default async function TermsPage() {
  const pub = await loadPublicStudio();
  const name = pub?.studio.business_name ?? "Blue Belt Media";
  return (
    <main className="mx-auto max-w-3xl px-4 py-14 lg:px-8 lg:py-20">
      <p className="eyebrow">Terms</p>
      <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-navy sm:text-4xl">Photography terms</h1>
      <p className="mt-3 rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-sm font-semibold text-warning">Draft: these terms are a short placeholder and are still to be reviewed. The agreement you sign for a booking is the one that applies.</p>
      <ol className="mt-8 list-decimal space-y-4 pl-5 text-base leading-relaxed text-ink">
        <li><strong>A request is not a booking.</strong> Sending the form reserves nothing until {name} confirms it. We aim to confirm within 24 hours.</li>
        <li><strong>Prices and payment.</strong> Prices shown are in QAR and are confirmed before you pay. Nothing is charged on this website; a payment link or bank details follow once a price is agreed. Team days and custom work are quoted first.</li>
        <li><strong>Tournament coverage.</strong> We follow the official bracket and schedule. Last-minute changes by the organiser (mat, time, withdrawal) are outside our control; we will tell you as soon as we know.</li>
        <li><strong>Cancellations.</strong> Tell us as early as possible. Where a deposit was paid, the signed agreement says what is refundable.</li>
        <li><strong>Delivery.</strong> Edited photos and video are delivered through a private Pic-Time gallery. Timelines are agreed per booking.</li>
        <li><strong>Use of images.</strong> You may share and print your images. {name} keeps the right to use selected images for its own portfolio and social media unless you ask us not to.</li>
      </ol>
      <p className="mt-10 text-sm text-muted">
        See also the <Link href="/privacy" className="font-semibold text-primary">privacy note</Link>.
      </p>
    </main>
  );
}
