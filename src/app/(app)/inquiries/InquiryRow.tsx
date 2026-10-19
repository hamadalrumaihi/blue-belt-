"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addInquiryNote, convertInquiryToBooking, setInquiryStatus } from "@/lib/actions/inquiries";
import { INQUIRY_NOTE_MAX, INQUIRY_STATUS_LABEL, INQUIRY_STATUSES, type InquiryNote } from "@/lib/inquiries/labels";
import type { InquiryStatus } from "@/lib/supabase/database.types";
import { formatStamp } from "@/lib/time";
import { cn } from "@/lib/utils";

const TONE: Record<InquiryStatus, string> = {
  new: "bg-lightblue text-primary border-primary/20",
  in_progress: "bg-warning-soft text-warning border-warning/30",
  waiting_customer: "bg-page text-muted border-line",
  quoted: "bg-warning-soft text-warning border-warning/30",
  converted: "bg-success-soft text-success border-success/30",
  resolved: "bg-success-soft text-success border-success/30",
  closed: "bg-page text-muted border-line",
};

/** Status select, convert button and the private notes thread for one inquiry; the row itself is rendered by the server page. */
export function InquiryControls({ id, status, bookingId, notes }: { id: string; status: InquiryStatus; bookingId: string | null; notes: InquiryNote[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [showNotes, setShowNotes] = useState(notes.length > 0);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={`status-${id}`}>Inquiry status</label>
        <select
          id={`status-${id}`}
          className={cn("input min-h-10 w-auto rounded-full border px-3 text-xs font-bold uppercase tracking-wide", TONE[status])}
          value={status}
          disabled={pending}
          onChange={(e) => {
            const next = e.target.value as InquiryStatus;
            setError(null);
            startTransition(async () => {
              const r = await setInquiryStatus(id, next);
              if (!r.ok) setError(r.error);
              else router.refresh();
            });
          }}
        >
          {INQUIRY_STATUSES.map((s) => (
            <option key={s} value={s}>{INQUIRY_STATUS_LABEL[s]}</option>
          ))}
        </select>
        {bookingId ? (
          <Link href={`/bookings/${bookingId}`} className="btn-secondary min-h-10">Open booking</Link>
        ) : (
          <button
            type="button"
            className="btn-primary min-h-10"
            disabled={pending}
            aria-busy={pending}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                const r = await convertInquiryToBooking(id);
                if (!r.ok) setError(r.error);
                else if (r.bookingId) router.push(`/bookings/${r.bookingId}`);
              });
            }}
          >
            {pending ? "Working…" : "Create booking"}
          </button>
        )}
        <button type="button" className="btn-ghost min-h-10 px-3 text-xs" aria-expanded={showNotes} onClick={() => setShowNotes((v) => !v)}>
          Notes{notes.length ? ` (${notes.length})` : ""}
        </button>
      </div>
      {showNotes && (
        <div className="rounded-xl border border-line bg-page p-3">
          {notes.length > 0 && (
            <ul className="space-y-2 text-sm">
              {notes.map((n, i) => (
                <li key={`${n.at}-${i}`} className="border-l-2 border-line pl-3">
                  <p className="whitespace-pre-line text-ink">{n.text}</p>
                  <p className="text-[11px] text-muted">{n.at ? formatStamp(n.at) : ""}</p>
                </li>
              ))}
            </ul>
          )}
          <form
            className="mt-2 flex flex-col gap-2 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              const text = note;
              startTransition(async () => {
                const r = await addInquiryNote(id, text);
                if (!r.ok) setError(r.error);
                else {
                  setNote("");
                  router.refresh();
                }
              });
            }}
          >
            <label className="sr-only" htmlFor={`note-${id}`}>Add a private note</label>
            <input id={`note-${id}`} className="input min-h-10 flex-1 text-sm" placeholder="Private note (never shown to the customer)" value={note} maxLength={INQUIRY_NOTE_MAX} onChange={(e) => setNote(e.target.value)} disabled={pending} />
            <button type="submit" className="btn-secondary min-h-10" disabled={pending || !note.trim()}>Add note</button>
          </form>
        </div>
      )}
      {error && <p className="text-xs font-semibold text-danger" role="alert">{error}</p>}
      <p className="sr-only" aria-live="polite">{pending ? "Saving" : ""}</p>
    </div>
  );
}
