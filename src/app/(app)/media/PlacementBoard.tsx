"use client";

import { useState, useTransition } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/icons";
import { setPlacement } from "@/lib/actions/media";
import { ALL_PLACEMENTS, PLACEMENT_LABEL, placementLimit } from "@/lib/media/placements";
import { MEDIA_CATEGORY_LABEL, type MediaAsset, type MediaPlacement } from "@/lib/media/types";
import { cn } from "@/lib/utils";

type Props = { assets: Map<string, MediaAsset>; placements: Record<string, string[]>; onSaved: (placement: string, ids: string[]) => void };

/**
 * Where each photograph goes: the hero (one), the home-page featured order,
 * the Work page order and the per-service images. Each placement saves on
 * its own. Only ready or published photographs can be placed; a placed
 * photograph is visible to visitors only once published.
 */
export function PlacementBoard({ assets, placements, onSaved }: Props) {
  return (
    <section aria-labelledby="placements-h" className="space-y-5">
      <div>
        <h2 id="placements-h" className="text-base font-extrabold text-ink">Placements</h2>
        <p className="mt-1 text-sm text-muted">Hero and featured feed the home page, the service lists feed the services page and the per-service pages, and Work feeds the public Work page. Unpublished photographs in a placement are shown to studio users only (preview).</p>
      </div>
      {ALL_PLACEMENTS.map((p) => (
        <PlacementRow key={p} placement={p} assets={assets} ids={placements[p] ?? []} onSaved={onSaved} />
      ))}
    </section>
  );
}

function PlacementRow({ placement, assets, ids: saved, onSaved }: { placement: MediaPlacement; assets: Map<string, MediaAsset>; ids: string[]; onSaved: Props["onSaved"] }) {
  const [ids, setIds] = useState<string[]>(saved);
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const dirty = ids.join(",") !== saved.join(",");
  const limit = placementLimit(placement);
  const placeable = [...assets.values()].filter((a) => (a.status === "ready" || a.status === "published") && !ids.includes(a.id) && (placement !== "hero" || (a.width ?? 0) >= (a.height ?? 0)));

  function move(id: string, dir: -1 | 1) {
    const i = ids.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    const next = [...ids];
    [next[i], next[j]] = [next[j], next[i]];
    setIds(next);
  }
  function save() {
    setMessage(null);
    start(async () => {
      const res = await setPlacement(placement, ids);
      if (!res.ok) setMessage({ kind: "error", text: res.error });
      else {
        onSaved(placement, ids);
        setMessage({ kind: "ok", text: "Saved." });
      }
    });
  }

  const items = ids.map((id) => assets.get(id)).filter((a): a is MediaAsset => Boolean(a));
  const unpublished = items.filter((a) => a.status !== "published").length;

  return (
    <div className="card p-3 sm:p-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="text-sm font-extrabold text-ink">{PLACEMENT_LABEL[placement] ?? placement}</h3>
          <p className="text-xs text-muted">{items.length} of {limit}{unpublished ? ` · ${unpublished} not published yet` : ""}{placement === "hero" ? " · landscape only" : ""}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {placeable.length > 0 && ids.length < limit && (
            <select className="input min-h-9 w-56 text-xs" value="" aria-label={`Add to ${PLACEMENT_LABEL[placement] ?? placement}`} onChange={(e) => e.target.value && setIds(placement === "hero" ? [e.target.value] : [...ids, e.target.value])}>
              <option value="">Add a photograph</option>
              {placeable.map((a) => (
                <option key={a.id} value={a.id}>{MEDIA_CATEGORY_LABEL[a.category]} · {a.alt ? a.alt.slice(0, 40) : a.id.slice(0, 8)}{a.status === "published" ? "" : " (not published)"}</option>
              ))}
            </select>
          )}
          <button type="button" className="btn-secondary min-h-9 text-xs" disabled={!dirty || pending} onClick={save}>{pending ? "Saving…" : "Save order"}</button>
        </div>
      </div>
      {message && <p className={cn("mt-2 text-xs font-semibold", message.kind === "ok" ? "text-success" : "text-danger")} role="status">{message.text}</p>}
      {items.length === 0 ? (
        <p className="mt-3 rounded-xl bg-page px-3 py-2 text-sm text-muted">Nothing placed here yet.</p>
      ) : (
        <ol className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {items.map((a, i) => (
            <li key={a.id} className={cn("overflow-hidden rounded-lg border border-line", a.status !== "published" && "opacity-70")}>
              <div className="relative aspect-[4/3] bg-navy">
                {a.thumbUrl && (
                  // eslint-disable-next-line @next/next/no-img-element -- public derivative thumbnail
                  <img src={a.thumbUrl} alt={a.alt || ""} className="h-full w-full object-cover" style={{ objectPosition: `${Math.round(a.focal.x * 100)}% ${Math.round(a.focal.y * 100)}%` }} loading="lazy" />
                )}
                <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[10px] font-bold text-white">{i + 1}</span>
              </div>
              <div className="flex items-center justify-between px-1 py-0.5">
                <button type="button" className="btn-ghost h-7 w-7 p-0" onClick={() => move(a.id, -1)} disabled={i === 0} aria-label="Move earlier"><ChevronLeftIcon size={12} /></button>
                <button type="button" className="btn-ghost h-7 px-1 text-[11px]" onClick={() => setIds(ids.filter((x) => x !== a.id))}>Remove</button>
                <button type="button" className="btn-ghost h-7 w-7 p-0" onClick={() => move(a.id, 1)} disabled={i === items.length - 1} aria-label="Move later"><ChevronRightIcon size={12} /></button>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
