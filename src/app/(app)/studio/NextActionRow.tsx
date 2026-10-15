"use client";

import Link from "next/link";
import { useState } from "react";
import { CheckIcon, CopyIcon } from "@/components/icons";
import type { NextAction } from "@/lib/studio/next-action";
import type { BookingStatus } from "@/lib/supabase/database.types";
import { formatEventDate } from "@/lib/time";
import { cn } from "@/lib/utils";
import { BookingStatusBadge } from "../bookings/BookingStatusBadge";

const TONE: Record<NextAction["tone"], string> = {
  info: "bg-lightblue text-primary",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  success: "bg-success-soft text-success",
  muted: "bg-page text-muted",
};

type Props = {
  action: NextAction;
  /** ISO now, from the server, so the relative due text matches what was computed. */
  now: string;
  title?: string;
  subtitle?: string;
  status?: BookingStatus;
  /** Large variant for the top of the booking page. */
  prominent?: boolean;
};

function relativeDays(due: string, now: string): string {
  const days = Math.round((new Date(due).getTime() - new Date(now).getTime()) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  if (days > 1 && days < 14) return `in ${days} days`;
  if (days < -1 && days > -14) return `${-days} days ago`;
  return formatEventDate(due.slice(0, 10), "short");
}

function dueText(action: NextAction, now: string): string | null {
  if (!action.due) return null;
  const rel = relativeDays(action.due, now);
  return action.overdue ? `Overdue · ${rel}` : `Due ${rel}`;
}

/** One next-action line: label, due, link, and a copy button for the follow-up draft (never sent). */
export function NextActionRow({ action, now, title, subtitle, status, prominent }: Props) {
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);
  const due = dueText(action, now);
  async function copy() {
    if (!action.draft) return;
    try {
      await navigator.clipboard.writeText(action.draft.body);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setOpen(true);
    }
  }
  return (
    <div className={cn("flex flex-col gap-2", prominent ? "" : "sm:flex-row sm:items-center")}>
      <div className="min-w-0 flex-1">
        {title && (
          <p className="flex flex-wrap items-center gap-2 text-sm font-bold text-ink">
            <span className="truncate">{title}</span>
            {status && <BookingStatusBadge status={status} size="sm" />}
          </p>
        )}
        {subtitle && <p className="truncate text-xs text-muted">{subtitle}</p>}
        <p className={cn("mt-1 flex flex-wrap items-center gap-2", prominent ? "text-lg font-extrabold text-ink" : "text-sm font-semibold text-ink")}>
          <Link href={action.href} className="hover:underline">{action.label}</Link>
          {due && <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide", TONE[action.tone])}>{due}</span>}
        </p>
      </div>
      {action.draft && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <button type="button" onClick={copy} className="btn-secondary min-h-9 px-3 text-xs" aria-live="polite">
            {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />} {copied ? "Copied" : "Copy follow-up"}
          </button>
          <button type="button" onClick={() => setOpen((v) => !v)} className="btn-ghost min-h-9 px-3 text-xs" aria-expanded={open}>{open ? "Hide draft" : "Show draft"}</button>
        </div>
      )}
      {action.draft && open && (
        <div className="w-full rounded-xl border border-line bg-page p-3 text-sm text-ink sm:basis-full">
          <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-muted">Draft · copy and send it yourself. Nothing is sent from here.</p>
          <p className="text-xs font-semibold text-muted">Subject: {action.draft.subject}</p>
          <p className="mt-1 whitespace-pre-line">{action.draft.body}</p>
        </div>
      )}
    </div>
  );
}
