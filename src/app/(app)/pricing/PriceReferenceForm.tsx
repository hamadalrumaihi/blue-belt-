"use client";

import Link from "next/link";
import { useActionState } from "react";
import { FormError, FormField } from "@/components/FormField";
import type { ActionState } from "@/lib/actions/types";
import { BOOKING_TYPES, BOOKING_TYPE_LABEL } from "@/lib/bookings/state";
import { PRICING_MAX, priceReferenceIncludes } from "@/lib/pricing/form";
import type { PhotoPriceReferenceRow } from "@/lib/supabase/database.types";

type Props = {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  initial?: PhotoPriceReferenceRow | null;
  today: string;
  submitLabel?: string;
};

export function PriceReferenceForm({ action, initial, today, submitLabel = "Save reference" }: Props) {
  const [state, formAction, pending] = useActionState(action, null);
  const fe = state?.fieldErrors ?? {};
  const inc = initial ? priceReferenceIncludes(initial) : {};

  return (
    <form action={formAction} className="card space-y-5 p-5" noValidate>
      <FormError message={state?.error} />

      <FormField label="Provider" htmlFor="provider" required error={fe.provider} hint="The photographer, studio or agency that charges this price.">
        <input id="provider" name="provider" className="input" defaultValue={initial?.provider ?? ""} maxLength={PRICING_MAX.provider} autoComplete="organization" required />
      </FormField>

      <div className="grid gap-5 sm:grid-cols-2">
        <FormField label="Service type" htmlFor="service_type" required error={fe.service_type}>
          <select id="service_type" name="service_type" className="input" defaultValue={initial?.service_type ?? "tournament_athlete"}>
            {BOOKING_TYPES.map((t) => (
              <option key={t} value={t}>{BOOKING_TYPE_LABEL[t]}</option>
            ))}
          </select>
        </FormField>
        <FormField label="Location" htmlFor="location" error={fe.location} hint="City or country, optional.">
          <input id="location" name="location" className="input" defaultValue={initial?.location ?? ""} maxLength={PRICING_MAX.location} autoComplete="off" />
        </FormField>
      </div>

      <div className="grid gap-5 sm:grid-cols-3">
        <FormField label="Price from (QAR)" htmlFor="price_from" required error={fe.price_from}>
          <input id="price_from" name="price_from" className="input" inputMode="decimal" defaultValue={initial?.price_from ?? ""} placeholder="350" autoComplete="off" required />
        </FormField>
        <FormField label="Price to (QAR)" htmlFor="price_to" error={fe.price_to} hint="Leave empty for a single price.">
          <input id="price_to" name="price_to" className="input" inputMode="decimal" defaultValue={initial?.price_to ?? ""} autoComplete="off" />
        </FormField>
        <FormField label="Checked on" htmlFor="checked_on" error={fe.checked_on} hint="When you last saw this price.">
          <input id="checked_on" name="checked_on" className="input" type="date" defaultValue={initial?.checked_on ?? today} max={today} />
        </FormField>
      </div>

      <FormField label="Source link" htmlFor="source_url" error={fe.source_url} hint="The page or post where the price is listed, optional.">
        <input id="source_url" name="source_url" className="input" type="url" inputMode="url" defaultValue={initial?.source_url ?? ""} maxLength={PRICING_MAX.source_url} placeholder="https://" autoComplete="off" spellCheck={false} />
      </FormField>

      <fieldset className="space-y-3">
        <legend className="label">What the price includes</legend>
        <p className="hint -mt-1">Leave a field empty when the provider does not say. These scale the price to your job.</p>
        <div className="grid gap-4 sm:grid-cols-3">
          <FormField label="Hours of coverage" htmlFor="includes_hours" error={fe.includes_hours}>
            <input id="includes_hours" name="includes_hours" className="input" inputMode="decimal" defaultValue={inc.hours ?? ""} autoComplete="off" />
          </FormField>
          <FormField label="Athletes covered" htmlFor="includes_athletes" error={fe.includes_athletes}>
            <input id="includes_athletes" name="includes_athletes" className="input" inputMode="numeric" defaultValue={inc.athletes ?? ""} autoComplete="off" />
          </FormField>
          <FormField label="Photos delivered" htmlFor="includes_photos" error={fe.includes_photos}>
            <input id="includes_photos" name="includes_photos" className="input" inputMode="numeric" defaultValue={inc.photos ?? ""} autoComplete="off" />
          </FormField>
          <FormField label="Video" htmlFor="includes_video" error={fe.includes_video}>
            <select id="includes_video" name="includes_video" className="input" defaultValue={inc.video === true ? "yes" : inc.video === false ? "no" : "unknown"}>
              <option value="unknown">Not stated</option>
              <option value="yes">Included</option>
              <option value="no">Photo only</option>
            </select>
          </FormField>
          <FormField label="Editing hours" htmlFor="includes_editing_hours" error={fe.includes_editing_hours}>
            <input id="includes_editing_hours" name="includes_editing_hours" className="input" inputMode="decimal" defaultValue={inc.editing_hours ?? ""} autoComplete="off" />
          </FormField>
          <FormField label="Delivery (days)" htmlFor="includes_delivery_days" error={fe.includes_delivery_days}>
            <input id="includes_delivery_days" name="includes_delivery_days" className="input" inputMode="numeric" defaultValue={inc.delivery_days ?? ""} autoComplete="off" />
          </FormField>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex min-h-11 items-center gap-3 rounded-xl border border-line px-3">
            <input type="checkbox" name="includes_raw_files" className="h-5 w-5 accent-primary" defaultChecked={inc.raw_files ?? false} />
            <span className="text-sm font-semibold text-ink">RAW files included</span>
          </label>
          <label className="flex min-h-11 items-center gap-3 rounded-xl border border-line px-3">
            <input type="checkbox" name="includes_travel_included" className="h-5 w-5 accent-primary" defaultChecked={inc.travel_included ?? false} />
            <span className="text-sm font-semibold text-ink">Travel included</span>
          </label>
        </div>
      </fieldset>

      <FormField label="Notes" htmlFor="notes" error={fe.notes} hint="Anything that explains the price: package name, conditions, how you found it.">
        <textarea id="notes" name="notes" className="input min-h-24 py-3" defaultValue={initial?.notes ?? ""} maxLength={PRICING_MAX.notes} />
      </FormField>

      <div className="flex gap-2 pt-1">
        <Link href="/pricing" className="btn-secondary flex-1">Cancel</Link>
        <button type="submit" className="btn-primary flex-1" disabled={pending} aria-busy={pending}>
          {pending ? "Saving…" : submitLabel}
        </button>
      </div>
    </form>
  );
}
