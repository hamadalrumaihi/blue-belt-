"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import type { ActionState } from "@/lib/actions/types";
import { rulesOf } from "@/lib/local-divisions";
import type { EventRow, TrackingMode } from "@/lib/types";
import { PLATFORMS } from "@/lib/types";
import { cn } from "@/lib/utils";
import { DivisionRulesEditor } from "./DivisionRulesEditor";
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
  const [platform, setPlatform] = useState<string>(initial?.platform ?? defaultPlatform);
  // A local competition is tracked by hand unless the owner says otherwise.
  const [mode, setMode] = useState<TrackingMode>(initial?.tracking_mode ?? (platform === "LOCAL" ? "manual" : "watcher"));
  const [ownDivisions, setOwnDivisions] = useState<boolean>(Boolean(initial?.division_rules) || platform === "LOCAL");
  const localRules = rulesOf(initial ? { platform: initial.platform, division_rules: initial.division_rules } : null);

  function onPlatform(next: string) {
    setPlatform(next);
    if (next === "LOCAL") {
      if (!initial?.id) setMode("manual");
      setOwnDivisions(true);
    }
  }

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
          <select id="platform" name="platform" className="input" value={platform} onChange={(e) => onPlatform(e.target.value)}>
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

      <fieldset>
        <legend className="label">How are brackets followed?</legend>
        <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Tracking mode">
          {([
            { value: "watcher", title: "Watch a public bracket page", body: "AJP / Smoothcomp pages are checked automatically. Each client needs their bracket or profile URL." },
            { value: "manual", title: "Track by hand", body: "No usable public URL, or brackets shared privately. You enter athletes and matches; nothing is checked automatically." },
          ] as const).map((o) => (
            <label key={o.value} className={cn("flex cursor-pointer gap-3 rounded-xl border p-3", mode === o.value ? "border-primary bg-lightblue" : "border-line bg-white")}>
              <input type="radio" name="tracking_mode" value={o.value} checked={mode === o.value} onChange={() => setMode(o.value)} className="mt-1 h-4 w-4 accent-primary" />
              <span className="min-w-0">
                <span className="block text-sm font-bold text-ink">{o.title}</span>
                <span className="block text-xs text-muted">{o.body}</span>
              </span>
            </label>
          ))}
        </div>
        {fe.tracking_mode && <p className="mt-1 text-xs font-semibold text-danger" role="alert">{fe.tracking_mode}</p>}
      </fieldset>

      <FormField label="Official event URL" htmlFor="source_url" error={fe.source_url} hint={mode === "manual" ? "Optional. Private or missing brackets are fine. The event is tracked by hand." : "The AJP / Smoothcomp event page (optional)"}>
        <input id="source_url" name="source_url" type="url" inputMode="url" className="input" defaultValue={initial?.source_url ?? ""} placeholder="https://ajptour.com/en/event/…" />
      </FormField>

      <div className="space-y-3 rounded-xl border border-line p-3">
        <label className="flex min-h-11 items-center gap-3">
          <input type="checkbox" name="own_divisions" value="1" className="h-5 w-5 accent-primary" checked={ownDivisions} onChange={(e) => setOwnDivisions(e.target.checked)} />
          <span className="text-sm font-semibold text-ink">
            This competition uses its own age groups and weight divisions
            <span className="block text-xs font-normal text-muted">{ownDivisions ? "Clients are checked against the chart below, not AJP rules." : "Off: clients use the AJP Qatar National tables."}</span>
          </span>
        </label>
        {ownDivisions && <DivisionRulesEditor initial={localRules} error={fe.division_rules} />}
      </div>

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
