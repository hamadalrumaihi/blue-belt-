"use client";

import { useState, useTransition } from "react";
import { DeleteDialog } from "@/components/DeleteDialog";
import { deleteService, seedDefaultServices, setServiceActive } from "@/lib/actions/services";

/** Archive / restore and delete for one package row. */
export function ServiceRowActions({ id, name, active }: { id: string; name: string; active: boolean }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        className="btn-secondary min-h-10"
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const r = await setServiceActive(id, !active);
            if (!r.ok) setError(r.error);
          });
        }}
      >
        {active ? "Archive" : "Restore"}
      </button>
      <DeleteDialog trigger="Delete" triggerClassName="min-h-10" title="Delete package?" summary={<><strong>{name}</strong> will be removed from the website and the booking form. Bookings that used it keep their package name.</>} onConfirm={async () => { const r = await deleteService(id); return r.ok ? null : { error: r.error }; }} />
      {error && <p className="w-full text-xs font-semibold text-danger" role="alert">{error}</p>}
    </div>
  );
}

/** One-tap starter set for an empty studio. */
export function SeedServicesButton() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <button
        type="button"
        className="btn-primary"
        disabled={pending}
        aria-busy={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const r = await seedDefaultServices();
            if (!r.ok) setError(r.error);
          });
        }}
      >
        {pending ? "Creating…" : "Create the starter packages"}
      </button>
      {error && <p className="mt-2 text-xs font-semibold text-danger" role="alert">{error}</p>}
    </div>
  );
}
