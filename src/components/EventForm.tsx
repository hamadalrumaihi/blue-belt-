"use client";

import Link from "next/link";
import { useActionState } from "react";
import type { ActionState } from "@/lib/actions/types";
import type { EventRow } from "@/lib/types";
import { PLATFORMS } from "@/lib/types";
import { FormError, FormField } from "./FormField";

type Props = {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  initial?: Partial<EventRow> | null;
  submitLabel?: string;
  cancelHref?: string;
  defaultTimezone?: string;
  defaultPlatform?: string;
};

export function EventForm({ action, initial, submitLabel = "Save event", cancelHref = "/events", defaultTimezone = "Asia/Qatar", defaultPlatform = "AJP" }: Props) {
  const [state, formAction, pending] = useActionState(action, null);
  const fe = state?.fieldErrors ?? {};

  return (
    <form action={formAction} className="card space-y-5 p-5" noValidate>
      <FormError message={state?.error} />

      <FormField label="Event name" htmlFor="name" required error={fe.name}>
        <input id="name" name="name" className="input" defaultValue={initial?.name ?? ""} required autoComplete="off" />
      </FormField>

      <div className="grid gap-5 sm:grid-cols-2">
        <FormField label="Date" htmlFor="event_date" error={fe.event_date}>
          <input id="event_date" name="event_date" type="date" className="input" defaultValue={initial?.event_date ?? ""} />
        </FormField>
        <FormField label="Platform" htmlFor="platform" required error={fe.platform}>
          <select id="platform" name="platform" className="input" defaultValue={initial?.platform ?? defaultPlatform}>
            {PLATFORMS.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </FormField>
      </div>

      <FormField label="Venue" htmlFor="venue">
        <input id="venue" name="venue" className="input" defaultValue={initial?.venue ?? ""} placeholder="Aspire Ladies Sports Hall, Doha" />
      </FormField>

      <div className="grid gap-5 sm:grid-cols-2">
        <FormField label="Country" htmlFor="country">
          <input id="country" name="country" className="input" defaultValue={initial?.country ?? ""} placeholder="Qatar" />
        </FormField>
        <FormField label="Timezone" htmlFor="timezone" required error={fe.timezone} hint="IANA name, e.g. Asia/Qatar">
          <input id="timezone" name="timezone" className="input" defaultValue={initial?.timezone ?? defaultTimezone} />
        </FormField>
      </div>

      <FormField label="Official event URL" htmlFor="source_url" error={fe.source_url} hint="The AJP / Smoothcomp event page (optional)">
        <input id="source_url" name="source_url" type="url" inputMode="url" className="input" defaultValue={initial?.source_url ?? ""} placeholder="https://ajptour.com/en/event/…" />
      </FormField>

      <label className="flex min-h-11 items-center gap-3 rounded-xl border border-line px-3">
        <input type="checkbox" name="active" className="h-5 w-5 accent-primary" defaultChecked={initial?.active ?? true} />
        <span className="text-sm font-semibold text-ink">Active event <span className="font-normal text-muted">(uncheck to archive)</span></span>
      </label>

      <div className="flex gap-2 pt-1">
        <Link href={cancelHref} className="btn-secondary flex-1">Cancel</Link>
        <button type="submit" className="btn-primary flex-1" disabled={pending} aria-busy={pending}>
          {pending ? "Saving…" : submitLabel}
        </button>
      </div>
    </form>
  );
}
