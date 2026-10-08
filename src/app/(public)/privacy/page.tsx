import type { Metadata } from "next";
import Link from "next/link";
import { LegalDocumentView } from "@/components/public/LegalDocument";
import { buildPrivacy } from "@/lib/legal/privacy";
import { pageMetadata } from "@/lib/seo";
import { businessIdentity } from "@/lib/studio/business";

export const dynamic = "force-dynamic";
export const metadata: Metadata = pageMetadata({
  title: "Privacy policy",
  description: "What Blue Belt Media collects when you book, pay, sign and receive your gallery, who it is shared with, how long it is kept and how to ask about it.",
  path: "/privacy",
});

export default function PrivacyPage() {
  const doc = buildPrivacy(businessIdentity());
  return (
    <LegalDocumentView
      doc={doc}
      eyebrow="Privacy"
      footer={
        <>
          See also the <Link href="/terms" className="font-semibold text-primary">photography terms</Link>.
        </>
      }
    />
  );
}
