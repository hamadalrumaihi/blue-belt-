import type { Metadata } from "next";
import Link from "next/link";
import { LegalDocumentView } from "@/components/public/LegalDocument";
import { buildTerms } from "@/lib/legal/terms";
import { pageMetadata } from "@/lib/seo";
import { businessIdentity } from "@/lib/studio/business";

export const dynamic = "force-dynamic";
export const metadata: Metadata = pageMetadata({
  title: "Photography terms",
  description: "The terms for booking Blue Belt Media: requests and confirmation, prices, the 50% deposit and the balance after delivery, cancellations, delivery, galleries and the use of photos and video.",
  path: "/terms",
});

export default function TermsPage() {
  const doc = buildTerms(businessIdentity());
  return (
    <LegalDocumentView
      doc={doc}
      eyebrow="Terms"
      footer={
        <>
          See also the <Link href="/privacy" className="font-semibold text-primary">privacy policy</Link>. Ready to go? <Link href="/book" className="font-semibold text-primary">Book now</Link>.
        </>
      }
    />
  );
}
