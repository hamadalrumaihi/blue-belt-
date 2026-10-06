import type { ReactNode } from "react";
import { PublicFooter } from "@/components/public/PublicFooter";
import { PublicHeader } from "@/components/public/PublicHeader";
import { loadPublicStudio } from "@/lib/studio/queries";
import { resolveViewer } from "@/lib/roles";

/**
 * The public Blue Belt Media website. No session required; a signed-in
 * owner gets a "Studio" link, a signed-in client a "My bookings" link.
 */
export default async function PublicLayout({ children }: { children: ReactNode }) {
  const [viewer, pub] = await Promise.all([resolveViewer(), loadPublicStudio()]);
  const link = viewer ? (viewer.role === "client" ? { href: "/client", label: "My bookings" } : { href: "/studio", label: "Studio" }) : { href: "/client/login", label: "Client portal" };
  return (
    <div className="flex min-h-dvh flex-col bg-white text-ink">
      <PublicHeader accountLink={link} bookingOpen={Boolean(pub?.studio.public_booking)} />
      <div className="flex-1">{children}</div>
      <PublicFooter studio={pub?.studio ?? null} />
    </div>
  );
}
