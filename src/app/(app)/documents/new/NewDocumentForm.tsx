"use client";

import { useActionState, useState } from "react";
import { FormError, FormField } from "@/components/FormField";
import { createDocumentForm } from "@/lib/actions/documents";
import { DOCUMENT_KIND_LABEL, SIGNER_ROLE_LABEL } from "@/lib/documents/state";
import type { BookingChoice, PersonChoice } from "@/lib/documents/queries";
import type { DocumentKind } from "@/lib/supabase/database.types";

type TemplateChoice = { id: string; name: string; kind: DocumentKind; version: number };

/** Releases that do not gate the booking by default; agreements and the guardian release do. */
function defaultRequired(kind: DocumentKind | undefined): boolean {
  return kind !== "print_release" && kind !== "model_release";
}

function bookingChoiceLabel(b: Pick<BookingChoice, "id" | "public_ref" | "athlete_name">): string {
  return `${b.public_ref ?? b.id.slice(0, 8)} · ${b.athlete_name}`;
}

type Props = { templates: TemplateChoice[]; bookings: BookingChoice[]; people: PersonChoice[]; initialBookingId: string | null; initialClientId: string | null };

/**
 * Template + who it is for. Picking a booking fills the client from it; the
 * merge fields are rendered on the server when the draft is created.
 */
export function NewDocumentForm({ templates, bookings, people, initialBookingId, initialClientId }: Props) {
  const [state, action, pending] = useActionState(createDocumentForm, null);
  const [bookingId, setBookingId] = useState(initialBookingId ?? "");
  const booking = bookings.find((b) => b.id === bookingId) ?? null;
  const [clientId, setClientId] = useState(initialClientId ?? booking?.client_id ?? "");
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [signerRole, setSignerRole] = useState<"client" | "guardian">(templates[0]?.kind === "guardian_release" ? "guardian" : "client");
  const [required, setRequired] = useState(defaultRequired(templates[0]?.kind));

  function pickBooking(id: string) {
    setBookingId(id);
    const b = bookings.find((x) => x.id === id);
    if (b?.client_id) setClientId(b.client_id);
  }

  function pickTemplate(id: string) {
    setTemplateId(id);
    const t = templates.find((x) => x.id === id);
    setSignerRole(t?.kind === "guardian_release" ? "guardian" : "client");
    setRequired(defaultRequired(t?.kind));
  }

  const byKind = new Map<DocumentKind, TemplateChoice[]>();
  for (const t of templates) byKind.set(t.kind, [...(byKind.get(t.kind) ?? []), t]);

  return (
    <form action={action} className="card space-y-5 p-5" noValidate>
      <FormField label="Template" htmlFor="template_id" required error={state?.fieldErrors?.template_id}>
        <select id="template_id" name="template_id" required className="input" value={templateId} onChange={(e) => pickTemplate(e.target.value)}>
          {[...byKind.entries()].map(([kind, list]) => (
            <optgroup key={kind} label={DOCUMENT_KIND_LABEL[kind]}>
              {list.map((t) => (
                <option key={t.id} value={t.id}>{t.name} (v{t.version})</option>
              ))}
            </optgroup>
          ))}
        </select>
      </FormField>

      <FormField label="Booking" htmlFor="booking_id" hint="Optional. Fills the athlete, dates, amounts and reference." error={state?.fieldErrors?.booking_id}>
        <select id="booking_id" name="booking_id" className="input" value={bookingId} onChange={(e) => pickBooking(e.target.value)}>
          <option value="">No booking</option>
          {bookings.map((b) => (
            <option key={b.id} value={b.id}>{bookingChoiceLabel(b)} · {b.customer_name}</option>
          ))}
        </select>
      </FormField>

      <FormField label="Client" htmlFor="client_id" hint="Who signs and receives the e-mail. Taken from the booking when it has one." error={state?.fieldErrors?.client_id}>
        <select id="client_id" name="client_id" className="input" value={clientId} onChange={(e) => setClientId(e.target.value)}>
          <option value="">{booking && !booking.client_id ? "Use the booking's contact details" : "No client record"}</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>{p.full_name}{p.email ? ` · ${p.email}` : ""}</option>
          ))}
        </select>
      </FormField>

      <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
        <FormField label="Title" htmlFor="title" hint="Optional. Defaults to the template name and the client.">
          <input id="title" name="title" type="text" maxLength={160} className="input" placeholder="e.g. Event coverage: Ahmed, Doha Open" />
        </FormField>
        <FormField label="Valid for (days)" htmlFor="expires_days" hint="After sending.">
          <input id="expires_days" name="expires_days" type="number" inputMode="numeric" min={1} max={90} defaultValue={14} className="input" />
        </FormField>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Who signs" htmlFor="signer_role" hint="A guardian document goes to the parent or guardian on the booking, never to the athlete." error={state?.fieldErrors?.signer_role}>
          <select id="signer_role" name="signer_role" className="input" value={signerRole} onChange={(e) => setSignerRole(e.target.value as "client" | "guardian")}>
            <option value="client">{SIGNER_ROLE_LABEL.client}</option>
            <option value="guardian">{SIGNER_ROLE_LABEL.guardian}</option>
          </select>
        </FormField>
        <div className="min-w-0">
          <span className="label">Confirmation</span>
          <label htmlFor="required_for_confirmation" className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-line bg-page px-3 text-sm text-ink">
            <input id="required_for_confirmation" name="required_for_confirmation" type="checkbox" className="h-5 w-5 accent-primary" checked={required} onChange={(e) => setRequired(e.target.checked)} />
            <span>Must be signed before the booking is confirmed</span>
          </label>
        </div>
      </div>

      <FormError message={state?.error} />
      <button type="submit" className="btn-primary min-h-12 w-full sm:w-auto" disabled={pending} aria-busy={pending}>
        {pending ? "Creating…" : "Create draft"}
      </button>
      <p className="text-xs text-muted">You can still edit the text before sending. Nothing is sent to the client until you press Send on the next screen.</p>
    </form>
  );
}
