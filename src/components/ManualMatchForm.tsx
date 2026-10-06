"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteManualMatch, saveManualMatch } from "@/lib/actions/matches";
import { snapshotNumber } from "@/components/NextClientCard";
import { formatTime, wallClockToIso } from "@/lib/time";
import { MATCH_STATUSES, type MatchRow, type MatchStatus } from "@/lib/types";
import { STATUS_LABEL } from "@/lib/eta";
import { PlusIcon } from "./icons";

type Props = {
  athleteId: string;
  timezone: string;
  eventDate: string | null;
  /** When set, the form edits this match instead of adding one. */
  match?: MatchRow | null;
  onDone?: () => void;
  compact?: boolean;
};

/** HH:MM in the event's zone for an ISO instant, for the time input. */
function wallClock(iso: string | null, timezone: string): string {
  if (!iso) return "";
  const t = formatTime(iso, timezone);
  return t === "—" ? "" : t;
}

function dateInZone(iso: string | null, timezone: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/**
 * Add or edit one hand-entered match: round, opponent, mat, time, status,
 * result and next-round notes. Saves through the owner-only action; the
 * client page refreshes with the new row and a history entry.
 */
export function ManualMatchForm({ athleteId, timezone, eventDate, match = null, onDone, compact }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(Boolean(match));
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(() => ({
    round: match?.round ?? "",
    opponent: match?.opponent ?? "",
    mat: match?.mat ?? "",
    time: wallClock(match?.scheduled_at ?? null, timezone),
    date: match ? dateInZone(match.scheduled_at, timezone) : eventDate ?? "",
    status: (match?.status as MatchStatus) ?? "scheduled",
    result: match?.result ?? "",
    nextRound: match?.next_round ?? "",
    matchNumber: match ? snapshotNumber(match) ?? "" : "",
  }));
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const preview = form.time && /^\d{1,2}:\d{2}$/.test(form.time) ? wallClockToIso(form.time, timezone, form.date || eventDate || null) : null;

  function save() {
    setError(null);
    start(async () => {
      const res = await saveManualMatch({
        athleteId,
        matchId: match?.id ?? null,
        round: form.round,
        opponent: form.opponent,
        mat: form.mat,
        time: form.time,
        date: form.date,
        status: form.status,
        result: form.result,
        next_round: form.nextRound,
        match_number: form.matchNumber,
      });
      if (!res.ok) return setError(res.error);
      setOpen(false);
      if (!match) setForm((f) => ({ ...f, round: "", opponent: "", mat: "", time: "", result: "", nextRound: "", matchNumber: "", status: "scheduled" }));
      onDone?.();
      router.refresh();
    });
  }

  function remove() {
    if (!match) return;
    setError(null);
    start(async () => {
      const res = await deleteManualMatch(match.id);
      if (!res.ok) return setError(res.error);
      onDone?.();
      router.refresh();
    });
  }

  if (!open) {
    return (
      <button type="button" className={compact ? "btn-secondary min-h-9 px-3 text-xs" : "btn-primary"} onClick={() => setOpen(true)}>
        <PlusIcon size={16} /> {match ? "Edit match" : "Add match"}
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-line bg-page p-3" role="group" aria-label={match ? "Edit match" : "Add match"}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs">
          <span className="mb-1 block font-semibold text-ink">Round / bracket</span>
          <input className="input" value={form.round} onChange={set("round")} placeholder="Quarter-final · Kids 2 Heavy" maxLength={80} />
        </label>
        <label className="block text-xs">
          <span className="mb-1 block font-semibold text-ink">Opponent</span>
          <input className="input" value={form.opponent} onChange={set("opponent")} placeholder="Name" maxLength={80} />
        </label>
        <label className="block text-xs">
          <span className="mb-1 block font-semibold text-ink">Mat</span>
          <input className="input" value={form.mat} onChange={set("mat")} placeholder="Mat 2" maxLength={40} />
        </label>
        <label className="block text-xs">
          <span className="mb-1 block font-semibold text-ink">Match #</span>
          <input className="input" value={form.matchNumber} onChange={set("matchNumber")} placeholder="12" maxLength={20} inputMode="numeric" />
        </label>
        <label className="block text-xs">
          <span className="mb-1 block font-semibold text-ink">Date</span>
          <input className="input" type="date" value={form.date} onChange={set("date")} />
        </label>
        <label className="block text-xs">
          <span className="mb-1 block font-semibold text-ink">Time ({timezone === "Asia/Qatar" ? "Qatar time" : timezone})</span>
          <input className="input" type="time" value={form.time} onChange={set("time")} />
          {form.time && !preview && <span className="mt-1 block text-danger">Enter a time as HH:MM.</span>}
        </label>
        <label className="block text-xs">
          <span className="mb-1 block font-semibold text-ink">Status</span>
          <select className="input" value={form.status} onChange={set("status")}>
            {MATCH_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        </label>
        <label className="block text-xs">
          <span className="mb-1 block font-semibold text-ink">Result</span>
          <input className="input" value={form.result} onChange={set("result")} placeholder="Won by submission · Lost on points" maxLength={240} />
        </label>
        <label className="block text-xs sm:col-span-2">
          <span className="mb-1 block font-semibold text-ink">Next round</span>
          <input className="input" value={form.nextRound} onChange={set("nextRound")} placeholder="Semi-final vs winner of #14, Mat 1 around 15:30" maxLength={240} />
        </label>
      </div>
      {error && <p className="mt-2 text-xs font-semibold text-danger" role="alert">{error}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="btn-primary min-h-11" onClick={save} disabled={pending} aria-busy={pending}>{pending ? "Saving…" : match ? "Save changes" : "Add match"}</button>
        <button type="button" className="btn-ghost min-h-11" onClick={() => { setOpen(false); onDone?.(); }} disabled={pending}>Cancel</button>
        {match && <button type="button" className="btn-ghost min-h-11 text-danger" onClick={remove} disabled={pending}>Delete match</button>}
      </div>
    </div>
  );
}
