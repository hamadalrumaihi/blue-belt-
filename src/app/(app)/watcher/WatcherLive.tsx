"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AlertBanners } from "@/components/AlertBanners";
import { EmptyState } from "@/components/EmptyState";
import { LiveToolbar } from "@/components/LiveToolbar";
import { MatchCard } from "@/components/MatchCard";
import { PlusIcon, SearchIcon, UsersIcon } from "@/components/icons";
import { useLiveAthletes } from "@/hooks/useLiveAthletes";
import { buildAlerts } from "@/lib/alerts";
import type { AthleteEta, EtaBucket } from "@/lib/eta";
import type { AthleteWithMatches, EventRow, HistoryEntry } from "@/lib/types";
import { cn } from "@/lib/utils";

type Props = { event: EventRow; athletes: AthleteWithMatches[]; history: HistoryEntry[] };

type QuickFilter = "all" | "upcoming" | "soon" | "on_mat" | "complete" | "none";
const QUICK: { id: QuickFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "upcoming", label: "Upcoming" },
  { id: "soon", label: "Soon" },
  { id: "on_mat", label: "On Mat" },
  { id: "complete", label: "Complete" },
  { id: "none", label: "No Match Found" },
];

const SOON: EtaBucket[] = ["30 MIN", "15 MIN", "5 MIN", "GO TO MAT"];

function passesQuick(entry: AthleteEta, f: QuickFilter): boolean {
  const b = entry.eta.bucket;
  switch (f) {
    case "all": return true;
    case "upcoming": return b === "UPCOMING" || SOON.includes(b);
    case "soon": return SOON.includes(b);
    case "on_mat": return b === "ON MAT";
    case "complete": return b === "COMPLETE";
    case "none": return !entry.match || b === "UNKNOWN";
  }
}

export function WatcherLive({ event, athletes: initialAthletes, history: initialHistory }: Props) {
  const { ranked, history, states, now, lastCheckedAt, refreshingAll, globalError, refresh, settings, connectivity } = useLiveAthletes({ initialAthletes, initialHistory });
  const tz = event.timezone || settings.timezone;
  const [query, setQuery] = useState("");
  const [quick, setQuick] = useState<QuickFilter>("all");
  const [mat, setMat] = useState("");
  const [academy, setAcademy] = useState("");
  const [platform, setPlatform] = useState("");

  const active = useMemo(() => ranked.filter((r) => r.athlete.active), [ranked]);
  const mats = useMemo(() => [...new Set(active.map((r) => r.match?.mat).filter((v): v is string => Boolean(v)))].sort(), [active]);
  const academies = useMemo(() => [...new Set(active.map((r) => r.athlete.academy).filter((v): v is string => Boolean(v)))].sort(), [active]);
  const platforms = useMemo(() => [...new Set(active.map((r) => r.athlete.platform))].sort(), [active]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return active.filter((r) => {
      if (!settings.showCompleted && r.eta.bucket === "COMPLETE" && quick !== "complete") return false;
      if (!passesQuick(r, quick)) return false;
      if (mat && r.match?.mat !== mat) return false;
      if (academy && r.athlete.academy !== academy) return false;
      if (platform && r.athlete.platform !== platform) return false;
      if (q) {
        const hay = [r.athlete.name, r.athlete.academy, r.athlete.division, r.match?.opponent, r.match?.mat, event.name].filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [active, quick, mat, academy, platform, query, settings.showCompleted, event.name]);

  const alerts = useMemo(() => (now ? buildAlerts(active, history, settings.notifications, now) : []), [active, history, settings.notifications, now]);
  const tracked = active.filter((r) => r.athlete.source_url).length;

  if (!active.length) {
    return (
      <EmptyState
        icon={<UsersIcon />}
        title="No clients added yet."
        description="Add each pre-booked athlete with their AJP or Smoothcomp link."
        action={<Link href={`/clients/new?event=${event.id}`} className="btn-primary"><PlusIcon size={18} /> Add First Client</Link>}
      />
    );
  }

  return (
    <div className="space-y-3">
      <AlertBanners alerts={alerts} />
      <div className="sticky top-14 z-10 -mx-4 space-y-2 bg-page/95 px-4 pb-2 pt-1 backdrop-blur lg:-mx-8 lg:px-8">
        <LiveToolbar lastCheckedAt={lastCheckedAt} refreshing={refreshingAll} onRefreshAll={() => refresh()} error={globalError} trackedCount={tracked} connectivity={connectivity} />
        <div className="relative">
          <SearchIcon size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search athlete, academy, division, opponent"
            className="input pl-10"
            aria-label="Search"
          />
        </div>
        <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-wrap lg:px-0" role="tablist" aria-label="Quick filters">
          {QUICK.map((f) => (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={quick === f.id}
              onClick={() => setQuick(f.id)}
              className={cn("min-h-9 shrink-0 rounded-full border px-3.5 text-xs font-bold", quick === f.id ? "border-primary bg-primary text-white" : "border-line bg-white text-ink")}
            >
              {f.label}
            </button>
          ))}
        </div>
        {(mats.length > 0 || academies.length > 1 || platforms.length > 1) && (
          <div className="grid grid-cols-3 gap-2">
            <select className="input min-h-10 py-0 text-xs" value={mat} onChange={(e) => setMat(e.target.value)} aria-label="Filter by mat">
              <option value="">All mats</option>
              {mats.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <select className="input min-h-10 py-0 text-xs" value={academy} onChange={(e) => setAcademy(e.target.value)} aria-label="Filter by academy">
              <option value="">All academies</option>
              {academies.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            <select className="input min-h-10 py-0 text-xs" value={platform} onChange={(e) => setPlatform(e.target.value)} aria-label="Filter by platform">
              <option value="">All platforms</option>
              {platforms.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
        )}
      </div>

      {visible.length === 0 ? (
        <EmptyState compact title="Nothing matches these filters" description="Clear the search or pick a different filter." />
      ) : (
        <ul className="space-y-2">
          {visible.map((entry) => (
            <li key={entry.athlete.id}>
              <MatchCard entry={entry} timezone={tz} state={states[entry.athlete.id]} onRefresh={() => refresh([entry.athlete.id])} now={now} />
            </li>
          ))}
        </ul>
      )}
      <p className="pt-2 text-center text-[11px] text-muted">Sorted: On mat → Go to mat → nearest ETA → later → no match.</p>
    </div>
  );
}
