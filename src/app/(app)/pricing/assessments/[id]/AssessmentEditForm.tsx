"use client";

import { useActionState } from "react";
import { FormError, FormField } from "@/components/FormField";
import { recomputeAssessmentForm } from "@/lib/actions/pricing";
import type { ActionState } from "@/lib/actions/types";
import { MEDIA_SCOPES, VIDEO_DELIVERABLES } from "@/lib/catalog";
import type { CostAssumptions, PriceBand, PricingRequest } from "@/lib/pricing/engine/types";

type Props = { assessmentId: string; request: PricingRequest; assumptions: CostAssumptions; margins: PriceBand };

const KEY_ASSUMPTIONS: Array<{ key: keyof CostAssumptions; label: string }> = [
  { key: "ownerHourlyQr", label: "Your hourly rate (QAR)" },
  { key: "partnerVideographerDayQr", label: "Videographer partner / day" },
  { key: "secondShooterDayQr", label: "Second photographer / day" },
  { key: "imagesPerAthlete", label: "Images per athlete" },
  { key: "editingMinutesPerImage", label: "Editing min / image" },
  { key: "matsPerShooter", label: "Mats per photographer" },
  { key: "paymentFeePercent", label: "Payment fee %" },
  { key: "contingencyPercent", label: "Contingency %" },
];

/** Every field is optional: empty keeps the engine's value. Submitting creates a NEW version; this one is never changed. */
export function AssessmentEditForm({ assessmentId, request, assumptions, margins }: Props) {
  const action = recomputeAssessmentForm.bind(null, assessmentId);
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, null);
  const fe = state?.fieldErrors ?? {};
  return (
    <form action={formAction} className="mt-2 space-y-3" noValidate>
      <FormError message={state?.error} />
      <FormField label="Media" htmlFor="media" error={fe.media}>
        <select id="media" name="media" className="input" defaultValue={request.media}>
          {MEDIA_SCOPES.map((m) => <option key={m} value={m}>{m.replace("_", " + ")}</option>)}
        </select>
      </FormField>
      <fieldset>
        <legend className="label">Video deliverables</legend>
        <div className="grid grid-cols-2 gap-1">
          {VIDEO_DELIVERABLES.map((d) => (
            <label key={d} className="flex min-h-10 items-center gap-2 rounded-lg border border-line px-2 text-xs font-semibold text-ink">
              <input type="checkbox" name="video_deliverables" value={d} className="h-4 w-4 accent-primary" defaultChecked={request.videoDeliverables.includes(d)} />
              {d.replace("_", " ")}
            </label>
          ))}
        </div>
        {fe.video_deliverables && <p className="mt-1 text-xs font-semibold text-danger">{fe.video_deliverables}</p>}
      </fieldset>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Hours on site" htmlFor="hours_on_site" error={fe.hours_on_site}><input id="hours_on_site" name="hours_on_site" className="input" inputMode="decimal" defaultValue={request.hoursOnSite ?? ""} /></FormField>
        <FormField label="Days" htmlFor="days" error={fe.days}><input id="days" name="days" className="input" inputMode="numeric" defaultValue={request.days} /></FormField>
        <FormField label="Athletes" htmlFor="athlete_count" error={fe.athlete_count}><input id="athlete_count" name="athlete_count" className="input" inputMode="numeric" defaultValue={request.athleteCount ?? ""} /></FormField>
        <FormField label="Mats at once" htmlFor="simultaneous_mats" error={fe.simultaneous_mats}><input id="simultaneous_mats" name="simultaneous_mats" className="input" inputMode="numeric" defaultValue={request.simultaneousMats ?? ""} /></FormField>
        <FormField label="Expected images" htmlFor="expected_images" error={fe.expected_images}><input id="expected_images" name="expected_images" className="input" inputMode="numeric" defaultValue={request.expectedImages ?? ""} /></FormField>
        <FormField label="Deadline (days)" htmlFor="deadline_days" error={fe.deadline_days}><input id="deadline_days" name="deadline_days" className="input" inputMode="numeric" defaultValue={request.deadlineDays ?? ""} /></FormField>
      </div>
      <FormField label="Location kind" htmlFor="location_kind" error={fe.location_kind}>
        <select id="location_kind" name="location_kind" className="input" defaultValue={request.locationKind}>
          {["venue", "academy", "studio", "outdoor", "unknown"].map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
      </FormField>
      <details className="text-xs">
        <summary className="cursor-pointer font-semibold text-muted">Cost assumptions and margins</summary>
        <div className="mt-2 grid grid-cols-2 gap-3">
          {KEY_ASSUMPTIONS.map((k) => (
            <FormField key={k.key} label={k.label} htmlFor={`cost_${k.key}`} error={fe[`cost_${k.key}`]}><input id={`cost_${k.key}`} name={`cost_${k.key}`} className="input" inputMode="decimal" defaultValue={assumptions[k.key]} /></FormField>
          ))}
          {(["low", "target", "high"] as const).map((k) => (
            <FormField key={k} label={`Margin ${k} %`} htmlFor={`margin_${k}`} error={fe[`margin_${k}`]}><input id={`margin_${k}`} name={`margin_${k}`} className="input" inputMode="decimal" defaultValue={margins[k]} /></FormField>
          ))}
        </div>
        <p className="mt-1 text-[11px] text-muted">Margin is profit as a share of the price: price = cost ÷ (1 − margin − fee). A 30% markup on cost is only a 23% margin.</p>
      </details>
      <button type="submit" className="btn-secondary min-h-11 w-full" disabled={pending} aria-busy={pending}>{pending ? "Computing…" : "Compute new version"}</button>
    </form>
  );
}
