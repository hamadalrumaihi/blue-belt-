import Link from "next/link";
import type { PhotoStudioRow } from "@/lib/supabase/database.types";
import { InstagramIcon, MailIcon, PhoneIcon, WhatsAppIcon } from "../icons";
import { Logo } from "../Logo";

export function PublicFooter({ studio }: { studio: PhotoStudioRow | null }) {
  const name = studio?.business_name ?? "Blue Belt Media";
  const ig = studio?.instagram?.replace(/^@/, "") ?? null;
  const wa = studio?.whatsapp?.replace(/\D/g, "") ?? null;
  return (
    <footer className="border-t border-line bg-navy text-white">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 md:grid-cols-3 lg:px-8">
        <div>
          <Logo inverted href="/" size={40} />
          <p className="mt-3 max-w-xs text-sm text-white/70">{studio?.tagline ?? "Combat sports photography & video."} {studio?.city ? `Based in ${studio.city}.` : ""}</p>
        </div>
        <nav aria-label="Footer">
          <p className="eyebrow mb-2 !text-white/50">Explore</p>
          <ul className="space-y-1 text-sm">
            {[
              ["/services", "Services"],
              ["/portfolio", "Portfolio"],
              ["/book", "Book now"],
              ["/contact", "Contact"],
              ["/client", "Client portal"],
            ].map(([href, label]) => (
              <li key={href}>
                <Link href={href} className="inline-flex min-h-9 items-center text-white/80 hover:text-white">{label}</Link>
              </li>
            ))}
          </ul>
        </nav>
        <div>
          <p className="eyebrow mb-2 !text-white/50">Talk to us</p>
          <ul className="space-y-1 text-sm">
            {ig && <li><a href={`https://instagram.com/${ig}`} rel="noopener noreferrer" target="_blank" className="inline-flex min-h-9 items-center gap-2 text-white/80 hover:text-white"><InstagramIcon size={18} /> @{ig}</a></li>}
            {wa && <li><a href={`https://wa.me/${wa}`} rel="noopener noreferrer" target="_blank" className="inline-flex min-h-9 items-center gap-2 text-white/80 hover:text-white"><WhatsAppIcon size={18} /> WhatsApp</a></li>}
            {studio?.phone && <li><a href={`tel:${studio.phone}`} className="inline-flex min-h-9 items-center gap-2 text-white/80 hover:text-white"><PhoneIcon size={18} /> {studio.phone}</a></li>}
            {studio?.email && <li><a href={`mailto:${studio.email}`} className="inline-flex min-h-9 items-center gap-2 text-white/80 hover:text-white"><MailIcon size={18} /> {studio.email}</a></li>}
            {!ig && !wa && !studio?.phone && !studio?.email && <li className="text-white/60">Contact details are being set up.</li>}
          </ul>
        </div>
      </div>
      <div className="border-t border-white/10 px-4 py-4 text-center text-xs text-white/50">© {new Date().getFullYear()} {name}. Galleries are delivered through Pic-Time.</div>
    </footer>
  );
}
