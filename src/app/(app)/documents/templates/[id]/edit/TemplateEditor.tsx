"use client";

import { useActionState, useMemo, useRef, useState } from "react";
import { FormError, FormField } from "@/components/FormField";
import { CheckIcon } from "@/components/icons";
import { updateTemplate } from "@/lib/actions/documents";
import { MERGE_FIELDS, templateFields, type MergeField } from "@/lib/documents/state";
import { cn } from "@/lib/utils";

const FIELD_HELP: Record<MergeField, string> = {
  client_name: "Client's full name",
  client_email: "Client's e-mail",
  client_phone: "Client's phone",
  guardian_name: "Parent or guardian of a minor",
  athlete_name: "Athlete on the booking",
  organization_name: "Club / academy",
  business_name: "Your studio name",
  service_name: "Package / service",
  event_name: "Tournament name",
  event_date: "Tournament date",
  session_date: "Session date & time",
  location: "Venue / place",
  amount: "Booking amount (QAR)",
  deposit: "50% deposit (QAR)",
  balance: "50% balance after delivery (QAR)",
  booking_ref: "Booking reference",
  today: "Date the document is created",
};

type Props = { templateId: string; initialName: string; initialBody: string; version: number; kindLabel: string };

/**
 * Template text with merge-field chips. Tapping a chip inserts {{field}} at
 * the caret; the checklist shows which fields the text uses so the owner
 * can see at a glance what will be filled in. Saving bumps the version.
 */
export function TemplateEditor({ templateId, initialName, initialBody, version, kindLabel }: Props) {
  const action = updateTemplate.bind(null, templateId);
  const [state, formAction, pending] = useActionState(action, null);
  const [body, setBody] = useState(initialBody);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const used = useMemo(() => new Set(templateFields(body)), [body]);
  const words = useMemo(() => body.trim().split(/\s+/).filter(Boolean).length, [body]);

  function insert(field: MergeField) {
    const el = areaRef.current;
    const tag = `{{${field}}}`;
    if (!el) {
      setBody((b) => `${b}${tag}`);
      return;
    }
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? start;
    const next = `${body.slice(0, start)}${tag}${body.slice(end)}`;
    setBody(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + tag.length, start + tag.length);
    });
  }

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <div className="card space-y-4 p-4">
        <FormField label="Template name" htmlFor="name" required error={state?.fieldErrors?.name} hint={`${kindLabel} · version ${version}. Saving a change makes version ${version + 1}; documents already created keep the text they were made from.`}>
          <input id="name" name="name" type="text" required maxLength={160} defaultValue={initialName} className="input" />
        </FormField>

        <div>
          <p className="label">Insert a merge field</p>
          <div className="flex flex-wrap gap-1.5">
            {MERGE_FIELDS.map((f) => (
              <button key={f} type="button" onClick={() => insert(f)} className={cn("inline-flex min-h-9 items-center gap-1 rounded-full border px-3 text-xs font-semibold", used.has(f) ? "border-primary/30 bg-lightblue text-primary" : "border-line bg-white text-ink hover:bg-page")} title={FIELD_HELP[f]}>
                {used.has(f) && <CheckIcon size={12} />}
                {`{{${f}}}`}
              </button>
            ))}
          </div>
          <p className="hint">Highlighted fields are already used in the text. Fields with no value show as a blank line in the document.</p>
        </div>

        <FormField label="Template text" htmlFor="body" required error={state?.fieldErrors?.body} hint={`${words} words. Plain text; blank lines separate paragraphs.`}>
          <textarea ref={areaRef} id="body" name="body" required value={body} onChange={(e) => setBody(e.target.value)} rows={30} className="input min-h-[60vh] py-3 font-mono text-sm leading-6" spellCheck />
        </FormField>
      </div>

      <div className="card p-4">
        <p className="eyebrow">Fields used</p>
        <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
          {MERGE_FIELDS.map((f) => (
            <li key={f} className={cn("flex items-center gap-2", used.has(f) ? "text-ink" : "text-muted/70")}>
              <span className={cn("inline-flex h-4 w-4 items-center justify-center rounded-full border", used.has(f) ? "border-success bg-success-soft text-success" : "border-line")}>{used.has(f) && <CheckIcon size={10} />}</span>
              <span className="font-mono text-xs">{f}</span>
              <span className="text-xs">{FIELD_HELP[f]}</span>
            </li>
          ))}
        </ul>
      </div>

      <FormError message={state?.error} />
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn-primary min-h-12" disabled={pending} aria-busy={pending}>{pending ? "Saving…" : `Save as version ${version + 1}`}</button>
      </div>
    </form>
  );
}
