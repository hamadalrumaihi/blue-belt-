"use client";

import { useEffect, useId, useRef, useState, useTransition, type ReactNode } from "react";
import { AlertIcon, CloseIcon, TrashIcon } from "./icons";
import { cn } from "@/lib/utils";

type Props = {
  /** Button label that opens the dialog. */
  trigger: ReactNode;
  triggerClassName?: string;
  title: string;
  /** What exactly will be deleted. Shown prominently. */
  summary: ReactNode;
  confirmLabel?: string;
  /** When true the user must type DELETE. */
  requireTyping?: boolean;
  onConfirm: () => Promise<{ error?: string } | null | void>;
};

/** Accessible confirmation dialog for destructive actions. */
export function DeleteDialog({ trigger, triggerClassName, title, summary, confirmLabel = "Delete", requireTyping = false, onConfirm }: Props) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  // Read inside the keydown handler without re-subscribing it every render.
  const pendingRef = useRef(pending);
  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    // Remember what had focus so we can hand it back when the dialog closes.
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pendingRef.current) {
        setOpen(false);
        return;
      }
      if (e.key !== "Tab" || !dialog) return;
      // Trap Tab / Shift+Tab inside the dialog (WCAG 2.1.2 / 2.4.3).
      const focusables = dialog.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      } else if (!dialog.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    dialog?.querySelector<HTMLElement>("input,button")?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      restoreFocusRef.current?.focus?.();
    };
  }, [open]);

  const canConfirm = !pending && (!requireTyping || typed === "DELETE");

  function confirm() {
    if (!canConfirm) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await onConfirm();
        if (result && "error" in result && result.error) {
          setError(result.error);
          return;
        }
        setOpen(false);
        setTyped("");
      } catch (err) {
        // A Next.js redirect inside the action throws; let it propagate.
        if (err instanceof Error && err.message.includes("NEXT_REDIRECT")) throw err;
        setError(err instanceof Error ? err.message : "Delete failed");
      }
    });
  }

  return (
    <>
      <button type="button" className={cn("btn-danger-outline", triggerClassName)} onClick={() => setOpen(true)}>
        <TrashIcon size={16} />
        {trigger}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-navy/60 p-3 backdrop-blur-sm sm:items-center" onClick={() => !pending && setOpen(false)}>
          <div
            ref={dialogRef}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="card w-full max-w-md p-5 safe-bottom"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-danger-soft text-danger">
                  <AlertIcon />
                </span>
                <h2 id={titleId} className="text-lg font-extrabold text-ink">{title}</h2>
              </div>
              <button type="button" className="btn-ghost h-9 w-9 p-0" onClick={() => setOpen(false)} aria-label="Close" disabled={pending}>
                <CloseIcon size={18} />
              </button>
            </div>

            <div className="mt-4 rounded-xl border border-danger/20 bg-danger-soft/60 p-3 text-sm text-ink">{summary}</div>

            {requireTyping && (
              <label className="mt-4 block">
                <span className="label">Type <span className="font-mono">DELETE</span> to confirm</span>
                <input
                  className="input font-mono uppercase"
                  value={typed}
                  onChange={(e) => setTyped(e.target.value.toUpperCase())}
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  placeholder="DELETE"
                />
              </label>
            )}

            {error && <p className="mt-3 text-sm font-semibold text-danger" role="alert">{error}</p>}

            <div className="mt-5 flex gap-2">
              <button type="button" className="btn-secondary flex-1" onClick={() => setOpen(false)} disabled={pending}>Cancel</button>
              <button type="button" className="btn-danger flex-1" onClick={confirm} disabled={!canConfirm} aria-busy={pending}>
                {pending ? "Deleting…" : confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
