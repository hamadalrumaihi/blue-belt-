"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { clearManualCorrection, setManualCorrection } from "@/lib/actions/corrections";
import type { EffectiveMatch } from "@/lib/eta";
import { overrideOf } from "@/lib/manual-correction";
import { formatTime } from "@/lib/time";

type Props = { match: EffectiveMatch; timezone: string };

/**
 * Owner-only: correct the mat and/or time of a match by hand when the venue
 * announces something the source has not caught up with. The correction is
 * attributed, labelled everywhere, kept beside the source values, expires at
 * the end of the event day by default, and is dropped explicitly when the
 * source itself changes that field.
 */
export function ManualCorrection({ match, timezone }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mat, setMat] = useState("");
  const [time, setTime] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const current = overrideOf(match);
  const active = Boolean(match.manual?.mat || match.manual?.time);

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await setManualCorrection({ matchId: match.id, mat: mat || null, time: time || null, reason: reason || null });
      if (!res.ok) return setError(res.error);
      setOpen(false);
      setMat("");
      setTime("");
      setReason("");
      router.refresh();
    });
  }

  function clear() {
    setError(null);
    startTransition(async () => {
      const res = await clearManualCorrection(match.id);
      if (!res.ok) return setError(res.error);
      router.refresh();
    });
  }

  return (
    <div className="mt-3 rounded-xl border border-dashed border-line p-3 text-sm">
      {active && current ? (
        <p className="text-xs text-ink">
          <span className="rounded-md bg-lightblue px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">Manual</span>{" "}
          {current.mat ? `Mat → ${current.mat}` : null}
          {current.mat && current.scheduledAt ? " · " : null}
          {current.scheduledAt ? `Time → ${formatTime(current.scheduledAt, timezone)}` : null}
          {current.reason ? ` (${current.reason})` : ""}
          {current.until ? ` · until ${formatTime(current.until, timezone)}` : ""}
          {current.at ? ` · set ${formatTime(current.at, timezone)} by you` : ""}
        </p>
      ) : (
        <p className="text-xs text-muted">Venue announced a different mat or time? Correct it here; the source values stay stored and a later source change replaces your correction with a note in the history.</p>
      )}
      {!open ? (
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" className="btn-secondary min-h-11" onClick={() => setOpen(true)} disabled={pending}>{active ? "Change correction" : "Correct mat / time"}</button>
          {active && <button type="button" className="btn-ghost min-h-11" onClick={clear} disabled={pending}>Remove correction</button>}
        </div>
      ) : (
        <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_2fr_auto_auto] sm:items-end">
          <label className="block text-xs">
            <span className="mb-1 block font-semibold text-ink">Mat</span>
            <input className="input" placeholder={match.mat ?? "Mat 5"} value={mat} onChange={(e) => setMat(e.target.value)} maxLength={40} />
          </label>
          <label className="block text-xs">
            <span className="mb-1 block font-semibold text-ink">Time ({timezone})</span>
            <input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </label>
          <label className="block text-xs">
            <span className="mb-1 block font-semibold text-ink">Why (optional)</span>
            <input className="input" placeholder="Announcer moved it" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={120} />
          </label>
          <button type="button" className="btn-primary min-h-11" onClick={save} disabled={pending || (!mat && !time)}>Save</button>
          <button type="button" className="btn-ghost min-h-11" onClick={() => setOpen(false)} disabled={pending}>Cancel</button>
        </div>
      )}
      {error && <p className="mt-2 text-xs font-semibold text-danger" role="alert">{error}</p>}
    </div>
  );
}
