"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { LinkIcon, PlusIcon, SwordsIcon } from "@/components/icons";
import { linkBookingToAthlete, unlinkBookingAthlete } from "@/lib/actions/bookings";

type Props = {
  bookingId: string;
  eventId: string | null;
  eventName: string | null;
  athletes: Array<{ id: string; name: string }>;
  linked: { id: string; name: string } | null;
};

/**
 * The only bridge from a booking to the Tournament Watcher: the owner picks
 * an athlete already tracked in the event, or explicitly creates one from
 * this booking. Nothing links automatically.
 */
export function AthleteLink({ bookingId, eventId, eventName, athletes, linked }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [choice, setChoice] = useState("");
  const selectId = useId();

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Something went wrong");
      else router.refresh();
    });
  }

  if (linked) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-ink">
          Linked to <Link href={`/clients/${linked.id}`} className="font-bold text-primary hover:underline">{linked.name}</Link>
          <span className="text-muted">. The watcher tracks their matches{eventName ? ` at ${eventName}` : ""}.</span>
        </p>
        <button type="button" className="btn-ghost min-h-11" disabled={pending} onClick={() => run(() => unlinkBookingAthlete(bookingId))}>Unlink athlete</button>
        <p className="text-xs font-semibold text-danger" role="alert" aria-live="polite">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {!eventId && <p className="text-sm text-muted">Set the booking&rsquo;s event first (Edit) to link a tracked athlete.</p>}
      {eventId && athletes.length > 0 && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="block min-w-0 flex-1">
            <span className="label" id={`${selectId}-label`}>Tracked athlete{eventName ? ` at ${eventName}` : ""}</span>
            <select id={selectId} aria-labelledby={`${selectId}-label`} className="input" value={choice} onChange={(e) => setChoice(e.target.value)} disabled={pending}>
              <option value="">Choose an athlete…</option>
              {athletes.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
          <button type="button" className="btn-secondary min-h-11" disabled={pending || !choice} onClick={() => run(() => linkBookingToAthlete(bookingId, choice))}><LinkIcon size={16} /> Link</button>
        </div>
      )}
      {eventId && athletes.length === 0 && <p className="text-sm text-muted">No athletes are tracked in this event yet.</p>}
      {eventId && (
        <Link href={`/bookings/${bookingId}/athlete/new`} className="btn-primary min-h-11"><PlusIcon size={16} /> Create tracked athlete from this booking</Link>
      )}
      <p className="flex items-start gap-1.5 text-xs text-muted"><SwordsIcon size={14} className="mt-0.5 shrink-0" /> Tracked athletes are never created automatically from bookings or payments. This is your call.</p>
      <p className="text-xs font-semibold text-danger" role="alert" aria-live="polite">{error}</p>
    </div>
  );
}
