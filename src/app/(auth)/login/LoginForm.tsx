"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signIn } from "@/lib/actions/auth";

export function LoginForm({ next, linkError }: { next: string; linkError: boolean }) {
  const [state, action, pending] = useActionState(signIn, null);
  return (
    <form action={action} className="rounded-card bg-white p-6 text-ink shadow-hero" noValidate>
      <input type="hidden" name="next" value={next} />
      <h2 className="text-xl font-extrabold">Sign in</h2>
      <p className="mt-1 text-sm text-muted">Use your Blue Belt Media account.</p>

      {(state?.error || linkError) && (
        <p className="mt-4 rounded-xl border border-danger/30 bg-danger-soft px-3 py-2 text-sm font-semibold text-danger" role="alert">
          {state?.error ?? "That sign-in link is invalid or has expired."}
        </p>
      )}

      <label htmlFor="email" className="label mt-5">Email</label>
      <input id="email" name="email" type="email" inputMode="email" autoComplete="email" required className="input" placeholder="you@bluebeltmedia.com" />

      <div className="mt-4 flex items-baseline justify-between">
        <label htmlFor="password" className="label mb-0">Password</label>
        <Link href="/forgot-password" className="text-xs font-semibold text-primary hover:underline">Forgot password?</Link>
      </div>
      <input id="password" name="password" type="password" autoComplete="current-password" required className="input mt-1.5" />

      <button type="submit" className="btn-primary mt-6 w-full" disabled={pending} aria-busy={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
