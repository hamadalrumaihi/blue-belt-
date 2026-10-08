"use client";

import Link from "next/link";
import { useActionState } from "react";
import { FormError, FormField } from "@/components/FormField";
import type { ActionState } from "@/lib/actions/types";
import { BOOKING_TYPES, BOOKING_TYPE_LABEL } from "@/lib/bookings/state";
import { DEFAULT_MARGIN_PERCENT, PRICING_MAX } from "@/lib/pricing/form";
import { TRAVEL_QR_PER_KM } from "@/lib/pricing/suggest";
import type { BookingType } from "@/lib/supabase/database.types";

export type QuotePrefill = { service_type: BookingType; hours: number | null; athletes: number | null; video: boolean };

type Props = {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  prefill: QuotePrefill | null;
  referenceCount: number;
};

export function QuoteForm({ action, prefill, referenceCount }: Props) {
  const [state, formAction, pending] = useActionState(action, null);
  const fe = state?.fieldErrors ?? {};

  return (
    <form action={formAction} className="card space-y-5 p-5" noValidate>
      <FormError message={state?.error} />

      <fieldset className="space-y-4">
        <legend className="label">The job</legend>
        <FormField label="Service type" htmlFor="service_type" required error={fe.service_type} hint={referenceCount ? `${referenceCount} reference price${referenceCount === 1 ? "" : "s"} on file; only those of the same type count.` : undefined}>
          <select id="service_type" name="service_type" className="input" defaultValue={prefill?.service_type ?? "tournament_athlete"}>
            {BOOKING_TYPES.map((t) => (
              <option key={t} value={t}>{BOOKING_TYPE_LABEL[t]}</option>
            ))}
          </select>
        </FormField>
        <div className="grid gap-4 sm:grid-cols-3">
          <FormField label="Hours on site" htmlFor="hours" error={fe.hours} hint="Shooting time.">
            <input id="hours" name="hours" className="input" inputMode="decimal" defaultValue={prefill?.hours ?? ""} autoComplete="off" />
          </FormField>
          <FormField label="Athletes" htmlFor="athletes" error={fe.athletes}>
            <input id="athletes" name="athletes" className="input" inputMode="numeric" defaultValue={prefill?.athletes ?? ""} autoComplete="off" />
          </FormField>
          <FormField label="Photos expected" htmlFor="photos_expected" error={fe.photos_expected}>
            <input id="photos_expected" name="photos_expected" className="input" inputMode="numeric" autoComplete="off" />
          </FormField>
        </div>
        <label className="flex min-h-11 items-center gap-3 rounded-xl border border-line px-3">
          <input type="checkbox" name="video" className="h-5 w-5 accent-primary" defaultChecked={prefill?.video ?? false} />
          <span className="text-sm font-semibold text-ink">Video is part of this job</span>
        </label>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="label">Your costs</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Editing hours" htmlFor="editing_hours" error={fe.editing_hours} hint="Costed at your target hourly rate.">
            <input id="editing_hours" name="editing_hours" className="input" inputMode="decimal" autoComplete="off" />
          </FormField>
          <FormField label="Target hourly rate (QAR)" htmlFor="target_hourly_qr" error={fe.target_hourly_qr} hint="Optional. Without it, editing uses the market hourly rate.">
            <input id="target_hourly_qr" name="target_hourly_qr" className="input" inputMode="decimal" autoComplete="off" />
          </FormField>
          <FormField label="Travel distance (km)" htmlFor="travel_km" error={fe.travel_km} hint={`${TRAVEL_QR_PER_KM} QAR per km unless you enter a travel cost.`}>
            <input id="travel_km" name="travel_km" className="input" inputMode="decimal" autoComplete="off" />
          </FormField>
          <FormField label="Travel cost (QAR)" htmlFor="travel_cost_qr" error={fe.travel_cost_qr} hint="Overrides the distance.">
            <input id="travel_cost_qr" name="travel_cost_qr" className="input" inputMode="decimal" autoComplete="off" />
          </FormField>
          <FormField label="Video partner (QAR)" htmlFor="video_partner_cost_qr" error={fe.video_partner_cost_qr} hint="What a videographer charges you.">
            <input id="video_partner_cost_qr" name="video_partner_cost_qr" className="input" inputMode="decimal" autoComplete="off" />
          </FormField>
          <FormField label="Other costs (QAR)" htmlFor="other_costs_qr" error={fe.other_costs_qr} hint="Permits, assistants, prints.">
            <input id="other_costs_qr" name="other_costs_qr" className="input" inputMode="decimal" autoComplete="off" />
          </FormField>
        </div>
        <FormField label="Margin on costs (%)" htmlFor="margin_percent" error={fe.margin_percent} hint={`Added on top of your costs. 0 to ${PRICING_MAX.margin}.`}>
          <input id="margin_percent" name="margin_percent" className="input" inputMode="decimal" defaultValue={DEFAULT_MARGIN_PERCENT} autoComplete="off" />
        </FormField>
      </fieldset>

      <FormField label="Notes" htmlFor="notes" error={fe.notes} hint="For you only.">
        <textarea id="notes" name="notes" className="input min-h-20 py-3" maxLength={PRICING_MAX.notes} />
      </FormField>

      <div className="flex gap-2 pt-1">
        <Link href="/pricing" className="btn-secondary flex-1">Cancel</Link>
        <button type="submit" className="btn-primary flex-1" disabled={pending} aria-busy={pending}>
          {pending ? "Working…" : "Suggest a price"}
        </button>
      </div>
    </form>
  );
}
