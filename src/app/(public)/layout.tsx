import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Analytics } from "@/components/public/Analytics";
import { PublicFooter } from "@/components/public/PublicFooter";
import { PublicHeader } from "@/components/public/PublicHeader";
import { siteMetadata } from "@/lib/seo";
import { loadPublicStudio, pictimeGalleryUrl, siteUrl } from "@/lib/studio/queries";
import { resolveViewer } from "@/lib/roles";

/** Search defaults for every public page (metadataBase, title template, Open Graph); pages override title, description and canonical. */
export const metadata: Metadata = siteMetadata(siteUrl());

/**
 * The public Blue Belt Media website. No session required; a signed-in
 * owner gets a "Studio" link, a signed-in client a "My bookings" link.
 * Analytics (Umami, optional) is loaded here and nowhere else.
 */
export default async function PublicLayout({ children }: { children: ReactNode }) {
  const [viewer, pub] = await Promise.all([resolveViewer(), loadPublicStudio()]);
  const link = viewer ? (viewer.role === "client" ? { href: "/client", label: "My bookings" } : { href: "/studio", label: "Studio" }) : { href: "/client/login", label: "Client portal" };
  const galleryUrl = pictimeGalleryUrl(pub?.studio ?? null);
  return (
    <div className="flex min-h-dvh flex-col bg-white text-ink">
      <PublicHeader accountLink={link} bookingOpen={Boolean(pub?.studio.public_booking)} galleryUrl={galleryUrl} />
      <div className="flex-1">{children}</div>
      <PublicFooter studio={pub?.studio ?? null} galleryUrl={galleryUrl} />
      <Analytics />
    </div>
  );
}
