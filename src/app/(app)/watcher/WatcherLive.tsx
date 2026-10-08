"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AlertBanners } from "@/components/AlertBanners";
import { EmptyState } from "@/components/EmptyState";
import { LiveToolbar } from "@/components/LiveToolbar";
import { MatchCard } from "@/components/MatchCard";
import { AlertIcon, PlusIcon, SearchIcon, UsersIcon } from "@/components/icons";
import { useLiveAthletes } from "@/hooks/useLiveAthletes";
import { buildAlerts } from "@/lib/alerts";
import type { AthleteEta, EtaBucket } from "@/lib/eta";
import { needsAttention, sourceHealth, type WatchAttention } from "@/lib/source-health";
import { isManualEvent, type AthleteWithMatches, type EventRow, type HistoryEntry } from "@/lib/types";
import { cn } from "@/lib/utils";

type Props = { event: EventRow; athletes: AthleteWithMatches[]; history: HistoryEntry[] };

type QuickFilter = "all" | "attention" | "upcoming" | "soon" | "on_mat" | "complete" | "none";
const QUICK: { id: QuickFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "attention", label: "Needs attention" },
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
    case "attention": return true; // filtered by health in WatcherLive
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
  const manual = isManualEvent(event);
  const [query, setQuery] = useState("");
  const [quick, setQuick] = useState<QuickFilter>("all");
  const [mat, setMat] = useState("");
  const [academy, setAcademy] = useState("");
  const [platform, setPlatform] = useState("");

  const active = useMemo(() => ranked.filter((r) => r.athlete.active), [ranked]);
  const pausedCount = ranked.length - active.length;
  // Health is derived on the client only (it depends on "now"), so the first render matches the server.
  const attentionById = useMemo(() => {
    const map = new Map<string, WatchAttention>();
    if (!now || manual) return map;
    for (const r of active) {
      if (!r.athlete.source_url) continue;
      const h = sourceHealth(r.athlete, now, r.athlete.matches.length > 0);
      if (needsAttention(h)) map.set(r.athlete.id, h.attention);
    }
    return map;
  }, [active, now, manual]);
  const mats = useMemo(() => [...new Set(active.map((r) => r.match?.mat).filter((v): v is string => Boolean(v)))].sort(), [active]);
  const academies = useMemo(() => [...new Set(active.map((r) => r.athlete.academy).filter((v): v is string => Boolean(v)))].sort(), [active]);
  const platforms = useMemo(() => [...new Set(active.map((r) => r.athlete.platform))].sort(), [active]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return active.filter((r) => {
      if (!settings.showCompleted && r.eta.bucket === "COMPLETE" && quick !== "complete") return false;
      if (!passesQuick(r, quick)) return false;
      if (quick === "attention" && !attentionById.has(r.athlete.id)) return false;
      if (mat && r.match?.mat !== mat) return false;
      if (academy && r.athlete.academy !== academy) return false;
      if (platform && r.athlete.platform !== platform) return false;
      if (q) {
        const hay = [r.athlete.name, r.athlete.academy, r.athlete.division, r.match?.opponent, r.match?.mat, event.name].filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [active, quick, mat, academy, platform, query, settings.showCompleted, event.name, attentionById]);

  const alerts = useMemo(() => (now ? buildAlerts(active, history, settings.notifications, now) : []), [active, history, settings.notifications, now]);
  const tracked = active.filter((r) => r.athlete.source_url).length;

  if (!active.length && pausedCount > 0) {
    return (
      <EmptyState
        icon={<UsersIcon />}
        title="Every client for this event is paused."
        description={`${pausedCount} paused ${pausedCount === 1 ? "client is" : "clients are"} not being checked. Resume a client from their page to watch them again.`}
        action={<Link href={`/clients?event=${event.id}&paused=1`} className="btn-primary">Show paused clients</Link>}
      />
    );
  }

  if (!active.length) {
    return (
      <EmptyState
        icon={<UsersIcon />}
        title="No clients added yet."
        description={manual ? "Add each athlete by name; this event is tracked by hand, so no link is needed." : "Add each pre-booked athlete with their AJP or Smoothcomp link."}
        action={<Link href={`/clients/new?event=${event.id}`} className="btn-primary"><PlusIcon size={18} /> Add First Client</Link>}
      />
    );
  }

  return (
    <div className="space-y-3">
      <AlertBanners alerts={alerts} />
      {attentionById.size > 0 && quick !== "attention" && (
        <div className="card flex flex-wrap items-center gap-x-3 gap-y-2 border-danger/30 px-4 py-3" role="status">
          <AlertIcon size={18} className="shrink-0 text-danger" aria-hidden />
          <p className="min-w-0 flex-1 text-sm text-ink">
            <span className="font-bold">{attentionById.size} {attentionById.size === 1 ? "watch needs" : "watches need"} attention</span>
            <span className="text-muted">: {summarizeAttention(attentionById)}</span>
          </p>
          <button type="button" className="btn-secondary min-h-9 px-3 text-xs" onClick={() => setQuick("attention")}>Show them</button>
        </div>
      )}
      <div className="sticky top-14 z-10 -mx-4 space-y-2 bg-page/95 px-4 pb-2 pt-1 backdrop-blur lg:-mx-8 lg:px-8">
        <LiveToolbar lastCheckedAt={lastCheckedAt} refreshing={refreshingAll} onRefreshAll={() => refresh()} error={globalError} trackedCount={tracked} connectivity={connectivity} manual={manual} />
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
              {f.id === "attention" && attentionById.size > 0 ? ` (${attentionById.size})` : ""}
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
        quick === "attention" ? (
          <EmptyState compact title="All watches are healthy" description="Every tracked client was confirmed from its source recently." />
        ) : (
          <EmptyState compact title="Nothing matches these filters" description="Clear the search or pick a different filter." />
        )
      ) : (
        <ul className="space-y-2">
          {visible.map((entry) => (
            <li key={entry.athlete.id}>
              <MatchCard entry={entry} timezone={tz} state={states[entry.athlete.id]} onRefresh={() => refresh([entry.athlete.id])} now={now} manual={manual} />
            </li>
          ))}
        </ul>
      )}
      <p className="pt-2 text-center text-[11px] text-muted">
        Sorted: On mat → Go to mat → nearest ETA → later → no match.
        {pausedCount > 0 && (
          <>
            {" "}
            <Link href={`/clients?event=${event.id}&paused=1`} className="font-semibold text-primary hover:underline">
              {pausedCount} paused {pausedCount === 1 ? "client" : "clients"} not shown
            </Link>
            .
          </>
        )}
      </p>
    </div>
  );
}

const ATTENTION_LABEL: Record<WatchAttention, string> = {
  blocked: "blocked by an anti-bot check",
  failing: "last check failed",
  not_found: "athlete not on the page",
  stale: "not confirmed for 10+ min",
  ok: "",
  unchecked: "",
};

/** "1 blocked by an anti-bot check, 2 last check failed" — text, so the state never rests on colour. */
function summarizeAttention(map: Map<string, WatchAttention>): string {
  const counts = new Map<WatchAttention, number>();
  for (const a of map.values()) counts.set(a, (counts.get(a) ?? 0) + 1);
  return (["blocked", "failing", "not_found", "stale"] as const)
    .filter((k) => counts.get(k))
    .map((k) => `${counts.get(k)} ${ATTENTION_LABEL[k]}`)
    .join(", ");
}
