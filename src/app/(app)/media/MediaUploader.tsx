"use client";

import { useCallback, useRef, useState, type DragEvent } from "react";
import { ACCEPT_ATTRIBUTE } from "@/lib/media/mime";
import { formatBytes } from "@/lib/media/rules";
import type { MediaAsset } from "@/lib/media/types";
import { cn } from "@/lib/utils";
import { runUpload, type UploadItem, type UploadStage } from "./upload-client";

const STAGE_LABEL: Record<UploadStage, string> = {
  queued: "Queued",
  hashing: "Fingerprinting",
  signing: "Authorising",
  uploading: "Uploading",
  processing: "Making web copies",
  done: "Ready",
  duplicate: "Already in the library",
  failed: "Failed",
};

const PARALLEL = 2;

/**
 * Batch uploader: drag/drop or pick; each file runs hash → sign → direct
 * upload → process, two at a time, with its own progress and error. A
 * failed file can be retried; a duplicate is reported, not uploaded again.
 */
export function MediaUploader({ onAsset }: { onAsset: (asset: MediaAsset) => void }) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const running = useRef(0);
  const queue = useRef<string[]>([]);

  const update = useCallback((key: string, patch: Partial<UploadItem>) => {
    setItems((list) => list.map((i) => (i.key === key ? { ...i, ...patch } : i)));
  }, []);

  const pump = useCallback(() => {
    while (running.current < PARALLEL && queue.current.length) {
      const key = queue.current.shift() as string;
      running.current++;
      setItems((list) => {
        const item = list.find((i) => i.key === key);
        if (!item) {
          running.current--;
          return list;
        }
        void runUpload(item.file, (stage, progress) => update(key, { stage, progress }))
          .then((out) => {
            update(key, { stage: out.stage, progress: out.stage === "failed" ? 0 : 1, message: out.message, asset: out.asset, assetId: out.assetId });
            if (out.asset) onAsset(out.asset);
          })
          .catch((err: unknown) => update(key, { stage: "failed", progress: 0, message: err instanceof Error ? err.message : String(err) }))
          .finally(() => {
            running.current--;
            pump();
          });
        return list;
      });
    }
  }, [onAsset, update]);

  const add = useCallback(
    (files: FileList | File[]) => {
      const fresh: UploadItem[] = [...files].map((file) => ({ key: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`, file, stage: "queued", progress: 0, message: null, asset: null, assetId: null }));
      if (!fresh.length) return;
      setItems((list) => [...fresh, ...list]);
      queue.current.push(...fresh.map((f) => f.key));
      // Let React commit the new items before the runner looks them up.
      setTimeout(pump, 0);
    },
    [pump],
  );

  function retry(key: string) {
    update(key, { stage: "queued", progress: 0, message: null });
    queue.current.push(key);
    setTimeout(pump, 0);
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    add(e.dataTransfer.files);
  }

  const active = items.filter((i) => !["done", "duplicate", "failed"].includes(i.stage)).length;

  return (
    <section aria-labelledby="upload-h" className="card p-4 sm:p-5">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="upload-h" className="text-base font-extrabold text-ink">Upload photographs</h2>
          <p className="mt-1 text-sm text-muted">JPEG first (sRGB, 2560 to 4000 px long edge). PNG, WebP, TIFF and HEIC are accepted; GIF, SVG and video are not. Up to 40 MB each; at least 1200 px.</p>
        </div>
        {items.length > 0 && (
          <button type="button" className="btn-ghost min-h-9 text-xs" onClick={() => setItems((l) => l.filter((i) => !["done", "duplicate"].includes(i.stage)))}>Clear finished</button>
        )}
      </div>
      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn("mt-3 flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-6 text-center text-sm", dragging ? "border-primary bg-lightblue" : "border-line bg-page hover:border-primary/60")}
      >
        <p className="font-semibold text-ink">Drop photographs here, or click to choose</p>
        <p className="mt-1 text-xs text-muted">{active ? `${active} in progress` : "Files go straight from your browser to private storage; the site shows nothing until you publish."}</p>
        <input ref={inputRef} type="file" accept={ACCEPT_ATTRIBUTE} multiple className="sr-only" onChange={(e) => e.target.files && add(e.target.files)} />
      </div>
      {items.length > 0 && (
        <ul className="mt-3 divide-y divide-line">
          {items.map((i) => (
            <li key={i.key} className="flex items-center gap-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-ink">{i.file.name} <span className="font-normal text-muted">· {formatBytes(i.file.size)}</span></p>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-line" aria-hidden>
                  <div className={cn("h-full rounded-full transition-all", i.stage === "failed" ? "bg-danger" : i.stage === "duplicate" ? "bg-warning" : "bg-primary")} style={{ width: `${Math.round(Math.max(i.stage === "failed" ? 1 : 0.04, i.progress) * 100)}%` }} />
                </div>
                <p className={cn("mt-1 text-xs", i.stage === "failed" ? "font-semibold text-danger" : "text-muted")} role={i.stage === "failed" ? "alert" : undefined}>{STAGE_LABEL[i.stage]}{i.message ? ` · ${i.message}` : ""}</p>
              </div>
              {i.stage === "failed" && <button type="button" className="btn-secondary min-h-9 text-xs" onClick={() => retry(i.key)}>Retry</button>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
