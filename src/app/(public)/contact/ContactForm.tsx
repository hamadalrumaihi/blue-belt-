"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { FormError, FormField } from "@/components/FormField";
import { submitInquiry, type PublicFormState } from "@/lib/actions/public";
import { HONEYPOT_FIELD, INQUIRY_MAX } from "@/lib/inquiries/form";
import { INQUIRY_CATEGORIES, INQUIRY_CATEGORY_LABEL, REFERENCE_CATEGORIES } from "@/lib/inquiries/labels";
import { localized, type Locale } from "@/lib/i18n/locale";
import { tr, UI } from "@/lib/i18n/ui";
import type { InquiryCategory } from "@/lib/supabase/database.types";

type Props = {
  locale?: Locale;
  /** Category preselected from the link that brought the visitor here (`?type=`). */
  initialCategory?: InquiryCategory | null;
  /** The page the visitor came from (`?from=`), recorded with the inquiry. */
  sourcePage?: string | null;
};

function uuidV4(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * The Contact & Inquiries form: name, e-mail, inquiry type, an optional
 * booking / order / gallery reference (shown by default for the categories
 * that usually carry one, one tap away for the rest), subject, message,
 * honeypot and consent. Every value survives a server-side validation
 * round trip because the inputs are uncontrolled and the page re-renders
 * with the same props; the idempotency key is generated once per mount.
 */
export function ContactForm({ locale = "en", initialCategory = null, sourcePage = null }: Props) {
  const t = tr(locale);
  const [state, formAction, pending] = useActionState<PublicFormState, FormData>(submitInquiry, null);
  const [category, setCategory] = useState<InquiryCategory | "">(initialCategory ?? "");
  const [showReference, setShowReference] = useState(Boolean(initialCategory && REFERENCE_CATEGORIES.includes(initialCategory)));
  const [idempotencyKey] = useState(() => uuidV4());
  const fe = state?.fieldErrors ?? {};
  const referenceVisible = showReference || (category !== "" && REFERENCE_CATEGORIES.includes(category)) || Boolean(fe.booking_reference);

  return (
    <form action={formAction} className="card relative space-y-5 p-5 sm:p-6" noValidate aria-describedby="inquiry-intro">
      <p id="inquiry-intro" className="sr-only">{t(UI.contact.lead)}</p>
      <FormError message={state?.error} />
      <input type="hidden" name="idempotency_key" value={idempotencyKey} />
      {sourcePage && <input type="hidden" name="source_page" value={sourcePage} />}
      <div className="grid gap-5 sm:grid-cols-2">
        <FormField label={t(UI.contact.form.name)} htmlFor="full_name" required error={fe.full_name}>
          <input id="full_name" name="full_name" className="input" required maxLength={INQUIRY_MAX.name} autoComplete="name" dir="auto" aria-invalid={Boolean(fe.full_name)} aria-describedby={fe.full_name ? "full_name-error" : undefined} />
        </FormField>
        <FormField label={t(UI.contact.form.email)} htmlFor="email" required error={fe.email}>
          <input id="email" name="email" type="email" inputMode="email" autoComplete="email" className="input" required maxLength={INQUIRY_MAX.email} dir="ltr" aria-invalid={Boolean(fe.email)} aria-describedby={fe.email ? "email-error" : undefined} />
        </FormField>
      </div>
      <FormField label={t(UI.contact.form.type)} htmlFor="category" required error={fe.category}>
        <div className="relative">
          <select id="category" name="category" className="select" required value={category} onChange={(e) => setCategory(e.target.value as InquiryCategory | "")} aria-invalid={Boolean(fe.category)} aria-describedby={fe.category ? "category-error" : undefined}>
            <option value="" disabled>{t(UI.contact.form.typePlaceholder)}</option>
            {INQUIRY_CATEGORIES.map((c) => (
              <option key={c} value={c}>{localized(INQUIRY_CATEGORY_LABEL[c], locale)}</option>
            ))}
          </select>
          <svg aria-hidden viewBox="0 0 24 24" width="18" height="18" className="pointer-events-none absolute end-3.5 top-1/2 -translate-y-1/2 text-muted" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
        </div>
      </FormField>
      {referenceVisible ? (
        <FormField label={t(UI.contact.form.reference)} htmlFor="booking_reference" error={fe.booking_reference} hint={t(UI.contact.form.referenceHint)}>
          <input id="booking_reference" name="booking_reference" className="input font-mono uppercase" maxLength={INQUIRY_MAX.reference} placeholder="BB-" dir="ltr" autoComplete="off" aria-invalid={Boolean(fe.booking_reference)} aria-describedby={fe.booking_reference ? "booking_reference-error" : undefined} />
        </FormField>
      ) : (
        <button type="button" className="inline-flex min-h-10 items-center text-sm font-semibold text-primary" onClick={() => setShowReference(true)}>
          + {t(UI.contact.form.referenceToggle)}
        </button>
      )}
      <FormField label={t(UI.contact.form.subject)} htmlFor="subject" required error={fe.subject}>
        <input id="subject" name="subject" className="input" required maxLength={INQUIRY_MAX.subject} placeholder={t(UI.contact.form.subjectPlaceholder)} dir="auto" aria-invalid={Boolean(fe.subject)} aria-describedby={fe.subject ? "subject-error" : undefined} />
      </FormField>
      <FormField label={t(UI.contact.form.message)} htmlFor="message" required error={fe.message}>
        <textarea id="message" name="message" className="textarea" required maxLength={INQUIRY_MAX.message} placeholder={t(UI.contact.form.messagePlaceholder)} dir="auto" aria-invalid={Boolean(fe.message)} aria-describedby={fe.message ? "message-error" : undefined} />
      </FormField>
      {/* Honeypot: hidden from people, filled by bots; the name matches nothing browsers autofill. */}
      <div className="absolute -start-[9999px] top-0 h-0 w-0 overflow-hidden" aria-hidden>
        <label htmlFor={`f-${HONEYPOT_FIELD}`}>{t(UI.contact.form.honeypot)}</label>
        <input id={`f-${HONEYPOT_FIELD}`} name={HONEYPOT_FIELD} tabIndex={-1} autoComplete="off" />
      </div>
      <div>
        <label className="flex min-h-11 items-start gap-3">
          <input type="checkbox" name="consent" value="1" className="mt-1 size-5 shrink-0 accent-primary" required aria-invalid={Boolean(fe.consent)} />
          <span className="text-sm text-ink">
            {t(UI.contact.form.consent)} <Link href="/privacy" className="font-semibold text-primary">{t(UI.contact.form.privacyPolicy)}</Link>.
          </span>
        </label>
        {fe.consent && <p className="mt-1 text-xs font-semibold text-danger" role="alert">{fe.consent}</p>}
      </div>
      <button type="submit" className="btn-primary min-h-12 w-full text-base" disabled={pending} aria-busy={pending} data-umami-event="inquiry-submit" data-umami-event-category={category || "unset"}>
        {pending ? t(UI.common.sending) : t(UI.contact.form.submit)}
      </button>
      <p className="sr-only" aria-live="polite">{pending ? t(UI.contact.form.sendingLive) : ""}</p>
    </form>
  );
}
