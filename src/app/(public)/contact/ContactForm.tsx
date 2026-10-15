"use client";

import Link from "next/link";
import { useActionState } from "react";
import { FormError, FormField } from "@/components/FormField";
import { submitContact, type PublicFormState } from "@/lib/actions/public";
import { HONEYPOT_FIELD, MAX } from "@/lib/bookings/public-form";
import type { Locale } from "@/lib/i18n/locale";
import { tr, UI } from "@/lib/i18n/ui";

export function ContactForm({ locale = "en" }: { locale?: Locale }) {
  const t = tr(locale);
  const [state, formAction, pending] = useActionState<PublicFormState, FormData>(submitContact, null);
  const fe = state?.fieldErrors ?? {};
  return (
    <form action={formAction} className="card relative space-y-5 p-5 sm:p-6" noValidate>
      <FormError message={state?.error} />
      <FormField label={t(UI.contact.form.name)} htmlFor="full_name" required error={fe.full_name}>
        <input id="full_name" name="full_name" className="input" required maxLength={MAX.name} autoComplete="name" aria-invalid={Boolean(fe.full_name)} aria-describedby={fe.full_name ? "full_name-error" : undefined} />
      </FormField>
      <div className="grid gap-5 sm:grid-cols-2">
        <FormField label={t(UI.contact.form.email)} htmlFor="email" required error={fe.email}>
          <input id="email" name="email" type="email" inputMode="email" autoComplete="email" className="input" required maxLength={MAX.email} aria-invalid={Boolean(fe.email)} aria-describedby={fe.email ? "email-error" : undefined} />
        </FormField>
        <FormField label={t(UI.contact.form.phone)} htmlFor="phone" error={fe.phone} hint={t(UI.common.optional)}>
          <input id="phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" className="input" maxLength={MAX.phone} placeholder="+974 …" aria-invalid={Boolean(fe.phone)} aria-describedby={fe.phone ? "phone-error" : undefined} />
        </FormField>
      </div>
      <FormField label={t(UI.contact.form.message)} htmlFor="message" required error={fe.message}>
        <textarea id="message" name="message" className="textarea" required maxLength={MAX.request} placeholder={t(UI.contact.form.messagePlaceholder)} aria-invalid={Boolean(fe.message)} aria-describedby={fe.message ? "message-error" : undefined} />
      </FormField>
      {/* Honeypot: hidden from people, filled by bots; the name matches nothing browsers autofill. */}
      <div className="absolute -start-[9999px] top-0 h-0 w-0 overflow-hidden" aria-hidden>
        <label htmlFor={`f-${HONEYPOT_FIELD}`}>{t(UI.contact.form.honeypot)}</label>
        <input id={`f-${HONEYPOT_FIELD}`} name={HONEYPOT_FIELD} tabIndex={-1} autoComplete="off" />
      </div>
      <div>
        <label className="flex min-h-11 items-start gap-3">
          <input type="checkbox" name="consent" value="1" className="mt-1 size-5 shrink-0 accent-primary" required />
          <span className="text-sm text-ink">
            {t(UI.contact.form.consent)} <Link href="/privacy" className="font-semibold text-primary">{t(UI.contact.form.privacyPolicy)}</Link>.
          </span>
        </label>
        {fe.consent && <p className="mt-1 text-xs font-semibold text-danger" role="alert">{fe.consent}</p>}
      </div>
      <button type="submit" className="btn-primary min-h-12 w-full text-base" disabled={pending} aria-busy={pending}>
        {pending ? t(UI.common.sending) : t(UI.common.sendMessage)}
      </button>
      <p className="sr-only" aria-live="polite">{pending ? t(UI.contact.form.sendingLive) : ""}</p>
    </form>
  );
}
