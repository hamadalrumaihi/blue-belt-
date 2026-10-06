"use client";

import Link from "next/link";
import { useActionState } from "react";
import { FormError, FormField } from "@/components/FormField";
import type { OrganizationFormState } from "@/lib/actions/organizations";
import { ORGANIZATION_KIND_LABEL, ORGANIZATION_KINDS } from "@/lib/organizations/form";
import type { PhotoOrganizationRow, PhotoPersonRow } from "@/lib/supabase/database.types";

type Props = {
  action: (prev: OrganizationFormState, formData: FormData) => Promise<OrganizationFormState>;
  initial?: PhotoOrganizationRow | null;
  people: Array<Pick<PhotoPersonRow, "id" | "full_name" | "phone" | "email">>;
  submitLabel?: string;
  cancelHref?: string;
};

export function OrganizationForm({ action, initial, people, submitLabel = "Save", cancelHref = "/clubs" }: Props) {
  const [state, formAction, pending] = useActionState(action, null);
  const fe = state?.fieldErrors ?? {};
  return (
    <form action={formAction} className="space-y-4" noValidate>
      <FormError message={state?.error} />
      <section className="card space-y-4 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Name" htmlFor="name" required error={fe.name} className="sm:col-span-2">
            <input id="name" name="name" className="input" defaultValue={initial?.name ?? ""} autoComplete="organization" maxLength={120} required />
          </FormField>
          <FormField label="Type" htmlFor="kind" error={fe.kind}>
            <select id="kind" name="kind" className="input" defaultValue={initial?.kind ?? "club"}>
              {ORGANIZATION_KINDS.map((k) => <option key={k} value={k}>{ORGANIZATION_KIND_LABEL[k]}</option>)}
            </select>
          </FormField>
          <FormField label="Primary contact" htmlFor="primary_contact_id" error={fe.primary_contact_id} hint="A client from your list">
            <select id="primary_contact_id" name="primary_contact_id" className="input" defaultValue={initial?.primary_contact_id ?? ""}>
              <option value="">None</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.full_name}{p.phone ? ` · ${p.phone}` : ""}</option>)}
            </select>
          </FormField>
          <FormField label="Phone" htmlFor="phone" error={fe.phone}>
            <input id="phone" name="phone" className="input" type="tel" inputMode="tel" autoComplete="tel" defaultValue={initial?.phone ?? ""} />
          </FormField>
          <FormField label="Email" htmlFor="email" error={fe.email}>
            <input id="email" name="email" className="input" type="email" inputMode="email" autoComplete="email" defaultValue={initial?.email ?? ""} />
          </FormField>
          <FormField label="Instagram" htmlFor="instagram" error={fe.instagram}>
            <input id="instagram" name="instagram" className="input" defaultValue={initial?.instagram ? `@${initial.instagram}` : ""} placeholder="@club" autoComplete="off" autoCapitalize="none" />
          </FormField>
        </div>
        <FormField label="Notes" htmlFor="notes" error={fe.notes} hint="Internal">
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
