"use client";

import { useActionState } from "react";
import { updatePassword } from "@/lib/actions/auth";

export default function ResetPasswordPage() {
  const [state, action, pending] = useActionState(updatePassword, null);
  return (
    <form action={action} className="rounded-card bg-white p-6 text-ink shadow-hero" noValidate>
      <h2 className="text-xl font-extrabold">Choose a new password</h2>
      {state?.error && <p className="mt-4 rounded-xl border border-danger/30 bg-danger-soft px-3 py-2 text-sm font-semibold text-danger" role="alert">{state.error}</p>}

      <label htmlFor="password" className="label mt-5">New password</label>
      <input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} className="input" />
      <label htmlFor="confirm" className="label mt-4">Confirm password</label>
      <input id="confirm" name="confirm" type="password" autoComplete="new-password" required minLength={8} className="input" />

      <button type="submit" className="btn-primary mt-6 w-full" disabled={pending} aria-busy={pending}>
        {pending ? "Saving…" : "Save password"}
      </button>
    </form>
  );
}
