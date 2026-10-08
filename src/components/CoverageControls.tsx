"use client";

import { useCoverageQueue } from "@/hooks/useCoverageQueue";
import { displayedDone, type CommandState, type CoverageKind } from "@/lib/offline/coverage-queue";
import { cn } from "@/lib/utils";
import { CheckIcon } from "./icons";

type Props = {
  athleteId: string;
  photosDoneAt: string | null;
  videosDoneAt: string | null;
  /** Whether the current viewer may toggle each kind (assigned collaborator or owner). */
  canPhoto?: boolean;
  canVideo?: boolean;
  size?: "sm" | "md";
};

const STATE_LABEL: Record<CommandState | "synced", string> = { synced: "", pending: "Pending sync", saved: "Saved", failed: "Failed, will retry", conflict: "Conflict" };

/**
 * Separate Photos done and Video done toggles, offline-first. A tap records a
 * desired-state command (persisted before anything is sent); the sync loop
 * replays it through the server, which re-checks the session and assignment.
 * States: Pending sync → Saved, or Failed (retries) / Conflict (someone else
 * changed it — pick mine or theirs). Completion is independent of the match
 * status and survives source refreshes.
 */
export function CoverageControls({ athleteId, photosDoneAt, videosDoneAt, canPhoto = true, canVideo = true, size = "md" }: Props) {
  const { queue, setDone, resolveConflict, retryNow } = useCoverageQueue();
  const photo = displayedDone(queue, athleteId, "photo", photosDoneAt);
  const video = displayedDone(queue, athleteId, "video", videosDoneAt);

  function toggle(kind: CoverageKind) {
    const view = kind === "photo" ? photo : video;
    const serverDoneAt = kind === "photo" ? photosDoneAt : videosDoneAt;
    setDone(athleteId, kind, !view.done, serverDoneAt);
  }

  // Large touch targets: at least 44 px high on the board, 48 px on the client page.
  const base = cn("btn border font-semibold", size === "sm" ? "min-h-11 px-3 text-xs" : "min-h-12 px-4 text-sm");

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <Toggle label="Photos" view={photo} can={canPhoto} base={base} onClick={() => toggle("photo")} />
        <Toggle label="Video" view={video} can={canVideo} base={base} onClick={() => toggle("video")} />
      </div>
      {[photo, video].map((v) =>
        v.command && v.state === "conflict" ? (
          <div key={v.command.id} className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800" role="alert">
            <p className="font-semibold">{v.command.coverageKind === "photo" ? "Photos" : "Video"}: {v.command.error ?? "changed elsewhere"}. Currently {v.done ? "done" : "to do"} on the server; you tapped {v.command.done ? "done" : "to do"}.</p>
            <div className="mt-1 flex gap-2">
              <button type="button" className="btn-secondary min-h-9 px-3 text-xs" onClick={() => resolveConflict(v.command!, "mine")}>Apply mine</button>
              <button type="button" className="btn-ghost min-h-9 px-3 text-xs" onClick={() => resolveConflict(v.command!, "theirs")}>Keep theirs</button>
            </div>
          </div>
        ) : null,
      )}
      {[photo, video].some((v) => v.state === "failed") && (
        <p className="mt-1 text-xs font-semibold text-danger" role="status">
          Not saved yet. Kept on this device and retried automatically.{" "}
          <button type="button" className="underline" onClick={retryNow}>Retry now</button>
        </p>
      )}
    </div>
  );
}

function Toggle({ label, view, can, base, onClick }: { label: string; view: ReturnType<typeof displayedDone>; can: boolean; base: string; onClick: () => void }) {
  const state = STATE_LABEL[view.state];
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!can}
      aria-pressed={view.done}
      className={cn(base, view.done ? "border-success bg-success/15 text-success" : "border-line bg-white text-ink", !can && "opacity-50", view.state === "pending" && "border-dashed", view.state === "conflict" && "border-amber-400")}
    >
      <CheckIcon size={16} /> {label} {view.done ? "done" : "to do"}
      {state ? <span className={cn("ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider", view.state === "saved" ? "bg-success/20" : view.state === "pending" ? "bg-page text-muted" : view.state === "failed" ? "bg-danger-soft text-danger" : "bg-amber-100 text-amber-800")}>{state}</span> : null}
    </button>
  );
}
