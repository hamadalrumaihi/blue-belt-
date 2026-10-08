"use client";

import Link from "next/link";
import { useActionState } from "react";
import { FormError, FormField } from "@/components/FormField";
import type { PersonFormState } from "@/lib/actions/people";
import { PERSON_KIND_LABEL, PERSON_KINDS } from "@/lib/people/form";
import type { PhotoPersonRow } from "@/lib/supabase/database.types";

type Props = {
  action: (prev: PersonFormState, formData: FormData) => Promise<PersonFormState>;
  initial?: PhotoPersonRow | null;
  submitLabel?: string;
  cancelHref?: string;
};

export function PersonForm({ action, initial, submitLabel = "Save client", cancelHref = "/people" }: Props) {
  const [state, formAction, pending] = useActionState(action, null);
  const fe = state?.fieldErrors ?? {};
  return (
    <form action={formAction} className="space-y-4" noValidate>
      <FormError message={state?.error} />
      <section className="card space-y-4 p-5">
        <FormField label="Full name" htmlFor="full_name" required error={fe.full_name}>
          <input id="full_name" name="full_name" className="input" defaultValue={initial?.full_name ?? ""} autoComplete="name" maxLength={120} required />
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Phone" htmlFor="phone" error={fe.phone} hint="Used to recognise returning clients">
            <input id="phone" name="phone" className="input" type="tel" inputMode="tel" autoComplete="tel" defaultValue={initial?.phone ?? ""} placeholder="+974 …" />
          </FormField>
          <FormField label="WhatsApp" htmlFor="whatsapp" error={fe.whatsapp} hint="Only if different from the phone">
            <input id="whatsapp" name="whatsapp" className="input" type="tel" inputMode="tel" defaultValue={initial?.whatsapp ?? ""} />
          </FormField>
          <FormField label="Email" htmlFor="email" error={fe.email}>
            <input id="email" name="email" className="input" type="email" inputMode="email" autoComplete="email" defaultValue={initial?.email ?? ""} />
          </FormField>
          <FormField label="Instagram" htmlFor="instagram" error={fe.instagram}>
            <input id="instagram" name="instagram" className="input" defaultValue={initial?.instagram ? `@${initial.instagram}` : ""} placeholder="@handle" autoComplete="off" autoCapitalize="none" />
          </FormField>
          <FormField label="Type" htmlFor="kind" error={fe.kind}>
            <select id="kind" name="kind" className="input" defaultValue={initial?.kind ?? "person"}>
              {PERSON_KINDS.map((k) => <option key={k} value={k}>{PERSON_KIND_LABEL[k]}</option>)}
            </select>
          </FormField>
          <FormField label="Tags" htmlFor="tags" error={fe.tags} hint="Comma separated, e.g. vip, parent">
            <input id="tags" name="tags" className="input" defaultValue={initial?.tags?.join(", ") ?? ""} autoComplete="off" />
          </FormField>
        </div>
        <FormField label="Notes" htmlFor="notes" error={fe.notes} hint="Internal, never shown to the client">
          <textarea id="notes" name="notes" className="input min-h-24 py-2" rows={3} maxLength={2000} defaultValue={initial?.notes ?? ""} />
        </FormField>
      </section>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Link href={cancelHref} className="btn-secondary">Cancel</Link>
        <button type="submit" className="btn-primary" disabled={pending} aria-busy={pending}>{pending ? "Saving…" : submitLabel}</button>
      </div>
    </form>
  );
}
