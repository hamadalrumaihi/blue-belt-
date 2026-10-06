"use client";

import { useActionState } from "react";
import { FormError, FormField } from "@/components/FormField";
import { MailIcon } from "@/components/icons";
import { requestClientMagicLink } from "@/lib/actions/client-auth";

/** E-mail only: the link in the inbox is the password. */
export function ClientLoginForm({ linkError }: { linkError: boolean }) {
  const [state, action, pending] = useActionState(requestClientMagicLink, null);
  if (state?.sent) {
    return (
      <section className="card p-6 text-center" role="status" aria-live="polite">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-lightblue text-primary"><MailIcon /></div>
        <h1 className="mt-3 text-xl font-extrabold text-ink">Check your inbox</h1>
        <p className="mt-2 text-sm text-muted">If that address has bookings with us, a sign-in link is on its way. It works once and expires after a short while.</p>
      </section>
    );
  }
  return (
    <form action={action} className="card p-6" noValidate>
      <h1 className="text-xl font-extrabold text-ink">Your bookings</h1>
      <p className="mt-1 text-sm text-muted">Enter the e-mail address you booked with and we will send you a sign-in link. No password needed.</p>
      {linkError && <p className="mt-4 rounded-xl border border-danger/30 bg-danger-soft px-3 py-2 text-sm font-semibold text-danger" role="alert">That sign-in link is invalid or has expired. Request a new one below.</p>}
      <FormField label="E-mail" htmlFor="email" required className="mt-5" error={state?.fieldErrors?.email}>
        <input id="email" name="email" type="email" inputMode="email" autoComplete="email" required maxLength={160} className="input" placeholder="you@example.com" />
      </FormField>
      <div className="mt-4"><FormError message={state?.error} /></div>
      <button type="submit" className="btn-primary mt-5 min-h-12 w-full" disabled={pending} aria-busy={pending}>{pending ? "Sending…" : "Send me a sign-in link"}</button>
    </form>
  );
}
