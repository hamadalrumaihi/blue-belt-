"use client";

import Link from "next/link";
import { useState } from "react";
import { Logo } from "@/components/Logo";
import { StatusBadge } from "@/components/StatusBadge";
import { ShieldIcon } from "@/components/icons";
import { useSettings } from "@/hooks/useSettings";
import { comingSoonChannels } from "@/lib/notifications/channels";
import { REFRESH_INTERVAL_OPTIONS, type NotificationPrefs } from "@/lib/settings";
import { isValidTimeZone } from "@/lib/time";
import { PLATFORMS } from "@/lib/types";
import { cn } from "@/lib/utils";

const NOTIF: { key: keyof NotificationPrefs; label: string }[] = [
  { key: "m30", label: "30 minutes before" },
  { key: "m15", label: "15 minutes before" },
  { key: "m5", label: "5 minutes before" },
  { key: "matChange", label: "Mat change" },
  { key: "timeChange", label: "Time change" },
];

export function SettingsForm() {
  const [settings, update] = useSettings();
  const [tz, setTz] = useState(settings.timezone);
  const [tzError, setTzError] = useState<string | null>(null);
  const [seenTz, setSeenTz] = useState(settings.timezone);
  if (seenTz !== settings.timezone) {
    // Settings hydrate from localStorage after mount; adopt the stored value.
    setSeenTz(settings.timezone);
    setTz(settings.timezone);
  }

  function commitTz() {
    if (!isValidTimeZone(tz)) {
      setTzError("Unknown timezone. Use an IANA name such as Asia/Qatar.");
      return;
    }
    setTzError(null);
    update({ timezone: tz });
  }

  return (
    <div className="space-y-4">
      <section className="card space-y-4 p-5">
        <h2 className="text-sm font-extrabold uppercase tracking-wider text-muted">General</h2>
        <div>
          <label htmlFor="timezone" className="label">Default timezone</label>
          <div className="flex gap-2">
            <input id="timezone" className="input" value={tz} onChange={(e) => setTz(e.target.value)} onBlur={commitTz} />
            <button type="button" className="btn-secondary" onClick={commitTz}>Save</button>
          </div>
          {tzError ? <p className="mt-1 text-xs font-semibold text-danger">{tzError}</p> : <p className="hint">Events carry their own timezone; this is the fallback.</p>}
        </div>
        <div>
          <label htmlFor="interval" className="label">Auto-refresh interval</label>
          <select id="interval" className="input" value={settings.autoRefreshSeconds} onChange={(e) => update({ autoRefreshSeconds: Number(e.target.value) })}>
            {REFRESH_INTERVAL_OPTIONS.map((s) => <option key={s} value={s}>{s} seconds</option>)}
          </select>
          <p className="hint">Requests are staggered so many clients never hit the source at once.</p>
        </div>
        <Toggle label="Auto-refresh on" checked={settings.autoRefreshEnabled} onChange={(v) => update({ autoRefreshEnabled: v })} />
        <div>
          <label htmlFor="platform" className="label">Default platform</label>
          <select id="platform" className="input" value={settings.defaultPlatform} onChange={(e) => update({ defaultPlatform: e.target.value as typeof settings.defaultPlatform })}>
            {PLATFORMS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </div>
        <Toggle label="Show completed matches" checked={settings.showCompleted} onChange={(v) => update({ showCompleted: v })} />
      </section>

      <section className="card space-y-4 p-5">
        <h2 className="text-sm font-extrabold uppercase tracking-wider text-muted">Branding</h2>
        <div className="flex items-center gap-4 rounded-2xl bg-navy p-4">
          <Logo inverted size={52} href={null} />
        </div>
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-line p-4">
          <Logo size={40} href={null} />
          <div className="ml-auto flex flex-wrap gap-1.5">
            <StatusBadge bucket="UPCOMING" size="sm" />
            <StatusBadge bucket="15 MIN" size="sm" />
            <StatusBadge bucket="5 MIN" size="sm" />
            <StatusBadge bucket="GO TO MAT" size="sm" />
          </div>
        </div>
        <p className="hint">Logo file: <code>/public/brand/logo.svg</code>. Replace it to update the app everywhere.</p>
      </section>

      <section className="card space-y-3 p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-extrabold uppercase tracking-wider text-muted">Notifications</h2>
          <span className="rounded-md bg-lightblue px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">In-app banners</span>
        </div>
        {NOTIF.map((n) => (
          <Toggle key={n.key} label={n.label} checked={settings.notifications[n.key]} onChange={(v) => update({ notifications: { ...settings.notifications, [n.key]: v } })} />
        ))}
        <div className="mt-2 rounded-xl border border-dashed border-line p-3">
          <p className="text-xs font-bold uppercase tracking-wider text-muted">Coming Soon</p>
          <ul className="mt-2 space-y-1.5">
            {comingSoonChannels.map((c) => (
              <li key={c.id} className="flex items-center justify-between text-sm text-muted">
                <span>{c.label}</span>
                <span className="rounded-md bg-page px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider">Coming Soon</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <Link href="/settings/danger" className="card flex items-center gap-3 border-danger/30 p-4 text-sm font-bold text-danger hover:bg-danger-soft/40">
        <ShieldIcon /> Danger zone / delete management
      </Link>
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="flex min-h-11 w-full items-center justify-between rounded-xl border border-line px-3 text-left text-sm font-semibold text-ink">
      {label}
      <span className={cn("relative inline-block h-6 w-11 rounded-full transition-colors", checked ? "bg-primary" : "bg-line")}>
        <span className={cn("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform", checked ? "translate-x-5" : "translate-x-0.5")} />
      </span>
    </button>
  );
}
