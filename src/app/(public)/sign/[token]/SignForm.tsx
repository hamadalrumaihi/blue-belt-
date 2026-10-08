"use client";

import { useActionState, useState } from "react";
import { FormError, FormField } from "@/components/FormField";
import { CheckIcon } from "@/components/icons";
import { declineByToken, signByToken } from "@/lib/actions/sign";

type Props = {
  token: string;
  studioName: string;
  documentId: string;
  prefill: { name: string | null; email: string | null; phone: string | null };
  signer: { role: "client" | "guardian"; athleteName: string | null; guardianName: string | null };
};

/**
 * Typed-name e-signature. Everything the signer needs is on one screen:
 * name, optional contact details (prefilled when we know them), one
 * agreement checkbox and a large Sign button. The guardian variant says who
 * the person is signing for. Decline is deliberately quieter and asks for a
 * reason the studio will see.
 */
export function SignForm({ token, studioName, documentId, prefill, signer }: Props) {
  const [state, action, pending] = useActionState(signByToken, null);
  const [declineState, declineAction, declining] = useActionState(declineByToken, null);
  const [showDecline, setShowDecline] = useState(false);
  const guardian = signer.role === "guardian";
  const athlete = signer.athleteName ?? "the athlete";

  if (state?.signed) {
    return (
      <section className="card mt-6 p-6 text-center" role="status" aria-live="polite">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-success-soft text-success"><CheckIcon /></div>
        <h2 className="mt-3 text-xl font-extrabold text-ink">Signed</h2>
        <p className="mt-1 text-sm text-muted">Thank you. {studioName} has been notified and a copy is being e-mailed to you.</p>
        <a href={`/api/documents/${documentId}/pdf?token=${encodeURIComponent(token)}`} className="btn-primary mt-5 min-h-12 w-full sm:w-auto">Download PDF copy</a>
      </section>
    );
  }
  if (declineState?.declined) {
    return (
      <section className="card mt-6 p-6 text-center" role="status" aria-live="polite">
        <h2 className="text-xl font-extrabold text-ink">Declined</h2>
        <p className="mt-1 text-sm text-muted">{studioName} has been told. They will be in touch if there is anything to change.</p>
      </section>
    );
  }

  return (
    <>
      <form action={action} className="card mt-6 p-5 sm:p-6" noValidate>
        <input type="hidden" name="token" value={token} />
        <h2 className="text-lg font-extrabold text-ink">{guardian ? "Sign as parent or guardian" : "Sign this agreement"}</h2>
        <p className="mt-1 text-sm text-muted">
          {guardian ? `You are signing as the parent or guardian of ${athlete}. Type your own full name, not the athlete's.` : "Typing your name here is your signature. Use the name you would write on paper."}
        </p>
        <div className="mt-5 space-y-4">
          <FormField label="Type your full name to sign" htmlFor="signer_name" required error={state?.fieldErrors?.signer_name} hint={guardian && signer.guardianName ? `Addressed to ${signer.guardianName}.` : undefined}>
            <input id="signer_name" name="signer_name" type="text" autoComplete="name" required maxLength={120} defaultValue={prefill.name ?? ""} className="input min-h-12 text-lg" placeholder="Your full name" aria-describedby={state?.fieldErrors?.signer_name ? "signer_name-error" : undefined} />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="E-mail (for your copy)" htmlFor="signer_email" error={state?.fieldErrors?.signer_email}>
              <input id="signer_email" name="signer_email" type="email" inputMode="email" autoComplete="email" maxLength={160} defaultValue={prefill.email ?? ""} className="input min-h-12" />
            </FormField>
            <FormField label="Phone (optional)" htmlFor="signer_phone">
              <input id="signer_phone" name="signer_phone" type="tel" inputMode="tel" autoComplete="tel" maxLength={40} defaultValue={prefill.phone ?? ""} className="input min-h-12" />
            </FormField>
          </div>
          <div>
            <label htmlFor="agreed" className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-line bg-page p-3 text-sm text-ink">
              <input id="agreed" name="agreed" type="checkbox" required className="mt-0.5 h-5 w-5 shrink-0 accent-primary" aria-describedby={state?.fieldErrors?.agreed ? "agreed-error" : undefined} />
              <span>{guardian ? `I have read this release, I am the parent or guardian of ${athlete}, and I agree to sign it electronically.` : "I have read this agreement and I agree to sign it electronically."}</span>
            </label>
            {state?.fieldErrors?.agreed && <p id="agreed-error" className="mt-1 text-xs font-semibold text-danger" role="alert">{state.fieldErrors.agreed}</p>}
          </div>
          <FormError message={state?.error} />
          <button type="submit" className="btn-primary min-h-14 w-full text-base" disabled={pending} aria-busy={pending}>
            {pending ? "Signing..." : guardian ? "Sign as parent or guardian" : "Sign agreement"}
          </button>
          <p className="text-xs text-muted">Your typed name, the time, and your device&apos;s network address are recorded as evidence of signing. This is intended to be an electronic signature under Qatar law.</p>
        </div>
      </form>

      <div className="mt-4 text-center">
        {!showDecline ? (
          <button type="button" className="btn-ghost min-h-11 text-sm text-muted" onClick={() => setShowDecline(true)}>I do not want to sign this</button>
        ) : (
          <form action={declineAction} className="card mt-2 p-5 text-left" noValidate>
            <input type="hidden" name="token" value={token} />
            <h3 className="font-bold text-ink">Decline this agreement</h3>
            <p className="mt-1 text-sm text-muted">Tell {studioName} what is wrong so they can fix it and send a new version.</p>
            <FormField label="Reason (optional)" htmlFor="reason" className="mt-3">
              <textarea id="reason" name="reason" rows={3} maxLength={500} className="input min-h-24 py-2" placeholder="e.g. the date is wrong" />
            </FormField>
            <FormError message={declineState?.error} />
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="submit" className="btn-danger-outline min-h-11" disabled={declining} aria-busy={declining}>{declining ? "Sending..." : "Decline"}</button>
              <button type="button" className="btn-ghost min-h-11" onClick={() => setShowDecline(false)}>Back to signing</button>
            </div>
          </form>
        )}
      </div>
    </>
  );
}
