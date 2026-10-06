"use client";

import { useState, useTransition } from "react";
import { CheckIcon } from "@/components/icons";
import { setIssueDone } from "@/lib/actions/incidents";

/** "Done" / "Not done" toggle for one open issue; reversible, so no confirm step. */
export function IssueDoneButton({ id, done, label }: { id: string; done: boolean; label: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-1">
      <button
        type="button"
        className={done ? "btn-ghost min-h-11" : "btn-primary min-h-11"}
        disabled={pending}
        aria-busy={pending}
        aria-label={done ? `Mark “${label}” not done` : `Mark “${label}” done`}
        onClick={() => start(async () => {
          const res = await setIssueDone(id, !done);
          setError(res.ok ? null : res.error);
        })}
      >
        {!done && <CheckIcon size={16} />}
        {pending ? "Saving…" : done ? "Undo done" : "Done"}
      </button>
      {error && <p className="max-w-xs text-xs font-semibold text-danger" role="alert">{error}</p>}
    </div>
  );
}
