"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { assignBookingCoverage } from "@/lib/actions/bookings";
import type { TeamOption } from "@/lib/bookings/queries";

type Props = { bookingId: string; photographerId: string | null; videographerId: string | null; team: TeamOption[] };

/** Who shoots this booking: the owner by default, or a collaborator from the event teams. */
export function CoverageAssign({ bookingId, photographerId, videographerId, team }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const ids = { photo: useId(), video: useId() };

  function assign(kind: "photographerId" | "videographerId", value: string) {
    setError(null);
    start(async () => {
      const res = await assignBookingCoverage(bookingId, { [kind]: value || null });
      if (!res.ok) setError(res.error);
      else router.refresh();
    });
  }

  const label = (m: TeamOption) => `${m.role} · ${m.userId.slice(0, 8)}`;

  return (
    <div className="space-y-2">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={ids.photo} className="label">Photographer</label>
          <select id={ids.photo} className="input" defaultValue={photographerId ?? ""} disabled={pending} onChange={(e) => assign("photographerId", e.target.value)}>
            <option value="">Me (owner)</option>
            {team.map((m) => <option key={m.userId} value={m.userId}>{label(m)}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor={ids.video} className="label">Videographer</label>
          <select id={ids.video} className="input" defaultValue={videographerId ?? ""} disabled={pending} onChange={(e) => assign("videographerId", e.target.value)}>
            <option value="">Me (owner)</option>
            {team.map((m) => <option key={m.userId} value={m.userId}>{label(m)}</option>)}
          </select>
        </div>
      </div>
      {team.length === 0 && <p className="text-xs text-muted">Invite collaborators to an event to assign them here.</p>}
      <p className="text-xs font-semibold text-danger" role="alert" aria-live="polite">{error}</p>
    </div>
  );
}
