"use client";

import Link from "next/link";
import { useActionState } from "react";
import { FormError, FormField } from "@/components/FormField";
import type { ActionState } from "@/lib/actions/types";
import { BOOKING_TYPES, BOOKING_TYPE_LABEL } from "@/lib/bookings/state";
import { COMPARABLE_SCOPE_LABEL, COMPARABLE_SCOPES } from "@/lib/pricing/engine/types";
import { PRICE_CONFIDENCE_LABEL, PRICE_CONFIDENCES, PRICE_MEDIA_TYPE_LABEL, PRICE_MEDIA_TYPES, PRICE_REGION_LABEL, PRICE_REGIONS, PRICE_SOURCE_TYPE_LABEL, PRICE_SOURCE_TYPES, PRICING_MAX, priceReferenceIncludes } from "@/lib/pricing/form";
import type { PhotoPriceReferenceRow } from "@/lib/supabase/database.types";

type Props = {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  initial?: PhotoPriceReferenceRow | null;
  today: string;
  submitLabel?: string;
};

export function PriceReferenceForm({ action, initial, today, submitLabel = "Save observation" }: Props) {
  const [state, formAction, pending] = useActionState(action, null);
  const fe = state?.fieldErrors ?? {};
  const inc = initial ? priceReferenceIncludes(initial) : {};

  return (
    <form action={formAction} className="card space-y-5 p-5" noValidate>
      <FormError message={state?.error} />
      {initial && <input type="hidden" name="checked_on" value={initial.checked_on} />}

      <FormField label="Provider" htmlFor="provider" required error={fe.provider} hint="The photographer, studio or agency that advertises this price.">
        <input id="provider" name="provider" className="input" defaultValue={initial?.provider ?? ""} maxLength={PRICING_MAX.provider} autoComplete="organization" required />
      </FormField>

      <div className="grid gap-5 sm:grid-cols-2">
        <FormField label="Service type" htmlFor="service_type" required error={fe.service_type}>
          <select id="service_type" name="service_type" className="input" defaultValue={initial?.service_type ?? "tournament_athlete"}>
            {BOOKING_TYPES.map((t) => <option key={t} value={t}>{BOOKING_TYPE_LABEL[t]}</option>)}
          </select>
        </FormField>
        <FormField label="Comparable scope" htmlFor="comparable_scope" error={fe.comparable_scope} hint="Prices are only ever compared within one scope.">
          <select id="comparable_scope" name="comparable_scope" className="input" defaultValue={initial?.comparable_scope ?? "unknown"}>
            <option value="unknown">Not labelled (inferred from the service)</option>
            {COMPARABLE_SCOPES.map((s) => <option key={s} value={s}>{COMPARABLE_SCOPE_LABEL[s]}</option>)}
          </select>
        </FormField>
      </div>

      <div className="grid gap-5 sm:grid-cols-3">
        <FormField label="Price from (QAR)" htmlFor="price_from" required error={fe.price_from}>
          <input id="price_from" name="price_from" className="input" inputMode="decimal" defaultValue={initial?.price_from ?? ""} placeholder="350" autoComplete="off" required />
        </FormField>
        <FormField label="Price to (QAR)" htmlFor="price_to" error={fe.price_to} hint="Leave empty for a single price.">
          <input id="price_to" name="price_to" className="input" inputMode="decimal" defaultValue={initial?.price_to ?? ""} autoComplete="off" />
        </FormField>
        <FormField label="Observed on" htmlFor="observed_on" error={fe.observed_on ?? fe.checked_on} hint="When you saw this price.">
          <input id="observed_on" name="observed_on" className="input" type="date" defaultValue={initial?.observed_on ?? initial?.checked_on ?? today} max={today} />
        </FormField>
      </div>

      <div className="grid gap-5 sm:grid-cols-3">
        <FormField label="Source" htmlFor="source_type" error={fe.source_type}>
          <select id="source_type" name="source_type" className="input" defaultValue={initial?.source_type ?? "provider_site"}>
            {PRICE_SOURCE_TYPES.map((s) => <option key={s} value={s}>{PRICE_SOURCE_TYPE_LABEL[s]}</option>)}
          </select>
        </FormField>
        <FormField label="Confidence" htmlFor="confidence" error={fe.confidence} hint="Only verified or likely evidence prices a job.">
          <select id="confidence" name="confidence" className="input" defaultValue={initial?.confidence ?? "likely"}>
            {PRICE_CONFIDENCES.map((c) => <option key={c} value={c}>{PRICE_CONFIDENCE_LABEL[c]}</option>)}
          </select>
        </FormField>
        <FormField label="Region" htmlFor="region" error={fe.region} hint="GCC evidence is shown separately, never merged.">
          <select id="region" name="region" className="input" defaultValue={initial?.region ?? "qatar"}>
            {PRICE_REGIONS.map((r) => <option key={r} value={r}>{PRICE_REGION_LABEL[r]}</option>)}
          </select>
        </FormField>
      </div>

      <FormField label="Source link" htmlFor="source_url" error={fe.source_url} hint="The page or post where the price is listed.">
        <input id="source_url" name="source_url" className="input" type="url" inputMode="url" defaultValue={initial?.source_url ?? ""} maxLength={PRICING_MAX.source_url} placeholder="https://" autoComplete="off" spellCheck={false} />
      </FormField>

      <fieldset className="space-y-3">
        <legend className="label">What the price covers</legend>
        <p className="hint -mt-1">Leave a field empty when the provider does not say. Unknown is different from zero.</p>
        <div className="grid gap-4 sm:grid-cols-3">
          <FormField label="Media" htmlFor="media_type" error={fe.media_type}>
            <select id="media_type" name="media_type" className="input" defaultValue={initial?.media_type ?? "unknown"}>
              <option value="unknown">Not stated</option>
              {PRICE_MEDIA_TYPES.map((m) => <option key={m} value={m}>{PRICE_MEDIA_TYPE_LABEL[m]}</option>)}
            </select>
          </FormField>
          <FormField label="Duration (hours)" htmlFor="duration_hours" error={fe.duration_hours}>
            <input id="duration_hours" name="duration_hours" className="input" inputMode="decimal" defaultValue={initial?.duration_hours ?? inc.hours ?? ""} autoComplete="off" />
          </FormField>
          <FormField label="Staff on site" htmlFor="staffing_count" error={fe.staffing_count}>
            <input id="staffing_count" name="staffing_count" className="input" inputMode="numeric" defaultValue={initial?.staffing_count ?? ""} autoComplete="off" />
          </FormField>
          <FormField label="Athletes covered" htmlFor="athlete_count" error={fe.athlete_count ?? fe.includes_athletes}>
            <input id="athlete_count" name="athlete_count" className="input" inputMode="numeric" defaultValue={initial?.athlete_count ?? inc.athletes ?? ""} autoComplete="off" />
          </FormField>
          <FormField label="Edited images delivered" htmlFor="includes_photos" error={fe.includes_photos}>
            <input id="includes_photos" name="includes_photos" className="input" inputMode="numeric" defaultValue={inc.photos ?? ""} autoComplete="off" />
          </FormField>
          <FormField label="Delivery (days)" htmlFor="includes_delivery_days" error={fe.includes_delivery_days}>
            <input id="includes_delivery_days" name="includes_delivery_days" className="input" inputMode="numeric" defaultValue={inc.delivery_days ?? ""} autoComplete="off" />
          </FormField>
        </div>
        <FormField label="Deliverables" htmlFor="deliverables" error={fe.deliverables} hint="In the provider's words: '10 edited photos, online gallery', '2 reels'.">
          <input id="deliverables" name="deliverables" className="input" defaultValue={initial?.deliverables ?? ""} maxLength={PRICING_MAX.text} autoComplete="off" />
        </FormField>
        <div className="grid gap-4 sm:grid-cols-3">
          <FormField label="Editing / revisions" htmlFor="editing_revisions" error={fe.editing_revisions}>
            <input id="editing_revisions" name="editing_revisions" className="input" defaultValue={initial?.editing_revisions ?? ""} maxLength={PRICING_MAX.text} autoComplete="off" />
          </FormField>
          <FormField label="Usage rights" htmlFor="usage_rights" error={fe.usage_rights}>
            <input id="usage_rights" name="usage_rights" className="input" defaultValue={initial?.usage_rights ?? ""} maxLength={PRICING_MAX.text} autoComplete="off" />
          </FormField>
          <FormField label="Travel / tax notes" htmlFor="travel_tax_notes" error={fe.travel_tax_notes}>
            <input id="travel_tax_notes" name="travel_tax_notes" className="input" defaultValue={initial?.travel_tax_notes ?? ""} maxLength={PRICING_MAX.text} autoComplete="off" />
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

      <fieldset className="space-y-3">
        <legend className="label">Validity</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Promotion expires on" htmlFor="promotion_expires_on" error={fe.promotion_expires_on} hint="If the price is a limited offer.">
            <input id="promotion_expires_on" name="promotion_expires_on" className="input" type="date" defaultValue={initial?.promotion_expires_on ?? ""} />
          </FormField>
          <div>
            <label className="flex min-h-11 items-center gap-3 rounded-xl border border-line px-3">
              <input type="checkbox" name="excluded" className="h-5 w-5 accent-primary" defaultChecked={initial?.excluded ?? false} />
              <span className="text-sm font-semibold text-ink">Exclude from comparisons</span>
            </label>
          </div>
        </div>
        <FormField label="Why excluded" htmlFor="excluded_reason" error={fe.excluded_reason} hint="Required when excluded: 'different product (managed social)', 'not a shoot'.">
          <input id="excluded_reason" name="excluded_reason" className="input" defaultValue={initial?.excluded_reason ?? ""} maxLength={PRICING_MAX.text} autoComplete="off" />
        </FormField>
      </fieldset>

      <div className="grid gap-5 sm:grid-cols-2">
        <FormField label="Location" htmlFor="location" error={fe.location} hint="City or country.">
          <input id="location" name="location" className="input" defaultValue={initial?.location ?? "Doha"} maxLength={PRICING_MAX.location} autoComplete="off" />
        </FormField>
        <FormField label="Seed key" htmlFor="seed_key" error={fe.seed_key} hint="Optional stable id for imports; unique per owner.">
          <input id="seed_key" name="seed_key" className="input" defaultValue={initial?.seed_key ?? ""} maxLength={PRICING_MAX.seed_key} autoComplete="off" spellCheck={false} />
        </FormField>
      </div>

      <FormField label="Notes" htmlFor="notes" error={fe.notes} hint="Anything that explains the price: package name, conditions, how you found it.">
        <textarea id="notes" name="notes" className="input min-h-24 py-3" defaultValue={initial?.notes ?? ""} maxLength={PRICING_MAX.notes} />
      </FormField>

      <div className="flex flex-wrap gap-2 pt-1">
        <Link href="/pricing" className="btn-secondary flex-1">Cancel</Link>
        {initial && (
          <button type="submit" name="mode" value="reobserve" className="btn-secondary flex-1" disabled={pending} aria-busy={pending} title="Keeps this row as history and records today's observation as a new row.">
            {pending ? "Saving…" : "Save as new observation"}
          </button>
        )}
        <button type="submit" name="mode" value="edit" className="btn-primary flex-1" disabled={pending} aria-busy={pending}>
          {pending ? "Saving…" : submitLabel}
        </button>
      </div>
      {initial && <p className="text-[11px] text-muted">&ldquo;Save changes&rdquo; corrects this row in place (typos). &ldquo;Save as new observation&rdquo; keeps history: the old row is marked superseded and stops pricing anything.</p>}
    </form>
  );
}
