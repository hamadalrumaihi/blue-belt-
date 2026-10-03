"use client";

import { useState, useTransition } from "react";
import { setCoverageDone, type CoverageKind } from "@/lib/actions/coverage";
import { CheckIcon } from "./icons";
import { cn } from "@/lib/utils";

type Props = {
  athleteId: string;
  photosDoneAt: string | null;
  videosDoneAt: string | null;
  /** Whether the current viewer may toggle each kind (assigned collaborator or owner). */
  canPhoto?: boolean;
  canVideo?: boolean;
  size?: "sm" | "md";
};

/**
 * Separate Photos done and Video done toggles. Tapping marks done (records who
 * and when server-side); tapping again undoes it. Completion is independent of
 * the competition match status and survives source refreshes.
 */
export function CoverageControls({ athleteId, photosDoneAt, videosDoneAt, canPhoto = true, canVideo = true, size = "md" }: Props) {
  const [photos, setPhotos] = useState<boolean>(Boolean(photosDoneAt));
  const [videos, setVideos] = useState<boolean>(Boolean(videosDoneAt));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle(kind: CoverageKind) {
    setError(null);
    const current = kind === "photo" ? photos : videos;
    const next = !current;
    if (kind === "photo") setPhotos(next);
    else setVideos(next);
    startTransition(async () => {
      const res = await setCoverageDone(athleteId, kind, next);
      if (!res.ok) {
        setError(res.error);
        if (kind === "photo") setPhotos(current);
        else setVideos(current);
      }
    });
  }

  const base = cn("btn border font-semibold", size === "sm" ? "min-h-9 px-3 text-xs" : "min-h-11 px-4 text-sm");

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => toggle("photo")}
          disabled={pending || !canPhoto}
          aria-pressed={photos}
          className={cn(base, photos ? "border-success bg-success/15 text-success" : "border-line bg-white text-ink", !canPhoto && "opacity-50")}
        >
          <CheckIcon size={16} /> Photos {photos ? "done" : "to do"}
        </button>
        <button
          type="button"
          onClick={() => toggle("video")}
          disabled={pending || !canVideo}
          aria-pressed={videos}
          className={cn(base, videos ? "border-success bg-success/15 text-success" : "border-line bg-white text-ink", !canVideo && "opacity-50")}
        >
          <CheckIcon size={16} /> Video {videos ? "done" : "to do"}
        </button>
      </div>
      {error && <p className="mt-1 text-xs font-semibold text-danger" role="alert">{error}</p>}
    </div>
  );
}
