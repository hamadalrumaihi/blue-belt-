"use client";

import Link from "next/link";
import { useActionState } from "react";
import { FormError, FormField } from "@/components/FormField";
import { importAthletesCsv, type ImportState } from "@/lib/actions/clients";
import { CLIENT_CSV_COLUMNS } from "@/lib/csv";
import type { EventRow } from "@/lib/types";

type Props = { events: EventRow[]; defaultEventId: string | null };

const EXAMPLE = "name,source_url,phone,academy,division\nAli Al-Marri,https://ajptour.com/en/event/1411/bracket/130649,+974 5555 0000,Doha BJJ,Adult / Blue / 77kg";

export function ImportForm({ events, defaultEventId }: Props) {
  const [state, formAction, pending] = useActionState<ImportState, FormData>(importAthletesCsv, null);
  const fe = state?.fieldErrors ?? {};
  const report = state?.report;

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <FormError message={state?.error} />
      {report && (
        <section className="card space-y-2 p-4" role="status" aria-live="polite">
          <p className="text-sm font-extrabold text-ink">Imported {report.inserted} client{report.inserted === 1 ? "" : "s"}.</p>
          {report.skipped.length > 0 && (
            <details>
              <summary className="cursor-pointer text-sm font-semibold text-warning">{report.skipped.length} skipped as duplicates</summary>
              <ul className="mt-1 list-disc pl-5 text-xs text-muted">{report.skipped.map((s) => <li key={s.row}>Row {s.row}: {s.name} — {s.reason}</li>)}</ul>
            </details>
          )}
          {report.errors.length > 0 && (
            <details open>
              <summary className="cursor-pointer text-sm font-semibold text-danger">{report.errors.length} row{report.errors.length === 1 ? "" : "s"} with errors (not imported)</summary>
              <ul className="mt-1 list-disc pl-5 text-xs text-danger">{report.errors.map((e) => <li key={e.row}>Row {e.row}: {e.reason}</li>)}</ul>
            </details>
          )}
          <Link href="/clients" className="btn-secondary mt-2 inline-flex">Go to clients</Link>
        </section>
      )}
      <section className="card space-y-5 p-5">
        <FormField label="Event" htmlFor="event_id" required error={fe.event_id}>
          <select id="event_id" name="event_id" className="input" defaultValue={defaultEventId ?? events[0]?.id ?? ""}>
            {events.map((e) => <option key={e.id} value={e.id}>{e.name}{e.active ? "" : " (archived)"}</option>)}
          </select>
        </FormField>
        <FormField label="CSV file" htmlFor="file" hint="Up to 512 KB / 500 rows">
          <input id="file" name="file" type="file" accept=".csv,text/csv" className="input py-2" />
        </FormField>
        <FormField label="…or paste CSV" htmlFor="csv" error={fe.csv} hint={`Columns: ${CLIENT_CSV_COLUMNS.join(", ")} (only name is required)`}>
          <textarea id="csv" name="csv" className="input min-h-40 py-2.5 font-mono text-xs" rows={8} placeholder={EXAMPLE} />
        </FormField>
        <label className="flex min-h-11 items-center gap-3 rounded-xl border border-line px-3">
          <input type="checkbox" name="allow_duplicate" value="1" className="h-5 w-5 accent-primary" />
          <span className="text-sm font-semibold text-ink">Import duplicates too <span className="font-normal text-muted">(otherwise rows matching an existing name or URL are skipped)</span></span>
        </label>
      </section>
      <div className="flex gap-2">
        <Link href="/clients" className="btn-secondary flex-1">Cancel</Link>
        <button type="submit" className="btn-primary flex-1" disabled={pending} aria-busy={pending}>{pending ? "Importing…" : "Import"}</button>
      </div>
    </form>
  );
}
