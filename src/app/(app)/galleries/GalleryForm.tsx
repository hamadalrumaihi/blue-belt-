"use client";

import Link from "next/link";
import { useActionState } from "react";
import { FormError, FormField } from "@/components/FormField";
import type { ActionState } from "@/lib/actions/types";
import { GALLERY_NAME_MAX, GALLERY_NOTES_MAX, GALLERY_PROJECT_ID_MAX } from "@/lib/galleries/form";
import type { GalleryBookingLite } from "@/lib/galleries/queries";
import type { PhotoGalleryRow } from "@/lib/supabase/database.types";

type Props = {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  bookings: GalleryBookingLite[];
  initial?: Partial<PhotoGalleryRow> | null;
  defaultBookingId?: string | null;
  submitLabel?: string;
  cancelHref?: string;
};

function bookingLabel(b: GalleryBookingLite): string {
  const ref = b.public_ref ?? "";
  const who = b.athlete_name || b.customer_name;
  return [ref, who, b.package_name].filter(Boolean).join(" · ");
}

/** New / edit gallery. The Pic-Time link is optional until the gallery exists in Pic-Time. */
export function GalleryForm({ action, bookings, initial, defaultBookingId, submitLabel = "Save gallery", cancelHref = "/galleries" }: Props) {
  const [state, formAction, pending] = useActionState(action, null);
  const fe = state?.fieldErrors ?? {};
  const bookingId = initial?.booking_id ?? defaultBookingId ?? "";
  const options = bookings.some((b) => b.id === bookingId) || !bookingId ? bookings : [{ id: bookingId, public_ref: null, athlete_name: "Current booking", customer_name: "", customer_email: "", booking_status: "confirmed" as const, event_id: null, session_at: null, package_name: "" }, ...bookings];

  return (
    <form action={formAction} className="card space-y-4 p-5" noValidate>
      <FormError message={state?.error} />
      {initial?.client_id && <input type="hidden" name="client_id" value={initial.client_id} />}
      {initial?.event_id && <input type="hidden" name="event_id" value={initial.event_id} />}

      <FormField label="Gallery name" htmlFor="gallery-name" required error={fe.name} hint="Use the Pic-Time project name so Zapier events match this gallery.">
        <input id="gallery-name" name="name" className="input" defaultValue={initial?.name ?? ""} maxLength={GALLERY_NAME_MAX} required autoComplete="off" aria-invalid={Boolean(fe.name)} aria-describedby={fe.name ? "gallery-name-error" : undefined} disabled={pending} />
      </FormField>

      <FormField label="Booking" htmlFor="gallery-booking" error={fe.booking_id} hint="Optional. Linking a booking fills in the client and moves the booking to Delivered once the client is told.">
        <select id="gallery-booking" name="booking_id" className="input" defaultValue={bookingId} disabled={pending} aria-invalid={Boolean(fe.booking_id)}>
          <option value="">No booking</option>
          {options.map((b) => (
            <option key={b.id} value={b.id}>{bookingLabel(b)}</option>
          ))}
        </select>
      </FormField>

      <FormField label="Pic-Time gallery link" htmlFor="gallery-url" error={fe.pictime_url} hint="The https link clients open (pic-time.com, or a gallery domain allowed in Settings). Leave empty until the gallery exists.">
        <input id="gallery-url" name="pictime_url" type="url" inputMode="url" className="input" defaultValue={initial?.pictime_url ?? ""} placeholder="https://studio.pic-time.com/…" autoComplete="off" spellCheck={false} aria-invalid={Boolean(fe.pictime_url)} aria-describedby={fe.pictime_url ? "gallery-url-error" : undefined} disabled={pending} />
      </FormField>

      <FormField label="Pic-Time project id" htmlFor="gallery-project" error={fe.pictime_project_id} hint="Optional. Lets Zapier events match this gallery even if the name changes.">
        <input id="gallery-project" name="pictime_project_id" className="input" defaultValue={initial?.pictime_project_id ?? ""} maxLength={GALLERY_PROJECT_ID_MAX} autoComplete="off" spellCheck={false} aria-invalid={Boolean(fe.pictime_project_id)} disabled={pending} />
      </FormField>

      <FormField label="Notes" htmlFor="gallery-notes" error={fe.notes} hint="For you only; clients never see this.">
        <textarea id="gallery-notes" name="notes" className="input min-h-24" defaultValue={initial?.notes ?? ""} maxLength={GALLERY_NOTES_MAX} aria-invalid={Boolean(fe.notes)} disabled={pending} />
      </FormField>

      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <Link href={cancelHref} className="btn-secondary min-h-11">Cancel</Link>
        <button type="submit" className="btn-primary min-h-11" disabled={pending} aria-busy={pending}>{pending ? "Saving…" : submitLabel}</button>
      </div>
    </form>
  );
}
