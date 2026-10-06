"use client";

import Link from "next/link";
import { useActionState } from "react";
import { FormError, FormField } from "@/components/FormField";
import { submitContact, type PublicFormState } from "@/lib/actions/public";
import { MAX } from "@/lib/bookings/public-form";

export function ContactForm() {
  const [state, formAction, pending] = useActionState<PublicFormState, FormData>(submitContact, null);
  const fe = state?.fieldErrors ?? {};
  return (
    <form action={formAction} className="card relative space-y-5 p-5 sm:p-6" noValidate>
      <FormError message={state?.error ?? fe.website} />
      <FormField label="Your name" htmlFor="full_name" required error={fe.full_name}>
        <input id="full_name" name="full_name" className="input" required maxLength={MAX.name} autoComplete="name" aria-invalid={Boolean(fe.full_name)} aria-describedby={fe.full_name ? "full_name-error" : undefined} />
      </FormField>
      <div className="grid gap-5 sm:grid-cols-2">
        <FormField label="E-mail" htmlFor="email" required error={fe.email}>
          <input id="email" name="email" type="email" inputMode="email" autoComplete="email" className="input" required maxLength={MAX.email} aria-invalid={Boolean(fe.email)} aria-describedby={fe.email ? "email-error" : undefined} />
        </FormField>
        <FormField label="Phone / WhatsApp" htmlFor="phone" error={fe.phone} hint="Optional">
          <input id="phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" className="input" maxLength={MAX.phone} placeholder="+974 …" aria-invalid={Boolean(fe.phone)} aria-describedby={fe.phone ? "phone-error" : undefined} />
        </FormField>
      </div>
      <FormField label="How can we help?" htmlFor="message" required error={fe.message}>
        <textarea id="message" name="message" className="input min-h-36 py-3" required maxLength={MAX.request} placeholder="The event or session, dates, and what you would like covered." aria-invalid={Boolean(fe.message)} aria-describedby={fe.message ? "message-error" : undefined} />
      </FormField>
      {/* Honeypot: hidden from people, filled by bots. */}
      <div className="absolute -left-[9999px] top-0 h-0 w-0 overflow-hidden" aria-hidden>
        <label htmlFor="website">Website</label>
        <input id="website" name="website" tabIndex={-1} autoComplete="off" />
      </div>
      <div>
        <label className="flex min-h-11 items-start gap-3">
          <input type="checkbox" name="consent" value="1" className="mt-1 h-5 w-5 shrink-0 accent-primary" required />
          <span className="text-sm text-ink">
            I agree to be contacted about this message. See the <Link href="/privacy" className="font-semibold text-primary">privacy note</Link>.
          </span>
        </label>
        {fe.consent && <p className="mt-1 text-xs font-semibold text-danger" role="alert">{fe.consent}</p>}
      </div>
      <button type="submit" className="btn-primary min-h-12 w-full text-base" disabled={pending} aria-busy={pending}>
        {pending ? "Sending…" : "Send message"}
      </button>
      <p className="sr-only" aria-live="polite">{pending ? "Sending your message" : ""}</p>
    </form>
  );
}
