"use client";

import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { CoverageControls } from "@/components/CoverageControls";
import { SourceLinkButton } from "@/components/SourceLinkButton";
import { formatTime } from "@/lib/time";
import type { CollaboratorBoardRow, CollaboratorEventRow } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";

type Props = { events: CollaboratorEventRow[]; selectedId: string; rows: CollaboratorBoardRow[]; timezone: string };

type Athlete = {
  athlete_id: string;
  athlete_name: string;
  division: string | null;
  source_url: string | null;
  assigned_photo: boolean;
  assigned_video: boolean;
  photos_done_at: string | null;
  videos_done_at: string | null;
  matches: CollaboratorBoardRow[];
};

/** Groups the per-match board rows by athlete and shows each client's next mat/time plus done controls. */
export function CoverageBoard({ events, selectedId, rows, timezone }: Props) {
  const router = useRouter();
  const athletes = useMemo(() => groupByAthlete(rows), [rows]);

  return (
    <div className="space-y-4">
      {events.length > 1 && (
        <label className="block">
          <span className="label">Event</span>
          <select className="input" value={selectedId} onChange={(e) => router.push(`/coverage?event=${e.target.value}`)}>
            {events.map((e) => (
              <option key={e.event_id} value={e.event_id}>{e.name}</option>
            ))}
          </select>
        </label>
      )}

      {athletes.length === 0 ? (
        <p className="card p-4 text-sm text-muted">No clients are assigned to you for this event yet.</p>
      ) : (
        <ul className="space-y-3">
          {athletes.map((a) => {
            const next = a.matches.find((m) => m.status !== "complete") ?? a.matches[0];
            return (
              <li key={a.athlete_id} className="card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-base font-extrabold text-ink">{a.athlete_name}</p>
                    {a.division && <p className="truncate text-xs text-muted">{a.division}</p>}
                  </div>
                  <div className="flex gap-1 text-[11px] font-bold">
                    {a.assigned_photo && <span className="rounded-full bg-lightblue px-2 py-0.5 text-primary">Photo</span>}
                    {a.assigned_video && <span className="rounded-full bg-lightblue px-2 py-0.5 text-primary">Video</span>}
                  </div>
                </div>
                {next && (next.mat || next.scheduled_at) ? (
                  <p className={cn("mt-2 text-sm font-semibold", next.status === "on_mat" ? "text-danger" : "text-ink")}>
                    {next.mat ?? "Mat –"}
                    {next.scheduled_at ? ` · ${formatTime(next.scheduled_at, timezone)}` : ""}
                    {next.opponent ? ` · vs ${next.opponent}` : ""}
                  </p>
                ) : (
                  <p className="mt-2 text-sm text-muted">No scheduled match yet.</p>
                )}
                <div className="mt-3">
                  <CoverageControls
                    athleteId={a.athlete_id}
                    photosDoneAt={a.photos_done_at}
                    videosDoneAt={a.videos_done_at}
                    canPhoto={a.assigned_photo}
                    canVideo={a.assigned_video}
                    size="sm"
                  />
                </div>
                {a.source_url && (
                  <div className="mt-3">
                    <SourceLinkButton url={a.source_url} size="sm" />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function groupByAthlete(rows: CollaboratorBoardRow[]): Athlete[] {
  const map = new Map<string, Athlete>();
  for (const r of rows) {
    let a = map.get(r.athlete_id);
    if (!a) {
      a = {
        athlete_id: r.athlete_id,
        athlete_name: r.athlete_name,
        division: r.division,
        source_url: r.source_url,
        assigned_photo: r.assigned_photo,
        assigned_video: r.assigned_video,
        photos_done_at: r.photos_done_at,
        videos_done_at: r.videos_done_at,
        matches: [],
      };
      map.set(r.athlete_id, a);
    }
    if (r.match_id) a.matches.push(r);
  }
  return [...map.values()];
}
