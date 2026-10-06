"use client";

import Link from "next/link";
import { useActionState } from "react";
import { FormError, FormField } from "@/components/FormField";
import { ExternalIcon } from "@/components/icons";
import { saveStudio, type StudioState } from "@/lib/actions/studio";
import { galleryHostsOf } from "@/lib/galleries/form";
import { STUDIO_GALLERY_HOSTS } from "@/lib/galleries/state";
import { DEFAULT_PICTIME_GALLERY_URL, normalizePictimeGalleryUrl } from "@/lib/studio/site-content";
import type { PhotoStudioRow } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";

type Props = { studio: PhotoStudioRow | null; defaults: Omit<PhotoStudioRow, "owner_id" | "created_at" | "updated_at">; publicSiteReady: boolean };

export function StudioSettings({ studio, defaults, publicSiteReady }: Props) {
  const [state, formAction, pending] = useActionState<StudioState, FormData>(saveStudio, null);
  const fe = state?.fieldErrors ?? {};
  const v = studio ?? defaults;
  const open = studio?.public_booking ?? false;
  const hosts = galleryHostsOf(studio?.settings).join(", ");
  const settingsObj = studio?.settings && typeof studio.settings === "object" && !Array.isArray(studio.settings) ? (studio.settings as Record<string, unknown>) : {};
  const galleryUrl = normalizePictimeGalleryUrl(settingsObj.pictimeGalleryUrl) ?? "";
  return (
    <section className="card space-y-4 p-5" aria-labelledby="studio-heading">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="studio-heading" className="text-base font-bold text-ink">Public site</h2>
          <p className="mt-1 text-sm text-muted">What visitors see on the website and how they reach you. Turning on public booking opens the <Link href="/book" className="font-semibold text-primary">/book</Link> wizard and the contact form; requests land in Leads and Bookings.</p>
        </div>
        <span className={cn("shrink-0 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider", open ? "bg-success-soft text-success" : "bg-page text-muted")}>{open ? "Booking open" : "Booking closed"}</span>
      </div>
      {!publicSiteReady && <p className="rounded-xl border border-warning/30 bg-warning-soft px-3 py-2 text-xs font-semibold text-warning">The server has no service role key, so the public site cannot read your studio yet. Set SUPABASE_SERVICE_ROLE_KEY to open booking.</p>}

      <form action={formAction} className="space-y-4" noValidate>
        <FormError message={state?.error} />
        <FormField label="Business name" htmlFor="business_name" required error={fe.business_name}>
          <input id="business_name" name="business_name" className="input" defaultValue={v.business_name} maxLength={80} required />
        </FormField>
        <FormField label="Tagline" htmlFor="tagline" error={fe.tagline} hint="One line under the logo and in the hero.">
          <input id="tagline" name="tagline" className="input" defaultValue={v.tagline ?? ""} maxLength={140} />
        </FormField>
        <FormField label="About" htmlFor="about" error={fe.about} hint="Two or three sentences for the home page.">
          <textarea id="about" name="about" className="input min-h-24 py-3" defaultValue={v.about ?? ""} maxLength={2000} />
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="City" htmlFor="city" error={fe.city}>
            <input id="city" name="city" className="input" defaultValue={v.city ?? ""} maxLength={80} autoComplete="address-level2" />
          </FormField>
          <FormField label="Public e-mail" htmlFor="email" error={fe.email}>
            <input id="email" name="email" type="email" inputMode="email" className="input" defaultValue={v.email ?? ""} autoComplete="email" />
          </FormField>
          <FormField label="Phone" htmlFor="phone" error={fe.phone}>
            <input id="phone" name="phone" type="tel" inputMode="tel" className="input" defaultValue={v.phone ?? ""} autoComplete="tel" placeholder="+974 …" />
          </FormField>
          <FormField label="WhatsApp" htmlFor="whatsapp" error={fe.whatsapp} hint="With country code; used for wa.me links.">
            <input id="whatsapp" name="whatsapp" type="tel" inputMode="tel" className="input" defaultValue={v.whatsapp ?? ""} placeholder="+974 …" />
          </FormField>
          <FormField label="Instagram" htmlFor="instagram" error={fe.instagram}>
            <input id="instagram" name="instagram" className="input" defaultValue={v.instagram ?? ""} placeholder="@handle" autoComplete="off" />
          </FormField>
        </div>
        <FormField label="Public gallery link" htmlFor="pictime_gallery_url" error={fe.pictime_gallery_url} hint={`Where "View and buy photos" on the website sends visitors. Leave empty for ${DEFAULT_PICTIME_GALLERY_URL}.`}>
          <input id="pictime_gallery_url" name="pictime_gallery_url" type="url" inputMode="url" className="input" defaultValue={galleryUrl} placeholder={DEFAULT_PICTIME_GALLERY_URL} maxLength={2048} autoComplete="off" spellCheck={false} />
        </FormField>
        <FormField label="Extra gallery domains" htmlFor="gallery_hosts" error={fe.gallery_hosts} hint={`pic-time.com and ${STUDIO_GALLERY_HOSTS.join(", ")} are always allowed for gallery links. Add any other hostname clients open galleries on, comma-separated.`}>
          <input id="gallery_hosts" name="gallery_hosts" className="input" defaultValue={hosts} placeholder="photos.example.com" autoComplete="off" spellCheck={false} inputMode="url" />
        </FormField>
        <label className="flex min-h-11 items-start gap-3 rounded-xl border border-line px-3 py-2">
          <input type="checkbox" name="public_booking" className="mt-1 h-5 w-5 accent-primary" defaultChecked={open} />
          <span className="text-sm text-ink">
            <span className="block font-semibold">Open public booking</span>
            <span className="block text-xs text-muted">Visitors can send booking requests. No payment is taken at booking; you confirm the price and the client pays online through MyFatoorah after the shoot.</span>
          </span>
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className="btn-primary" disabled={pending} aria-busy={pending}>{pending ? "Saving…" : "Save public site"}</button>
          <Link href="/" target="_blank" className="btn-ghost">Preview site <ExternalIcon size={16} /></Link>
          <p className="text-xs font-semibold text-success" role="status" aria-live="polite">{state?.saved && !pending ? "Saved." : ""}</p>
        </div>
      </form>
    </section>
  );
}
