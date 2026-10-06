"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { FormError, FormField } from "@/components/FormField";
import { PlatformBadge } from "@/components/PlatformBadge";
import { createAthleteQuick } from "@/lib/actions/clients";
import { isManualEvent, type EventRow } from "@/lib/types";
import { guessPlatform } from "@/lib/watchers/url-policy";

type Props = { events: EventRow[]; defaultEventId: string | null };

/** Name + event + source URL: enough for the watcher to start tracking. */
export function QuickClientForm({ events, defaultEventId }: Props) {
  const [state, formAction, pending] = useActionState(createAthleteQuick, null);
  const fe = state?.fieldErrors ?? {};
  const [url, setUrl] = useState("");
  const [eventId, setEventId] = useState(defaultEventId ?? events[0]?.id ?? "");
  const platform = guessPlatform(url);
  const manual = isManualEvent(events.find((e) => e.id === eventId));

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <FormError message={state?.error} />
      <section className="card space-y-5 p-5">
        <FormField label="Full name" htmlFor="name" required error={fe.name}>
          <input id="name" name="name" className="input" autoComplete="name" required autoFocus />
        </FormField>
        {state?.duplicate && (
          <label className="flex min-h-11 items-center gap-3 rounded-xl border border-warning/50 bg-amber-50 px-3">
            <input type="checkbox" name="allow_duplicate" value="1" className="h-5 w-5 accent-primary" />
            <span className="text-sm font-semibold text-ink">Add anyway <span className="font-normal text-muted">(this is a different person)</span></span>
          </label>
        )}
        <FormField label="Event" htmlFor="event_id" required error={fe.event_id}>
          <select id="event_id" name="event_id" className="input" value={eventId} onChange={(e) => setEventId(e.target.value)}>
            {events.map((e) => <option key={e.id} value={e.id}>{e.name}{e.active ? "" : " (archived)"}{e.tracking_mode === "manual" ? " · tracked by hand" : ""}</option>)}
          </select>
        </FormField>
        <FormField label="Player / schedule URL" htmlFor="source_url" required={!manual} error={fe.source_url} hint={manual ? "Optional for this event — it is tracked by hand" : "AJP or Smoothcomp link; the platform is detected from it"}>
          <div className="flex items-center gap-2">
            <input id="source_url" name="source_url" type="url" inputMode="url" className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://ajptour.com/en/…" autoComplete="off" />
            {platform && <PlatformBadge platform={platform} />}
          </div>
        </FormField>
        <FormField label="Phone" htmlFor="phone" hint="Optional">
          <input id="phone" name="phone" type="tel" inputMode="tel" className="input" autoComplete="tel" placeholder="+974 …" />
        </FormField>
      </section>
      <div className="flex gap-2">
        <Link href="/clients" className="btn-secondary flex-1">Cancel</Link>
        <button type="submit" className="btn-primary flex-1" disabled={pending} aria-busy={pending}>{pending ? "Adding…" : "Add client"}</button>
      </div>
      <p className="text-center text-xs text-muted">Need every field? <Link href="/clients/new" className="font-semibold text-primary">Use the full form</Link> · <Link href="/clients/import" className="font-semibold text-primary">Import CSV</Link></p>
    </form>
  );
}
