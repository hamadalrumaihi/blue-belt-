"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { FormError, FormField } from "@/components/FormField";
import type { ActionState } from "@/lib/actions/types";
import { BOOKING_TYPES, BOOKING_TYPE_LABEL } from "@/lib/bookings/state";
import { SERVICE_MAX, slugify } from "@/lib/services/form";
import type { PhotoServiceRow } from "@/lib/supabase/database.types";

type Props = {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  initial?: PhotoServiceRow | null;
  submitLabel?: string;
};

export function ServiceForm({ action, initial, submitLabel = "Save package" }: Props) {
  const [state, formAction, pending] = useActionState(action, null);
  const fe = state?.fieldErrors ?? {};
  const [name, setName] = useState(initial?.name ?? "");
  const [code, setCode] = useState(initial?.code ?? "");
  const [codeTouched, setCodeTouched] = useState(Boolean(initial?.code));
  const [price, setPrice] = useState(initial?.price_qr === null || initial?.price_qr === undefined ? "" : String(initial.price_qr));

  return (
    <form action={formAction} className="card space-y-5 p-5" noValidate>
      <FormError message={state?.error} />

      <FormField label="Package name" htmlFor="name" required error={fe.name}>
        <input
          id="name"
          name="name"
          className="input"
          value={name}
          maxLength={SERVICE_MAX.name}
          onChange={(e) => {
            setName(e.target.value);
            if (!codeTouched) setCode(slugify(e.target.value));
          }}
          autoComplete="off"
          required
        />
      </FormField>

      <div className="grid gap-5 sm:grid-cols-2">
        <FormField label="Booking type" htmlFor="booking_type" required error={fe.booking_type} hint="Which step of the public booking form offers this package.">
          <select id="booking_type" name="booking_type" className="input" defaultValue={initial?.booking_type ?? "tournament_athlete"}>
            {BOOKING_TYPES.map((t) => (
              <option key={t} value={t}>{BOOKING_TYPE_LABEL[t]}</option>
            ))}
          </select>
        </FormField>
        <FormField label="Code" htmlFor="code" error={fe.code} hint="Short id used in reports. Filled from the name.">
          <input id="code" name="code" className="input font-mono" value={code} maxLength={SERVICE_MAX.code} onChange={(e) => { setCode(e.target.value); setCodeTouched(true); }} autoComplete="off" spellCheck={false} />
        </FormField>
      </div>

      <FormField label="Description" htmlFor="description" error={fe.description} hint="Shown on the public Services page.">
        <textarea id="description" name="description" className="input min-h-24 py-3" defaultValue={initial?.description ?? ""} maxLength={SERVICE_MAX.description} />
      </FormField>

      <div className="grid gap-5 sm:grid-cols-3">
        <FormField label="Price (QAR)" htmlFor="price_qr" error={fe.price_qr} hint={price.trim() ? "Shown as “from … QAR”." : "Empty = quote on request."}>
          <input id="price_qr" name="price_qr" className="input" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Quote" />
        </FormField>
        <FormField label="Deposit (QAR)" htmlFor="deposit_qr" error={fe.deposit_qr} hint="Optional.">
          <input id="deposit_qr" name="deposit_qr" className="input" inputMode="decimal" defaultValue={initial?.deposit_qr ?? ""} />
        </FormField>
        <FormField label="Duration (min)" htmlFor="duration_minutes" error={fe.duration_minutes} hint="Sessions only.">
          <input id="duration_minutes" name="duration_minutes" className="input" inputMode="numeric" defaultValue={initial?.duration_minutes ?? ""} />
        </FormField>
      </div>

      <fieldset className="space-y-2">
        <legend className="label">Includes</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex min-h-11 items-center gap-3 rounded-xl border border-line px-3">
            <input type="checkbox" name="includes_photo" className="h-5 w-5 accent-primary" defaultChecked={initial?.includes_photo ?? true} />
            <span className="text-sm font-semibold text-ink">Photo</span>
          </label>
          <label className="flex min-h-11 items-center gap-3 rounded-xl border border-line px-3">
            <input type="checkbox" name="includes_video" className="h-5 w-5 accent-primary" defaultChecked={initial?.includes_video ?? false} />
            <span className="text-sm font-semibold text-ink">Video</span>
          </label>
        </div>
        {fe.includes_photo && <p className="text-xs font-semibold text-danger" role="alert">{fe.includes_photo}</p>}
      </fieldset>

      <div className="grid gap-2 sm:grid-cols-3">
        <label className="flex min-h-11 items-center gap-3 rounded-xl border border-line px-3">
          <input type="checkbox" name="active" className="h-5 w-5 accent-primary" defaultChecked={initial?.active ?? true} />
          <span className="text-sm font-semibold text-ink">Active</span>
        </label>
        <label className="flex min-h-11 items-center gap-3 rounded-xl border border-line px-3">
          <input type="checkbox" name="public" className="h-5 w-5 accent-primary" defaultChecked={initial?.public ?? true} />
          <span className="text-sm font-semibold text-ink">Show on website</span>
        </label>
        <FormField label="Sort order" htmlFor="sort_order" error={fe.sort_order} className="sm:col-span-1">
          <input id="sort_order" name="sort_order" className="input" inputMode="numeric" defaultValue={initial?.sort_order ?? 0} />
        </FormField>
      </div>

      <div className="flex gap-2 pt-1">
        <Link href="/packages" className="btn-secondary flex-1">Cancel</Link>
        <button type="submit" className="btn-primary flex-1" disabled={pending} aria-busy={pending}>
          {pending ? "Saving…" : submitLabel}
        </button>
      </div>
    </form>
  );
}
