"use client";

import { useState, useTransition, type MouseEvent } from "react";
import { AlertIcon, CheckIcon, ExternalIcon } from "@/components/icons";
import { updateMediaMeta } from "@/lib/actions/media";
import { formatBytes, publishBlocker } from "@/lib/media/rules";
import { MEDIA_CATEGORIES, MEDIA_CATEGORY_LABEL, MEDIA_STATUS_LABEL, type MediaAsset } from "@/lib/media/types";
import { cn } from "@/lib/utils";

type Props = {
  asset: MediaAsset;
  selected: boolean;
  onSelect: (id: string, on: boolean) => void;
  onChange: (asset: MediaAsset) => void;
  onAction: (action: "publish" | "unpublish" | "archive" | "restore" | "retry", id: string) => void;
  busy: boolean;
};

const STATUS_TONE: Record<MediaAsset["status"], string> = {
  draft: "bg-page text-muted border-line",
  processing: "bg-lightblue text-primary border-primary/20",
  ready: "bg-lightblue text-primary border-primary/20",
  published: "bg-success-soft text-success border-success/30",
  archived: "bg-page text-muted border-line",
  failed: "bg-danger-soft text-danger border-danger/30",
};

/**
 * One photograph in the grid: thumbnail with flags, quick actions, and an
 * inline editor for alt, caption, category, tags, focal point (click the
 * picture), sort order, date and the owner's two confirmations.
 */
export function AssetCard({ asset, selected, onSelect, onChange, onAction, busy }: Props) {
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState({ alt: asset.alt, caption: asset.caption ?? "", category: asset.category, tags: asset.tags.join(", "), sort_order: String(asset.sortOrder), taken_on: asset.takenOn ?? "", review_note: asset.reviewNote ?? "" });

  const blocker = publishBlocker({ status: asset.status, rights_confirmed: asset.rightsConfirmed, needs_review: asset.needsReview, guardian_ok: asset.guardianOk, derivatives: asset.derivatives });

  function save(patch: Record<string, unknown>) {
    setError(null);
    start(async () => {
      const res = await updateMediaMeta(asset.id, patch);
      if (!res.ok) setError(res.error);
      else onChange(res.asset);
    });
  }

  function saveDraft() {
    const sort = Number(draft.sort_order);
    save({
      alt: draft.alt,
      caption: draft.caption || null,
      category: draft.category,
      tags: draft.tags.split(",").map((t) => t.trim()).filter(Boolean),
      sort_order: Number.isInteger(sort) ? sort : 0,
      taken_on: draft.taken_on || null,
      review_note: draft.review_note || null,
    });
  }

  function setFocal(e: MouseEvent<HTMLElement>) {
    if (!editing) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    save({ focal: { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) } });
  }

  const disabled = busy || pending;

  return (
    <li className={cn("card overflow-hidden", selected && "ring-2 ring-primary", asset.status === "archived" && "opacity-70")}>
      <div className={cn("relative block aspect-[4/3] w-full overflow-hidden bg-navy", editing && asset.thumbUrl && "cursor-crosshair")} onClick={setFocal} title={editing ? "Click to set the focal point" : undefined}>
        {asset.thumbUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- public derivative; sized by the grid, no optimizer config needed here
          <img src={asset.thumbUrl} alt={asset.alt || "Photograph"} className="h-full w-full object-cover" style={{ objectPosition: `${Math.round(asset.focal.x * 100)}% ${Math.round(asset.focal.y * 100)}%` }} loading="lazy" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-white/70">{asset.status === "failed" ? "No web copy" : MEDIA_STATUS_LABEL[asset.status]}</div>
        )}
        {asset.thumbUrl && (
          <span aria-hidden className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow" style={{ left: `${asset.focal.x * 100}%`, top: `${asset.focal.y * 100}%` }} />
        )}
        <label className="absolute left-2 top-2 flex items-center gap-1 rounded-md bg-black/60 px-1.5 py-1 text-[11px] font-bold text-white" onClick={(e) => e.stopPropagation()}>
          <input type="checkbox" checked={selected} onChange={(e) => onSelect(asset.id, e.target.checked)} aria-label="Select" /> Select
        </label>
        <span className={cn("absolute right-2 top-2 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide", STATUS_TONE[asset.status])}>{MEDIA_STATUS_LABEL[asset.status]}</span>
        {asset.needsReview && !asset.guardianOk && <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-md bg-warning px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white"><AlertIcon size={12} /> Review</span>}
        {asset.previewUrl && (
          <a href={asset.previewUrl} target="_blank" rel="noopener noreferrer" className="absolute bottom-2 right-2 rounded-md bg-black/60 p-1.5 text-white" aria-label="Open the largest web copy in a new tab" onClick={(e) => e.stopPropagation()}><ExternalIcon size={14} /></a>
        )}
      </div>

      <div className="space-y-2 p-2.5">
        <p className="truncate text-xs text-muted" title={asset.alt}>{MEDIA_CATEGORY_LABEL[asset.category]}{asset.width && asset.height ? ` · ${asset.width}×${asset.height}` : ""} · {formatBytes(asset.originalBytes)}{asset.source !== "web_upload" ? ` · ${asset.source === "cli_import" ? "import" : "manifest"}` : ""}</p>
        {asset.alt ? <p className="line-clamp-2 text-xs text-ink">{asset.alt}</p> : <p className="text-xs font-semibold text-warning">No alt text yet</p>}
        {asset.error && asset.status === "failed" && <p className="rounded-lg bg-danger-soft px-2 py-1 text-xs font-semibold text-danger" role="alert">{asset.error}</p>}

        <div className="flex flex-wrap gap-1.5 text-xs">
          <label className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-1", asset.rightsConfirmed ? "border-success/30 bg-success-soft text-success" : "border-line text-ink")}>
            <input type="checkbox" checked={asset.rightsConfirmed} disabled={disabled} onChange={(e) => save({ rights_confirmed: e.target.checked })} /> I hold the rights
          </label>
          {asset.needsReview && (
            <label className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-1", asset.guardianOk ? "border-success/30 bg-success-soft text-success" : "border-warning/40 bg-warning-soft text-warning")}>
              <input type="checkbox" checked={asset.guardianOk} disabled={disabled} onChange={(e) => save({ guardian_ok: e.target.checked })} /> Permission confirmed
            </label>
          )}
        </div>
        {asset.reviewNote && asset.needsReview && <p className="text-[11px] text-muted">{asset.reviewNote}</p>}

        <div className="flex flex-wrap gap-1.5">
          {asset.status === "ready" && <button type="button" className="btn-primary min-h-9 px-2 text-xs" disabled={disabled || Boolean(blocker)} title={blocker ?? undefined} onClick={() => onAction("publish", asset.id)}><CheckIcon size={14} /> Publish</button>}
          {asset.status === "published" && <button type="button" className="btn-secondary min-h-9 px-2 text-xs" disabled={disabled} onClick={() => onAction("unpublish", asset.id)}>Unpublish</button>}
          {asset.status === "failed" && <button type="button" className="btn-secondary min-h-9 px-2 text-xs" disabled={disabled} onClick={() => onAction("retry", asset.id)}>Retry</button>}
          {(asset.status === "ready" || asset.status === "published" || asset.status === "failed") && <button type="button" className="btn-ghost min-h-9 px-2 text-xs" disabled={disabled} onClick={() => onAction("archive", asset.id)}>Archive</button>}
          {asset.status === "archived" && <button type="button" className="btn-secondary min-h-9 px-2 text-xs" disabled={disabled} onClick={() => onAction("restore", asset.id)}>Restore</button>}
          <button type="button" className="btn-ghost min-h-9 px-2 text-xs" onClick={() => setEditing((v) => !v)} aria-expanded={editing}>{editing ? "Close" : "Edit"}</button>
        </div>
        {blocker && asset.status === "ready" && <p className="text-[11px] text-muted">{blocker}</p>}
        {error && <p className="text-xs font-semibold text-danger" role="alert">{error}</p>}

        {editing && (
          <div className="space-y-2 border-t border-line pt-2">
            <p className="text-[11px] text-muted">Click the picture to set the focal point (now {Math.round(asset.focal.x * 100)}%, {Math.round(asset.focal.y * 100)}%).</p>
            <label className="label text-xs">Alt text (what is visible; no names)
              <textarea className="input mt-1 min-h-16 text-sm" value={draft.alt} maxLength={300} onChange={(e) => setDraft({ ...draft, alt: e.target.value })} />
            </label>
            <label className="label text-xs">Caption (optional, shown on the Work page)
              <input className="input mt-1 min-h-9 text-sm" value={draft.caption} maxLength={500} onChange={(e) => setDraft({ ...draft, caption: e.target.value })} />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="label text-xs">Category
                <select className="input mt-1 min-h-9 text-sm" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value as MediaAsset["category"] })}>
                  {MEDIA_CATEGORIES.map((c) => (
                    <option key={c} value={c}>{MEDIA_CATEGORY_LABEL[c]}</option>
                  ))}
                </select>
              </label>
              <label className="label text-xs">Sort order
                <input className="input mt-1 min-h-9 text-sm" type="number" step={1} value={draft.sort_order} onChange={(e) => setDraft({ ...draft, sort_order: e.target.value })} />
              </label>
            </div>
            <label className="label text-xs">Tags (comma separated)
              <input className="input mt-1 min-h-9 text-sm" value={draft.tags} onChange={(e) => setDraft({ ...draft, tags: e.target.value })} />
            </label>
            <label className="label text-xs">Taken on
              <input className="input mt-1 min-h-9 text-sm" type="date" value={draft.taken_on} onChange={(e) => setDraft({ ...draft, taken_on: e.target.value })} />
            </label>
            {asset.needsReview && (
              <label className="label text-xs">Review note
                <input className="input mt-1 min-h-9 text-sm" value={draft.review_note} maxLength={500} onChange={(e) => setDraft({ ...draft, review_note: e.target.value })} />
              </label>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-primary min-h-9 text-xs" disabled={disabled} onClick={saveDraft}>{pending ? "Saving…" : "Save details"}</button>
            </div>
          </div>
        )}
      </div>
    </li>
  );
}
