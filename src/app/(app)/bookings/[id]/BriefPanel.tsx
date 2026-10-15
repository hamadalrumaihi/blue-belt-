"use client";

import Link from "next/link";
import { useState } from "react";
import { CheckIcon, CopyIcon, FileTextIcon } from "@/components/icons";
import type { ChecklistItem } from "@/lib/bookings/brief";
import { formatEventDate } from "@/lib/time";
import { cn } from "@/lib/utils";

/** "Copy as text" for the brief page; falls back to a visible textarea when the clipboard is blocked. */
export function CopyBriefButton({ text }: { text: string }) {
  const [state, setState] = useState<"idle" | "copied" | "manual">("idle");
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
      setTimeout(() => setState("idle"), 1500);
    } catch {
      setState("manual");
    }
  }
  return (
    <div className="print:hidden">
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={copy} className="btn-secondary min-h-10" aria-live="polite">{state === "copied" ? <CheckIcon size={16} /> : <CopyIcon size={16} />} {state === "copied" ? "Copied" : "Copy as text"}</button>
        <button type="button" onClick={() => window.print()} className="btn-secondary min-h-10">Print</button>
      </div>
      {state === "manual" && <textarea readOnly className="input mt-2 min-h-40 font-mono text-xs" value={text} onFocus={(e) => e.currentTarget.select()} aria-label="Brief as text" />}
    </div>
  );
}

/** Compact checklist on the booking page: what the client still owes, with a link to the full brief. */
export function BriefPanel({ bookingId, checklist, sessionKnown }: { bookingId: string; checklist: ChecklistItem[]; sessionKnown: boolean }) {
  const open = checklist.filter((i) => !i.done);
  const overdue = open.filter((i) => i.overdue).length;
  return (
    <section className="card p-4" aria-labelledby="brief-h">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="brief-h" className="eyebrow">Shoot brief &amp; client checklist</h2>
        <Link href={`/bookings/${bookingId}/brief`} className="btn-secondary min-h-9 px-3 text-xs"><FileTextIcon size={14} /> Open brief</Link>
      </div>
      {open.length === 0 ? (
        <p className="mt-2 text-sm text-success">Everything needed for the day is in hand.</p>
      ) : (
        <>
          <p className="mt-1 text-xs text-muted">{open.length} item{open.length === 1 ? "" : "s"} still needed from the client{overdue ? `, ${overdue} overdue` : ""}.{sessionKnown ? "" : " Set the session date to get due dates."} Reminders are for you; nothing is sent automatically.</p>
          <ul className="mt-2 space-y-1">
            {open.map((i) => (
              <li key={i.key} className={cn("flex items-start gap-2 rounded-lg px-3 py-2 text-sm", i.overdue ? "border border-danger/30 bg-danger-soft" : "border border-line bg-page")}>
                <span className="mt-0.5 inline-block h-3.5 w-3.5 shrink-0 rounded border border-muted" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="font-semibold text-ink">{i.label}</span>
                  {i.due && <span className={cn("ml-2 text-[11px] font-bold uppercase tracking-wide", i.overdue ? "text-danger" : "text-muted")}>{i.overdue ? "overdue · " : "by "}{formatEventDate(i.due, "short")}</span>}
                  <span className="block text-xs text-muted">{i.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
