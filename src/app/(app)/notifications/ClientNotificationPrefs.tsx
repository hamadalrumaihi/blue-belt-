"use client";

import { useState, useTransition } from "react";
import { setClientNotificationPref } from "@/lib/actions/notifications";
import { CLIENT_NOTIFICATION_HELP, CLIENT_NOTIFICATION_LABEL, type ClientNotificationKind } from "@/lib/notifications/email/kinds";
import type { ClientPrefView } from "@/lib/notifications/queries";
import { cn } from "@/lib/utils";

/** One switch per client e-mail kind; optimistic, rolled back when the save fails. */
export function ClientNotificationPrefs({ prefs }: { prefs: ClientPrefView[] }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<Record<string, boolean>>(() => Object.fromEntries(prefs.map((p) => [p.kind, p.enabled])));
  const [seen, setSeen] = useState(prefs);
  if (seen !== prefs) {
    setSeen(prefs);
    setState(Object.fromEntries(prefs.map((p) => [p.kind, p.enabled])));
  }

  function toggle(kind: ClientNotificationKind, next: boolean) {
    const prev = state[kind];
    setError(null);
    setState((s) => ({ ...s, [kind]: next }));
    startTransition(async () => {
      const res = await setClientNotificationPref(kind, next);
      if (!res.ok) {
        setState((s) => ({ ...s, [kind]: prev }));
        setError(res.error);
      }
    });
  }

  return (
    <div className="space-y-2">
      <ul className="divide-y divide-line">
        {prefs.map((p) => {
          const checked = state[p.kind] ?? p.enabled;
          const id = `pref-${p.kind}`;
          return (
            <li key={p.kind} className="flex items-start justify-between gap-3 py-3">
              <div className="min-w-0">
                <p id={id} className="text-sm font-semibold text-ink">{CLIENT_NOTIFICATION_LABEL[p.kind]}</p>
                <p className="text-xs text-muted">{CLIENT_NOTIFICATION_HELP[p.kind]}</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={checked}
                aria-labelledby={id}
                disabled={pending || p.locked}
                onClick={() => toggle(p.kind, !checked)}
                className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                <span className={cn("relative inline-block h-6 w-11 rounded-full transition-colors motion-reduce:transition-none", checked ? "bg-primary" : "bg-line")}>
                  <span className={cn("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform motion-reduce:transition-none", checked ? "translate-x-5" : "translate-x-0.5")} />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <div aria-live="polite">{error && <p className="text-sm font-semibold text-danger" role="alert">{error}</p>}</div>
    </div>
  );
}
