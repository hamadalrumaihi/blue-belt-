import type { ReactNode } from "react";

/**
 * Client portal shell. Each page decides whether a sign-in is required
 * (`/client/login` is public; everything else redirects there when signed
 * out). Kept minimal: the portal is a focused "my bookings" surface.
 */
export default function ClientLayout({ children }: { children: ReactNode }) {
  return <div className="min-h-dvh bg-page text-ink">{children}</div>;
}
