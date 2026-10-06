"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { retryDelivery } from "@/lib/actions/notifications";
import { CLIENT_NOTIFICATION_LABEL, isClientNotificationKind } from "@/lib/notifications/email/kinds";
import type { DeliveryView } from "@/lib/notifications/queries";
import { CATEGORY_LABEL, type MessageCategory } from "@/lib/notifications/telegram/kinds";
import { formatStamp } from "@/lib/time";
import { cn } from "@/lib/utils";

const STATUS: Record<DeliveryView["status"], { label: string; tone: string }> = {
  pending: { label: "Queued", tone: "bg-page text-muted border border-line" },
  sending: { label: "Sending", tone: "bg-lightblue text-primary border border-primary/20" },
  sent: { label: "Sent", tone: "bg-success-soft text-success border border-success/30" },
  failed: { label: "Failed", tone: "bg-danger-soft text-danger border border-danger/30" },
  skipped: { label: "Skipped", tone: "bg-warning-soft text-warning border border-warning/30" },
};

function kindLabel(kind: string): string {
  if (isClientNotificationKind(kind)) return CLIENT_NOTIFICATION_LABEL[kind];
  return kind.toLowerCase().replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

/** Last deliveries across Telegram and e-mail, with a retry for the failed ones. */
export function RecentDeliveries({ rows, now }: { rows: DeliveryView[]; now: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const nowDate = new Date(now);

  function retry(id: number) {
    setError(null);
    setBusyId(id);
    startTransition(async () => {
      const res = await retryDelivery(id);
      setBusyId(null);
      if (!res.ok) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      <ul className="divide-y divide-line">
        {rows.map((r) => {
          const s = STATUS[r.status];
          const category = r.category && r.category in CATEGORY_LABEL ? CATEGORY_LABEL[r.category as MessageCategory] : null;
          return (
            <li key={r.id} className="flex flex-wrap items-start justify-between gap-2 py-3">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
                  <span>{kindLabel(r.kind)}</span>
                  {category && <span className="rounded bg-page px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted">{category}</span>}
                  <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide", s.tone)}>{s.label}</span>
                </p>
                <p className="break-words text-xs text-muted">
                  {r.channel === "email" ? "E-mail" : "Telegram"} · to {r.to}{r.subject ? ` · “${r.subject}”` : ""} · {formatStamp(r.sentAt ?? r.createdAt, undefined, nowDate)}
                  {r.attempts > 1 ? ` · ${r.attempts} attempts` : ""}
                </p>
                {r.lastError && <p className="mt-0.5 break-words text-xs font-semibold text-danger">{r.lastError}</p>}
              </div>
              {r.status === "failed" && (
                <button type="button" className="btn-secondary min-h-11 shrink-0" disabled={pending} aria-busy={pending && busyId === r.id} onClick={() => retry(r.id)}>
                  {pending && busyId === r.id ? "Queuing…" : "Retry"}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <div aria-live="polite">{error && <p className="text-sm font-semibold text-danger" role="alert">{error}</p>}</div>
    </div>
  );
}
