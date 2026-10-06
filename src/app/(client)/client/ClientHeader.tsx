import Link from "next/link";
import { LogoutIcon } from "@/components/icons";
import { Logo } from "@/components/Logo";
import { signOutClient } from "@/lib/actions/client-auth";

/** Portal top bar: logo, "My bookings", sign out. Same at every width; the portal is a short list of cards. */
export function ClientHeader({ studioView = false }: { studioView?: boolean }) {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-white/90 backdrop-blur">
      <div className="mx-auto flex min-h-16 max-w-3xl items-center gap-3 px-4">
        <Logo href="/client" size={36} />
        <nav aria-label="Portal" className="ml-auto flex items-center gap-1">
          <Link href="/client" className="btn-ghost min-h-11 px-3 text-sm">My bookings</Link>
          {studioView ? (
            <Link href="/studio" className="btn-secondary min-h-11 px-3 text-sm">Back to studio</Link>
          ) : (
            <form action={signOutClient}>
              <button type="submit" className="btn-ghost min-h-11 px-3 text-sm" aria-label="Sign out"><LogoutIcon size={18} /><span className="hidden sm:inline">Sign out</span></button>
            </form>
          )}
        </nav>
      </div>
    </header>
  );
}
