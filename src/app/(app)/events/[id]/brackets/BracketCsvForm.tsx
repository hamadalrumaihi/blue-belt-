"use client";

import Link from "next/link";
import { useActionState } from "react";
import { FormError, FormField } from "@/components/FormField";
import { importBracketCsv, type BracketImportState } from "@/lib/actions/matches";
import { BRACKET_CSV_COLUMNS } from "@/lib/manual-matches";

const EXAMPLE = "athlete,opponent,round,mat,time,status,result,next_round\nKhalid Al-Thani,Yousef Al-Marri,Quarter-final,Mat 2,14:30,scheduled,,\nSara Haddad,,Semi-final,Mat 1,15:10,won,Points 4-2,Final vs winner of #14";

/** Bracket rows from a CSV file or pasted text; each row becomes one hand-entered match. */
export function BracketCsvForm({ eventId }: { eventId: string }) {
  const [state, formAction, pending] = useActionState<BracketImportState, FormData>(importBracketCsv, null);
  const fe = state?.fieldErrors ?? {};
  const report = state?.report;

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <input type="hidden" name="event_id" value={eventId} />
      <FormError message={state?.error} />
      {report && (
        <section className="card space-y-2 p-4" role="status" aria-live="polite">
          <p className="text-sm font-extrabold text-ink">
            Added {report.matchesCreated} match{report.matchesCreated === 1 ? "" : "es"}{report.clientsCreated ? ` and ${report.clientsCreated} new client${report.clientsCreated === 1 ? "" : "s"}` : ""}.
          </p>
          {report.skipped.length > 0 && (
            <details open>
              <summary className="cursor-pointer text-sm font-semibold text-danger">{report.skipped.length} row{report.skipped.length === 1 ? "" : "s"} skipped</summary>
              <ul className="mt-1 list-disc pl-5 text-xs text-danger">{report.skipped.map((s) => <li key={`${s.line}-${s.reason}`}>Row {s.line}: {s.reason}</li>)}</ul>
            </details>
          )}
          <Link href={`/watcher?event=${eventId}`} className="btn-secondary mt-2 inline-flex">Open the watcher</Link>
        </section>
      )}
      <section className="card space-y-5 p-5">
        <FormField label="CSV file" htmlFor="bracket_file" hint="Up to 512 KB / 300 rows">
          <input id="bracket_file" name="file" type="file" accept=".csv,text/csv" className="input py-2" />
        </FormField>
        <FormField label="…or paste CSV" htmlFor="bracket_csv" error={fe.csv} hint={`Columns: ${BRACKET_CSV_COLUMNS.join(", ")} (only athlete is required; time is HH:MM in the event's zone)`}>
          <textarea id="bracket_csv" name="csv" className="input min-h-40 py-2.5 font-mono text-xs" rows={8} placeholder={EXAMPLE} />
        </FormField>
        <label className="flex min-h-11 items-center gap-3 rounded-xl border border-line px-3">
          <input type="checkbox" name="create_missing" value="1" className="h-5 w-5 accent-primary" />
          <span className="text-sm font-semibold text-ink">Add unknown names as new clients <span className="font-normal text-muted">(otherwise rows for names not in this event are skipped)</span></span>
        </label>
      </section>
      <button type="submit" className="btn-primary w-full" disabled={pending} aria-busy={pending}>{pending ? "Importing…" : "Import matches"}</button>
    </form>
  );
}
