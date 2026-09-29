"use client";

import Link from "next/link";
import { useActionState } from "react";
import { requestPasswordReset } from "@/lib/actions/auth";

export default function ForgotPasswordPage() {
  const [state, action, pending] = useActionState(requestPasswordReset, null);
  return (
    <form action={action} className="rounded-card bg-white p-6 text-ink shadow-hero" noValidate>
      <h2 className="text-xl font-extrabold">Reset password</h2>
      <p className="mt-1 text-sm text-muted">We will email you a link to choose a new password.</p>

      {state?.error && <p className="mt-4 rounded-xl border border-danger/30 bg-danger-soft px-3 py-2 text-sm font-semibold text-danger" role="alert">{state.error}</p>}
      {state?.success && <p className="mt-4 rounded-xl border border-success/30 bg-success-soft px-3 py-2 text-sm font-semibold text-success" role="status">{state.success}</p>}

      <label htmlFor="email" className="label mt-5">Email</label>
      <input id="email" name="email" type="email" inputMode="email" autoComplete="email" required className="input" />

      <button type="submit" className="btn-primary mt-6 w-full" disabled={pending} aria-busy={pending}>
        {pending ? "Sending…" : "Send reset link"}
      </button>
      <Link href="/login" className="btn-ghost mt-2 w-full">Back to sign in</Link>
    </form>
  );
}
