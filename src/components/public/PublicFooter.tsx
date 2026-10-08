import Link from "next/link";
import type { PhotoStudioRow } from "@/lib/supabase/database.types";
import { businessIdentity, businessLegalLine, formatPhone, whatsappUrl } from "@/lib/studio/business";
import { ExternalIcon, InstagramIcon, MailIcon, PhoneIcon, WhatsAppIcon } from "../icons";
import { Logo } from "../Logo";

type Props = {
  studio: PhotoStudioRow | null;
  /** The public client gallery (see `pictimeGalleryUrl`); opens in a new tab. */
  galleryUrl: string;
};

export function PublicFooter({ studio, galleryUrl }: Props) {
  const name = studio?.business_name ?? "Blue Belt Media";
  const identity = businessIdentity();
  const ig = studio?.instagram?.replace(/^@/, "") ?? null;
  const wa = whatsappUrl(studio?.whatsapp || identity.phone);
  const phone = studio?.phone?.trim() || formatPhone(identity.phone);
  const email = studio?.email || identity.email;
  return (
    <footer className="border-t border-line bg-navy text-white">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 md:grid-cols-3 lg:px-8">
        <div>
          <Logo inverted href="/" size={40} />
          <p className="mt-3 max-w-xs text-sm text-white/70">{studio?.tagline ?? "Jiu-jitsu and martial arts photography and video."} {studio?.city ? `Based in ${studio.city}.` : ""}</p>
        </div>
        <nav aria-label="Footer">
          <p className="eyebrow mb-2 !text-white/50">Explore</p>
          <ul className="space-y-1 text-sm">
            <li>
              <Link href="/services" className="inline-flex min-h-9 items-center text-white/80 hover:text-white">Services and prices</Link>
            </li>
            <li>
              <a href={galleryUrl} target="_blank" rel="noopener noreferrer" data-umami-event="gallery-click" className="inline-flex min-h-9 items-center gap-1 text-white/80 hover:text-white">
                View and buy photos <ExternalIcon size={14} />
                <span className="sr-only">(opens your gallery in a new tab)</span>
              </a>
            </li>
            {[
              ["/book", "Book now"],
              ["/contact", "Contact"],
              ["/client", "Client portal"],
              ["/privacy", "Privacy"],
              ["/terms", "Terms"],
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
            {ig && <li><a href={`https://instagram.com/${ig}`} rel="noopener noreferrer" target="_blank" data-umami-event="contact-click" className="inline-flex min-h-9 items-center gap-2 text-white/80 hover:text-white"><InstagramIcon size={18} /> @{ig}</a></li>}
            {wa && <li><a href={wa} rel="noopener noreferrer" target="_blank" data-umami-event="contact-click" className="inline-flex min-h-9 items-center gap-2 text-white/80 hover:text-white"><WhatsAppIcon size={18} /> WhatsApp</a></li>}
            {phone && <li><a href={`tel:${phone.replace(/\s/g, "")}`} data-umami-event="contact-click" className="inline-flex min-h-9 items-center gap-2 text-white/80 hover:text-white"><PhoneIcon size={18} /> {phone}</a></li>}
            <li><a href={`mailto:${email}`} data-umami-event="contact-click" className="inline-flex min-h-9 items-center gap-2 text-white/80 hover:text-white"><MailIcon size={18} /> {email}</a></li>
          </ul>
        </div>
      </div>
      <div className="space-y-1 border-t border-white/10 px-4 py-4 text-center text-xs text-white/50">
        <p>© {new Date().getFullYear()} {name}. Photos are delivered through private online galleries.</p>
        <p>{businessLegalLine(identity)}</p>
      </div>
    </footer>
  );
}
