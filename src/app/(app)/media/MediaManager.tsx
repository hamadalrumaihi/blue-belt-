"use client";

import Link from "next/link";
import { useCallback, useMemo, useState, useTransition } from "react";
import { archiveMedia, finalizeMediaUpload, publishMedia, restoreMedia, unpublishMedia, type MediaBatchResult } from "@/lib/actions/media";
import type { MediaCounts, StorageUsage } from "@/lib/media/queries";
import { formatBytes } from "@/lib/media/rules";
import { MEDIA_CATEGORIES, MEDIA_CATEGORY_LABEL, MEDIA_STATUS_LABEL, MEDIA_STATUSES, type MediaAsset, type MediaStatus } from "@/lib/media/types";
import { cn } from "@/lib/utils";
import { AssetCard } from "./AssetCard";
import { MediaUploader } from "./MediaUploader";
import { PlacementBoard } from "./PlacementBoard";

type Props = { initialAssets: MediaAsset[]; initialPlacements: Record<string, string[]>; counts: MediaCounts; usage: StorageUsage };
type Filter = MediaStatus | "all" | "attention";

/**
 * Client state for the library: the asset map (updated in place by every
 * action's result, so the grid never waits for a reload), the status filter,
 * a multi-select for batch publish/archive, and the placement board.
 */
export function MediaManager({ initialAssets, initialPlacements, counts, usage }: Props) {
  const [assets, setAssets] = useState<Map<string, MediaAsset>>(() => new Map(initialAssets.map((a) => [a.id, a])));
  const [placements, setPlacements] = useState(initialPlacements);
  const [filter, setFilter] = useState<Filter>("all");
  const [category, setCategory] = useState<string>("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();

  const upsert = useCallback((asset: MediaAsset) => setAssets((m) => new Map(m).set(asset.id, asset)), []);

  const list = useMemo(() => {
    const all = [...assets.values()];
    const term = search.trim().toLowerCase();
    return all
      .filter((a) => (filter === "all" ? true : filter === "attention" ? a.status === "failed" || (a.status === "ready" && (!a.rightsConfirmed || !a.alt || (a.needsReview && !a.guardianOk))) : a.status === filter))
      .filter((a) => (category ? a.category === category : true))
      .filter((a) => (term ? a.alt.toLowerCase().includes(term) || (a.caption ?? "").toLowerCase().includes(term) || a.tags.some((t) => t.includes(term)) : true))
      .sort((a, b) => a.sortOrder - b.sortOrder || b.createdAt.localeCompare(a.createdAt));
  }, [assets, filter, category, search]);

  const live = useMemo(() => {
    const c: Record<string, number> = { all: assets.size, attention: 0 };
    for (const s of MEDIA_STATUSES) c[s] = 0;
    for (const a of assets.values()) {
      c[a.status]++;
      if (a.status === "failed" || (a.status === "ready" && (!a.rightsConfirmed || !a.alt || (a.needsReview && !a.guardianOk)))) c.attention++;
    }
    return c;
  }, [assets]);

  function applyBatch(res: MediaBatchResult, verb: string) {
    if (!res.ok) {
      setMessage({ kind: "error", text: res.error });
      return;
    }
    const text = `${res.done.length} ${verb}${res.skipped.length ? `; ${res.skipped.length} skipped: ${res.skipped.map((s) => s.reason).filter((r, i, arr) => arr.indexOf(r) === i).join(" ")}` : "."}`;
    setMessage({ kind: res.done.length ? "ok" : "error", text });
  }

  /** Re-reads the changed rows by asking the server for each id (small batches; keeps one source of truth). */
  async function refresh(ids: string[]) {
    // The lifecycle actions return ids only; finalize returns the row, and a status flip is predictable, so patch locally.
    setAssets((m) => {
      const next = new Map(m);
      for (const id of ids) {
        const a = next.get(id);
        if (a) next.set(id, { ...a });
      }
      return next;
    });
  }

  function run(action: "publish" | "unpublish" | "archive" | "restore" | "retry", ids: string[]) {
    if (!ids.length) return;
    setMessage(null);
    start(async () => {
      if (action === "retry") {
        for (const id of ids) {
          const res = await finalizeMediaUpload(id);
          if (res.asset) upsert(res.asset);
          if (!res.ok) setMessage({ kind: "error", text: res.error });
          else setMessage({ kind: "ok", text: "Web copies rebuilt." });
        }
        return;
      }
      const fn = action === "publish" ? publishMedia : action === "unpublish" ? unpublishMedia : action === "archive" ? archiveMedia : restoreMedia;
      const res = await fn(ids);
      applyBatch(res, action === "publish" ? "published" : action === "unpublish" ? "unpublished" : action === "archive" ? "archived" : "restored");
      if (res.ok && res.done.length) {
        const now = new Date().toISOString();
        setAssets((m) => {
          const next = new Map(m);
          for (const id of res.done) {
            const a = next.get(id);
            if (!a) continue;
            if (action === "publish") next.set(id, { ...a, status: "published", publishedAt: now, archivedAt: null });
            if (action === "unpublish") next.set(id, { ...a, status: "ready" });
            if (action === "archive") next.set(id, { ...a, status: "archived", archivedAt: now, derivatives: [], thumbUrl: null, previewUrl: null });
            if (action === "restore") next.set(id, { ...a, status: "processing", archivedAt: null });
          }
          return next;
        });
        if (action === "restore") {
          // restore re-renders server-side; fetch the finished rows one by one.
          for (const id of res.done) {
            const fin = await finalizeMediaUpload(id);
            if (fin.asset) upsert(fin.asset);
            else if (fin.ok) upsert(fin.asset);
          }
        }
        await refresh(res.done);
        setSelected(new Set());
      }
    });
  }

  const selectedIds = [...selected];

  return (
    <div className="space-y-8">
      <section className="card p-4 sm:p-5" aria-labelledby="status-h">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p id="status-h" className="eyebrow">Library</p>
            <p className="mt-1 text-lg font-extrabold text-ink">{live.published} published · {live.ready} ready · {live.archived} archived{live.failed ? ` · ${live.failed} failed` : ""}</p>
            <p className="mt-1 text-sm text-muted">
              Storage: {formatBytes(usage.originalsBytes)} of originals (private) and {formatBytes(usage.derivativesBytes)} of web copies ({usage.derivatives} files, public) across {usage.assets} photographs.
              {counts.needsReview ? ` ${counts.needsReview} need a permission check.` : ""}{counts.unconfirmedRights ? ` ${counts.unconfirmedRights} without a rights confirmation.` : ""}
            </p>
            <p className="mt-1 text-xs text-muted">
              Preview as the studio: <Link href="/work?preview=1" className="font-semibold text-primary">Work page</Link> · <Link href="/" className="font-semibold text-primary">home page</Link>. Legacy manifest selection: <Link href="/featured-work" className="font-semibold text-primary">Featured work</Link>.
            </p>
          </div>
        </div>
      </section>

      <MediaUploader onAsset={upsert} />

      <section aria-labelledby="grid-h" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="grid-h" className="text-base font-extrabold text-ink">Photographs</h2>
            <p className="text-sm text-muted">{list.length} shown.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <input className="input min-h-9 w-48 text-sm" placeholder="Search alt, caption, tags" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search" />
            <select className="input min-h-9 text-sm" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
              <option value="">Any category</option>
              {MEDIA_CATEGORIES.map((c) => (
                <option key={c} value={c}>{MEDIA_CATEGORY_LABEL[c]}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5 text-xs">
          {(["all", "attention", ...MEDIA_STATUSES] as Filter[]).map((f) => (
            <button key={f} type="button" onClick={() => setFilter(f)} className={cn("rounded-md px-2 py-1 font-semibold", filter === f ? "bg-ink text-white" : "text-muted hover:text-ink")} aria-pressed={filter === f}>
              {f === "all" ? "All" : f === "attention" ? "Needs attention" : MEDIA_STATUS_LABEL[f]} <span className="opacity-70">{live[f] ?? 0}</span>
            </button>
          ))}
        </div>
        {selectedIds.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl bg-lightblue px-3 py-2 text-sm">
            <span className="font-semibold text-ink">{selectedIds.length} selected</span>
            <button type="button" className="btn-primary min-h-9 text-xs" disabled={pending} onClick={() => run("publish", selectedIds)}>Publish</button>
            <button type="button" className="btn-secondary min-h-9 text-xs" disabled={pending} onClick={() => run("unpublish", selectedIds)}>Unpublish</button>
            <button type="button" className="btn-secondary min-h-9 text-xs" disabled={pending} onClick={() => run("archive", selectedIds)}>Archive</button>
            <button type="button" className="btn-secondary min-h-9 text-xs" disabled={pending} onClick={() => run("restore", selectedIds)}>Restore</button>
            <button type="button" className="btn-ghost min-h-9 text-xs" onClick={() => setSelected(new Set())}>Clear</button>
          </div>
        )}
        {message && <p className={cn("rounded-xl px-3 py-2 text-sm font-semibold", message.kind === "ok" ? "bg-success-soft text-success" : "bg-danger-soft text-danger")} role="status">{message.text}</p>}
        {list.length === 0 ? (
          <p className="rounded-xl bg-page px-3 py-3 text-sm text-muted">{assets.size === 0 ? "Nothing uploaded yet. Drop photographs above, or import from your archive (instructions below)." : "Nothing matches this filter."}</p>
        ) : (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {list.map((a) => (
              <AssetCard
                key={a.id}
                asset={a}
                selected={selected.has(a.id)}
                onSelect={(id, on) =>
                  setSelected((s) => {
                    const next = new Set(s);
                    if (on) next.add(id);
                    else next.delete(id);
                    return next;
                  })
                }
                onChange={upsert}
                onAction={(action, id) => run(action, [id])}
                busy={pending}
              />
            ))}
          </ul>
        )}
      </section>

      <PlacementBoard assets={assets} placements={placements} onSaved={(p, ids) => setPlacements((cur) => ({ ...cur, [p]: ids }))} />
    </div>
  );
}
