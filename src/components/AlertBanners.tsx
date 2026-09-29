"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import type { AppAlert } from "@/lib/notifications/types";
import { AlertIcon, CloseIcon } from "./icons";
import { cn } from "@/lib/utils";

const DISMISS_KEY = "bbm.dismissedAlerts.v1";
const EMPTY: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();
let cache: ReadonlySet<string> | null = null;

function readDismissed(): ReadonlySet<string> {
  if (cache) return cache;
  try {
    const raw = window.sessionStorage.getItem(DISMISS_KEY);
    cache = new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    cache = new Set();
  }
  return cache;
}

function dismissAlert(id: string) {
  const next = new Set(readDismissed());
  next.add(id);
  cache = next;
  try {
    window.sessionStorage.setItem(DISMISS_KEY, JSON.stringify([...next]));
  } catch {
    /* private mode: keep in memory */
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const LEVEL: Record<AppAlert["level"], string> = {
  danger: "bg-danger text-white",
  warning: "bg-warning text-white",
  info: "bg-primary text-white",
};

/** Strong in-app alert banners for thresholds and detected changes. */
export function AlertBanners({ alerts, max = 3 }: { alerts: AppAlert[]; max?: number }) {
  const dismissed = useSyncExternalStore(subscribe, readDismissed, () => EMPTY);
  const visible = alerts.filter((a) => !dismissed.has(a.id)).slice(0, max);
  if (!visible.length) return null;

  return (
    <div className="space-y-2" aria-live="assertive">
      {visible.map((a) => (
        <div key={a.id} className={cn("flex items-center gap-3 rounded-2xl px-4 py-3 shadow-card", LEVEL[a.level])}>
          <AlertIcon className="shrink-0" />
          <Link href={a.athleteId ? `/clients/${a.athleteId}` : "/watcher"} className="min-w-0 flex-1">
            <p className="truncate text-sm font-extrabold uppercase tracking-wide">{a.title}</p>
            <p className="truncate text-xs opacity-90">{a.body}</p>
          </Link>
          <button type="button" onClick={() => dismissAlert(a.id)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full hover:bg-white/15" aria-label="Dismiss alert">
            <CloseIcon size={18} />
          </button>
        </div>
      ))}
    </div>
  );
}
