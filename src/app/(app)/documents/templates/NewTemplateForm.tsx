"use client";

import { useActionState, useState } from "react";
import { FormError, FormField } from "@/components/FormField";
import { PlusIcon } from "@/components/icons";
import { createTemplate } from "@/lib/actions/documents";
import { DOCUMENT_KIND_LABEL, DOCUMENT_KINDS } from "@/lib/documents/state";

/** A second template of a kind (e.g. an Arabic version, or one per package). Starts from the starter text of that kind. */
export function NewTemplateForm() {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(createTemplate, null);
  if (!open) return <button type="button" className="btn-secondary min-h-11" onClick={() => setOpen(true)}><PlusIcon size={18} /> New template</button>;
  return (
    <form action={action} className="card space-y-4 p-4" noValidate>
      <p className="font-bold text-ink">New template</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Name" htmlFor="tpl_name" required error={state?.fieldErrors?.name}>
          <input id="tpl_name" name="name" type="text" required maxLength={160} className="input" placeholder="e.g. Event agreement (Arabic)" />
        </FormField>
        <FormField label="Kind" htmlFor="tpl_kind" required error={state?.fieldErrors?.kind}>
          <select id="tpl_kind" name="kind" className="input" defaultValue="custom">
            {DOCUMENT_KINDS.map((k) => (
              <option key={k} value={k}>{DOCUMENT_KIND_LABEL[k]}</option>
            ))}
          </select>
        </FormField>
      </div>
      <FormError message={state?.error} />
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn-primary min-h-11" disabled={pending} aria-busy={pending}>{pending ? "Creating…" : "Create and edit"}</button>
        <button type="button" className="btn-ghost min-h-11" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}
