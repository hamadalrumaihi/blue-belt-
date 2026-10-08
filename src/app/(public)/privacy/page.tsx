import type { Metadata } from "next";
import Link from "next/link";
import { pageMetadata } from "@/lib/seo";
import { loadPublicStudio } from "@/lib/studio/queries";

export const dynamic = "force-dynamic";
export const metadata: Metadata = pageMetadata({
  title: "Privacy",
  description: "How Blue Belt Media uses the details you send with a booking request or message, and how to ask for them to be corrected or deleted.",
  path: "/privacy",
});

export default async function PrivacyPage() {
  const pub = await loadPublicStudio();
  const name = pub?.studio.business_name ?? "Blue Belt Media";
  const email = pub?.studio.email ?? null;
  return (
    <main className="mx-auto max-w-3xl px-4 py-14 lg:px-8 lg:py-20">
      <p className="eyebrow">Privacy</p>
      <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-navy sm:text-4xl">How we use your details</h1>
      <p className="mt-3 rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-sm font-semibold text-warning">Draft: this page is a plain-language placeholder and is still to be reviewed. It is not yet a complete privacy policy.</p>
      <div className="prose-sm mt-8 space-y-5 text-base leading-relaxed text-ink">
        <p>When you send a booking request or a message, {name} keeps the details you typed (name, phone, e-mail, the event or session you asked about) so we can reply, confirm the booking and deliver your gallery.</p>
        <p>We use your e-mail and phone number to contact you about your booking: confirmation, the online payment request after the shoot, and the link to your finished gallery. We do not sell or share your details with anyone outside the people who help deliver the work: our gallery host, Pic-Time, and our payment provider, MyFatoorah, when you pay online.</p>
        <p>Photos and video from a booking are yours to share. We may show selected images publicly (website, Instagram) unless you tell us not to when booking or afterwards.</p>
        <p>You can ask us to correct or delete your details at any time{email ? <> by e-mailing <a href={`mailto:${email}`} className="font-semibold text-primary">{email}</a></> : <> through the <Link href="/contact" className="font-semibold text-primary">contact page</Link></>}.</p>
      </div>
      <p className="mt-10 text-sm text-muted">
        See also the <Link href="/terms" className="font-semibold text-primary">photography terms</Link>.
      </p>
    </main>
  );
}
