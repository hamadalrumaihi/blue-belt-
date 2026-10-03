"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CoverageControls } from "@/components/CoverageControls";
import { assignCoverage } from "@/lib/actions/coverage";
import type { EventTeamMember } from "@/lib/collaborator";

type Props = {
  athleteId: string;
  eventId: string | null;
  photosDoneAt: string | null;
  videosDoneAt: string | null;
  photographerId: string | null;
  videographerId: string | null;
  team: EventTeamMember[];
};

/** Owner's coverage card: mark Photos/Video done and assign collaborators per client. */
export function CoverageSection({ athleteId, eventId, photosDoneAt, videosDoneAt, photographerId, videographerId, team }: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function assign(kind: "photographerId" | "videographerId", value: string) {
    setError(null);
    startTransition(async () => {
      const res = await assignCoverage(athleteId, { [kind]: value || null });
      if (!res.ok) setError(res.error);
      else router.refresh();
    });
  }

  function label(m: EventTeamMember) {
    return m.email ?? `${m.role} (${m.userId.slice(0, 8)})`;
  }

  return (
    <section className="card p-4" aria-label="Coverage">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-extrabold uppercase tracking-wider text-muted">Coverage</h2>
      </div>
      <p className="mt-1 text-xs text-muted">Mark what you have shot. Completion is separate from the match status and is never cleared by a refresh.</p>
      <div className="mt-3">
        <CoverageControls athleteId={athleteId} photosDoneAt={photosDoneAt} videosDoneAt={videosDoneAt} />
      </div>

      {eventId && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="label">Photographer</span>
            <select className="input" defaultValue={photographerId ?? ""} disabled={pending} onChange={(e) => assign("photographerId", e.target.value)}>
              <option value="">Me (owner)</option>
              {team.map((m) => <option key={m.userId} value={m.userId}>{label(m)}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="label">Videographer</span>
            <select className="input" defaultValue={videographerId ?? ""} disabled={pending} onChange={(e) => assign("videographerId", e.target.value)}>
              <option value="">Me (owner)</option>
              {team.map((m) => <option key={m.userId} value={m.userId}>{label(m)}</option>)}
            </select>
          </label>
        </div>
      )}
      {team.length === 0 && (
        <p className="mt-3 text-xs text-muted">No collaborators yet. Invite one from the event page to assign coverage to them.</p>
      )}
      {error && <p className="mt-2 text-xs font-semibold text-danger" role="alert">{error}</p>}
    </section>
  );
}
