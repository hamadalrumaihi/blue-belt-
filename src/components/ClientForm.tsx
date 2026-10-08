"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import type { ActionState } from "@/lib/actions/types";
import { rulesOf } from "@/lib/local-divisions";
import type { AthleteRow, EventRow, Platform } from "@/lib/types";
import { isManualEvent, PLATFORMS } from "@/lib/types";
import { guessPlatform } from "@/lib/watchers/url-policy";
import type { WatchResult } from "@/lib/watchers/types";
import { DivisionFields } from "./DivisionFields";
import { FormError, FormField } from "./FormField";
import { LocalDivisionFields } from "./LocalDivisionFields";
import { watchStateCopy } from "./watchStateCopy";

type Props = {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  events: EventRow[];
  initial?: Partial<AthleteRow> | null;
  defaultEventId?: string | null;
  defaultPlatform?: Platform;
  submitLabel?: string;
  cancelHref?: string;
};

export function ClientForm({ action, events, initial, defaultEventId, defaultPlatform = "AJP", submitLabel = "Save client", cancelHref = "/clients" }: Props) {
  const [state, formAction, pending] = useActionState(action, null);
  const fe = state?.fieldErrors ?? {};
  const [platform, setPlatform] = useState<string>(initial?.platform ?? defaultPlatform);
  const [url, setUrl] = useState(initial?.source_url ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [eventId, setEventId] = useState(initial?.event_id ?? defaultEventId ?? events[0]?.id ?? "");
  const [test, setTest] = useState<{ loading: boolean; result: WatchResult | null; error: string | null }>({ loading: false, result: null, error: null });
  const selectedEvent = events.find((e) => e.id === eventId) ?? null;
  const manual = isManualEvent(selectedEvent);
  const localRules = rulesOf(selectedEvent);

  function onUrlChange(value: string) {
    setUrl(value);
    const guessed = guessPlatform(value);
    if (guessed) setPlatform(guessed);
  }

  async function testLink() {
    setTest({ loading: true, result: null, error: null });
    try {
      // Resolve wall-clock times against the SELECTED event's timezone and
      // date, so a "Test link" preview matches what a real refresh will store.
      const ev = events.find((e) => e.id === eventId);
      const res = await fetch("/api/watch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url, athleteName: name || undefined, timezone: ev?.timezone || undefined, eventDate: ev?.event_date || undefined }),
      });
      const body = (await res.json()) as WatchResult | { error: string };
      if (!res.ok || "error" in body) throw new Error("error" in body ? body.error : "Test failed");
      setTest({ loading: false, result: body, error: null });
    } catch (err) {
      setTest({ loading: false, result: null, error: err instanceof Error ? err.message : "Test failed" });
    }
  }

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <FormError message={state?.error} />

      <section className="card space-y-5 p-5">
        <h2 className="text-sm font-extrabold uppercase tracking-wider text-muted">Client</h2>
        <FormField label="Full name" htmlFor="name" required error={fe.name}>
          <input id="name" name="name" className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required />
        </FormField>
        {state?.duplicate && (
          <label className="flex min-h-11 items-center gap-3 rounded-xl border border-warning/50 bg-amber-50 px-3">
            <input type="checkbox" name="allow_duplicate" value="1" className="h-5 w-5 accent-primary" />
            <span className="text-sm font-semibold text-ink">Add anyway <span className="font-normal text-muted">(this is a different person)</span></span>
          </label>
        )}
        <div className="grid gap-5 sm:grid-cols-2">
          <FormField label="Phone" htmlFor="phone" error={fe.phone} hint="Optional">
            <input id="phone" name="phone" type="tel" inputMode="tel" className="input" defaultValue={initial?.phone ?? ""} autoComplete="tel" placeholder="+974 …" />
          </FormField>
          <FormField label="Email" htmlFor="email" error={fe.email} hint="Optional">
            <input id="email" name="email" type="email" inputMode="email" className="input" defaultValue={initial?.email ?? ""} autoComplete="email" />
          </FormField>
        </div>
        <FormField label="Academy / Team" htmlFor="academy" error={fe.academy} hint="Optional">
          <input id="academy" name="academy" className="input" defaultValue={initial?.academy ?? ""} autoComplete="organization" />
        </FormField>
      </section>

      <section className="card space-y-5 p-5">
        <h2 className="text-sm font-extrabold uppercase tracking-wider text-muted">Tournament</h2>
        <FormField label="Event" htmlFor="event_id" required error={fe.event_id}>
          <select id="event_id" name="event_id" className="input" value={eventId} onChange={(e) => { setEventId(e.target.value); const ev = events.find((x) => x.id === e.target.value); if (ev?.platform === "LOCAL" && !url) setPlatform("LOCAL"); }}>
            {!events.length && <option value="">Create an event first</option>}
            {events.map((e) => (
              <option key={e.id} value={e.id}>{e.name}{e.active ? "" : " (archived)"}{e.tracking_mode === "manual" ? " · tracked by hand" : ""}</option>
            ))}
          </select>
        </FormField>
        {manual && (
          <p className="rounded-xl bg-lightblue px-3 py-2 text-xs font-semibold text-primary">This event is tracked by hand: no page is checked automatically. A link is optional; you enter matches yourself.</p>
        )}
        <FormField label="Player / schedule URL" htmlFor="source_url" required={!manual} error={fe.source_url} hint={manual ? "Optional. A bracket page, if one exists, for your own reference" : "The athlete's AJP or Smoothcomp profile / schedule page"}>
          <input id="source_url" name="source_url" type="url" inputMode="url" className="input" value={url} onChange={(e) => onUrlChange(e.target.value)} placeholder="https://ajptour.com/en/…" autoComplete="off" />
        </FormField>
        <FormField label="Platform" htmlFor="platform" required error={fe.platform}>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Platform">
            {PLATFORMS.map((p) => (
              <label key={p.value} className={`btn cursor-pointer border ${platform === p.value ? "border-primary bg-lightblue text-primary" : "border-line bg-white text-ink"}`}>
                <input type="radio" name="platform" value={p.value} checked={platform === p.value} onChange={() => setPlatform(p.value)} className="sr-only" />
                {p.label}
              </label>
            ))}
          </div>
        </FormField>

        <div className="rounded-xl border border-dashed border-line p-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted">Check that the watcher can read this link before the event.</p>
            <button type="button" className="btn-secondary min-h-9 px-3 text-xs" onClick={testLink} disabled={!url || test.loading || platform === "OTHER" || platform === "LOCAL"}>
              {test.loading ? "Testing…" : "Test link"}
            </button>
          </div>
          {test.error && <p className="mt-2 text-xs font-semibold text-danger">{test.error}</p>}
          {test.result && (
            <p className={`mt-2 text-xs font-semibold ${test.result.status === "OK" ? "text-success" : test.result.status === "NO_MATCHES" ? "text-muted" : "text-warning"}`}>
              {test.result.status === "OK" ? `Found ${test.result.matches.length} match row(s).` : watchStateCopy(test.result.status, test.result.message, test.result.code)}
            </p>
          )}
        </div>
      </section>

      <section className="card space-y-5 p-5">
        {localRules ? (
          <>
            <h2 className="text-sm font-extrabold uppercase tracking-wider text-muted">Division <span className="font-normal normal-case tracking-normal">(this competition’s own age groups and weights)</span></h2>
            <LocalDivisionFields key={selectedEvent?.id} rules={localRules} eventDate={selectedEvent?.event_date ?? null} eventName={selectedEvent?.name} initial={initial} />
          </>
        ) : (
          <>
            <h2 className="text-sm font-extrabold uppercase tracking-wider text-muted">Division <span className="font-normal normal-case tracking-normal">(optional · AJP Qatar National 2026 rules)</span></h2>
            <DivisionFields initial={initial} />
          </>
        )}
        {(fe.birth_date || fe.birth_year || fe.weight_kg) && <p className="text-xs font-semibold text-danger" role="alert">{fe.birth_date ?? fe.birth_year ?? fe.weight_kg}</p>}
      </section>

      <section className="card space-y-5 p-5">
        <h2 className="text-sm font-extrabold uppercase tracking-wider text-muted">Booking <span className="font-normal normal-case tracking-normal">(optional)</span></h2>
        <FormField label="Package name" htmlFor="package_name">
          <input id="package_name" name="package_name" className="input" defaultValue={initial?.package_name ?? ""} placeholder="Full match coverage" />
        </FormField>
        <FormField label="Notes" htmlFor="notes" hint="Visible on the client card">
          <textarea id="notes" name="notes" className="input min-h-20 py-2.5" defaultValue={initial?.notes ?? ""} rows={2} />
        </FormField>
        <FormField label="Internal notes" htmlFor="internal_notes" hint="For you only">
          <textarea id="internal_notes" name="internal_notes" className="input min-h-20 py-2.5" defaultValue={initial?.internal_notes ?? ""} rows={2} />
        </FormField>
        {initial?.id && (
          <label className="flex min-h-11 items-center gap-3 rounded-xl border border-line px-3">
            {/* Sentinel: an unchecked checkbox submits nothing, so this marks the
                control as present and lets the action read "unchecked" as paused. */}
            <input type="hidden" name="active_present" value="1" />
            <input type="checkbox" name="active" className="h-5 w-5 accent-primary" defaultChecked={initial.active ?? true} value="on" />
            <span className="text-sm font-semibold text-ink">Actively tracked <span className="font-normal text-muted">(uncheck to pause refreshes)</span></span>
          </label>
        )}
      </section>

      <div className="flex gap-2">
        <Link href={cancelHref} className="btn-secondary flex-1">Cancel</Link>
        <button type="submit" className="btn-primary flex-1" disabled={pending || !events.length} aria-busy={pending}>
          {pending ? "Saving…" : submitLabel}
        </button>
      </div>
    </form>
  );
}
