"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon, CloseIcon, ExternalIcon } from "@/components/icons";
import { saveFeaturedWork } from "@/lib/actions/featured-work";
import { buildSiteGallery, type FeaturedWork } from "@/lib/photos/featured";
import { focalPosition, SERVICE_SLOT_LABEL, SERVICE_SLOTS, type ManifestPlacements, type SitePhoto } from "@/lib/photos/manifest";
import { cn } from "@/lib/utils";

type Props = { photos: SitePhoto[]; placements: ManifestPlacements; initial: FeaturedWork; canSave: boolean };

const CATEGORY_LABEL: Record<SitePhoto["category"], string> = {
  tournament_action: "Tournament action",
  athlete_portrait: "Athlete portrait",
  training_session: "Training session",
  team_club: "Team / club",
  coaching_moment: "Coaching",
  victory_podium: "Victory / podium",
  behind_the_scenes: "Behind the scenes",
  brand_general: "Brand",
};

/**
 * All state lives in one FeaturedWork object mirrored from the settings
 * row. Nothing is written until Save; Publish is a switch inside the same
 * object, so an unpublished selection can be prepared in full first.
 */
export function FeaturedWorkManager({ photos, placements, initial, canSave }: Props) {
  const [work, setWork] = useState<FeaturedWork>(() => ({
    ...initial,
    // First visit: the pipeline's proposal becomes the editable order; approvals stay empty until the owner ticks them.
    featured: initial.featured.length ? initial.featured : placements.featured,
    services: SERVICE_SLOTS.reduce((acc, slot) => ({ ...acc, [slot]: initial.services[slot] ?? placements.services[slot] ?? [] }), {} as FeaturedWork["services"]),
    hero: initial.hero ?? placements.hero,
  }));
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [dirty, setDirty] = useState(false);
  const byId = useMemo(() => new Map(photos.map((p) => [p.id, p])), [photos]);
  const approved = new Set(work.approved);
  const rejected = new Set(work.rejected);

  function update(next: Partial<FeaturedWork>) {
    setWork((w) => ({ ...w, ...next }));
    setDirty(true);
    setMessage(null);
  }
  function approve(id: string) {
    update({ approved: approved.has(id) ? work.approved.filter((x) => x !== id) : [...work.approved, id], rejected: work.rejected.filter((x) => x !== id) });
  }
  function reject(id: string) {
    update({ rejected: rejected.has(id) ? work.rejected.filter((x) => x !== id) : [...work.rejected, id], approved: work.approved.filter((x) => x !== id), hero: work.hero === id ? null : work.hero });
  }
  function move(list: string[], id: string, dir: -1 | 1): string[] {
    const i = list.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return list;
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  }
  function save(publish?: boolean) {
    const payload: FeaturedWork = publish === undefined ? work : { ...work, published: publish };
    start(async () => {
      const res = await saveFeaturedWork(payload);
      if (!res.ok) setMessage({ kind: "error", text: res.error });
      else {
        setWork(payload);
        setDirty(false);
        setMessage({ kind: "ok", text: res.published ? "Saved and published. Visitors now see the approved photographs." : "Saved. Visitors do not see photographs until you publish." });
      }
    });
  }

  // What a visitor would see with this state, for the counters.
  const preview = buildSiteGallery(work, { generatedAt: null, placements: { ...placements }, photos: Object.fromEntries(photos.map((p) => [p.id, p])) }, { preview: true });
  const heroCandidates = photos.filter((p) => approved.has(p.id) && p.width >= p.height);
  const usedInSlots = new Set([work.hero, ...work.featured, ...SERVICE_SLOTS.flatMap((s) => work.services[s] ?? [])].filter(Boolean));
  const unplaced = photos.filter((p) => !usedInSlots.has(p.id));

  return (
    <div className="space-y-8">
      <section className="card p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="eyebrow">Status</p>
            <p className="mt-1 text-lg font-extrabold text-ink">{work.published ? "Published" : "Not published"}</p>
            <p className="mt-1 text-sm text-muted">{work.approved.length} approved, {work.rejected.length} rejected, {photos.length - work.approved.length - work.rejected.length} undecided. Visible once published: hero {preview.hero ? "set" : "missing"}, {preview.featured.length} featured, {SERVICE_SLOTS.reduce((n, s) => n + preview.services[s].length, 0)} service images.</p>
            <p className="mt-1 text-xs text-muted">Signed-in studio users already see the approved set on the public pages as a preview. <Link href="/" className="font-semibold text-primary">Open the home page</Link>.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-secondary min-h-11" disabled={pending || !canSave || !dirty} onClick={() => save()}>{pending ? "Saving…" : "Save"}</button>
            {work.published ? (
              <button type="button" className="btn-secondary min-h-11" disabled={pending || !canSave} onClick={() => save(false)}>Unpublish</button>
            ) : (
              <button type="button" className="btn-primary min-h-11" disabled={pending || !canSave || !work.approved.length} onClick={() => save(true)}>Save and publish</button>
            )}
          </div>
        </div>
        {message && <p className={cn("mt-3 rounded-xl px-3 py-2 text-sm font-semibold", message.kind === "ok" ? "bg-success-soft text-success" : "bg-danger-soft text-danger")} role="status">{message.text}</p>}
        <p className="mt-3 text-xs text-muted">Only publish photographs you hold the rights and permissions for. Photos the pipeline marked for approval (possible minors, private sessions, third-party branding) carry a yellow tag; approving one is your confirmation.</p>
      </section>

      <section aria-labelledby="hero-heading">
        <h2 id="hero-heading" className="text-base font-extrabold text-ink">Home page hero</h2>
        <p className="mt-1 text-sm text-muted">Landscape, approved photographs only. The headline sits over the clean side of the picture.</p>
        {heroCandidates.length === 0 ? (
          <p className="mt-3 rounded-xl bg-page px-3 py-2 text-sm text-muted">Approve a landscape photograph to choose a hero.</p>
        ) : (
          <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {heroCandidates.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => update({ hero: p.id })} aria-pressed={work.hero === p.id} className={cn("block w-full overflow-hidden rounded-xl border-2 text-left", work.hero === p.id ? "border-primary" : "border-transparent hover:border-line")}>
                  <Thumb photo={p} />
                  <span className="block px-2 py-1.5 text-xs font-semibold text-ink">{work.hero === p.id ? "Hero" : "Use as hero"}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <SlotSection title="Featured work (home page)" hint="8 to 12 pictures, strongest first. Use the arrows to reorder." ids={work.featured} byId={byId} approved={approved} rejected={rejected} onApprove={approve} onReject={reject} onMove={(id, dir) => update({ featured: move(work.featured, id, dir) })} onRemove={(id) => update({ featured: work.featured.filter((x) => x !== id) })} addable={unplaced} onAdd={(id) => update({ featured: [...work.featured, id] })} />

      {SERVICE_SLOTS.map((slot) => (
        <SlotSection key={slot} title={SERVICE_SLOT_LABEL[slot]} hint="The first approved picture is the card image on the services page." ids={work.services[slot] ?? []} byId={byId} approved={approved} rejected={rejected} onApprove={approve} onReject={reject} onMove={(id, dir) => update({ services: { ...work.services, [slot]: move(work.services[slot] ?? [], id, dir) } })} onRemove={(id) => update({ services: { ...work.services, [slot]: (work.services[slot] ?? []).filter((x) => x !== id) } })} addable={photos.filter((p) => !(work.services[slot] ?? []).includes(p.id))} onAdd={(id) => update({ services: { ...work.services, [slot]: [...(work.services[slot] ?? []), id] } })} />
      ))}

      {unplaced.length > 0 && (
        <section aria-labelledby="rest-heading">
          <h2 id="rest-heading" className="text-base font-extrabold text-ink">Shortlisted, not placed</h2>
          <p className="mt-1 text-sm text-muted">Approve them to make them available, then add them to a section above.</p>
          <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {unplaced.map((p) => (
              <li key={p.id} className="card overflow-hidden">
                <Thumb photo={p} />
                <Decision photo={p} approved={approved.has(p.id)} rejected={rejected.has(p.id)} onApprove={() => approve(p.id)} onReject={() => reject(p.id)} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Thumb({ photo }: { photo: SitePhoto }) {
  return (
    <span className="relative block aspect-[4/3] w-full overflow-hidden bg-navy">
      <Image src={photo.src} alt={photo.alt} fill sizes="(min-width: 1024px) 25vw, 50vw" className="object-cover" style={{ objectPosition: focalPosition(photo) }} />
      {photo.needsReview && <span className="absolute left-2 top-2 rounded-md bg-warning px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">Approve first</span>}
      <a href={photo.src} target="_blank" rel="noopener noreferrer" className="absolute bottom-2 right-2 rounded-md bg-black/60 p-1.5 text-white" aria-label="Open full size in a new tab"><ExternalIcon size={14} /></a>
    </span>
  );
}

function Decision({ photo, approved, rejected, onApprove, onReject }: { photo: SitePhoto; approved: boolean; rejected: boolean; onApprove: () => void; onReject: () => void }) {
  return (
    <div className="p-2">
      <p className="truncate text-xs text-muted" title={photo.alt}>{CATEGORY_LABEL[photo.category]} · {photo.score}</p>
      <div className="mt-1.5 flex gap-1.5">
        <button type="button" onClick={onApprove} aria-pressed={approved} className={cn("btn min-h-9 flex-1 px-2 text-xs", approved ? "bg-success text-white" : "border border-line text-ink hover:bg-success-soft")}><CheckIcon size={14} /> {approved ? "Approved" : "Approve"}</button>
        <button type="button" onClick={onReject} aria-pressed={rejected} className={cn("btn min-h-9 px-2 text-xs", rejected ? "bg-danger text-white" : "border border-line text-ink hover:bg-danger-soft")} aria-label={rejected ? "Rejected" : "Reject"}><CloseIcon size={14} /></button>
      </div>
    </div>
  );
}

function SlotSection({ title, hint, ids, byId, approved, rejected, onApprove, onReject, onMove, onRemove, addable, onAdd }: { title: string; hint: string; ids: string[]; byId: Map<string, SitePhoto>; approved: Set<string>; rejected: Set<string>; onApprove: (id: string) => void; onReject: (id: string) => void; onMove: (id: string, dir: -1 | 1) => void; onRemove: (id: string) => void; addable: SitePhoto[]; onAdd: (id: string) => void }) {
  const items = ids.map((id) => byId.get(id)).filter((p): p is SitePhoto => Boolean(p));
  const live = items.filter((p) => approved.has(p.id) && !rejected.has(p.id)).length;
  return (
    <section>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-base font-extrabold text-ink">{title}</h2>
          <p className="mt-1 text-sm text-muted">{hint} {live} of {items.length} approved.</p>
        </div>
        {addable.length > 0 && (
          <label className="text-xs font-semibold text-muted">
            Add a photo{" "}
            <select className="input mt-1 min-h-10 w-56 text-sm" value="" onChange={(e) => { if (e.target.value) onAdd(e.target.value); }}>
              <option value="">Choose</option>
              {addable.map((p) => (
                <option key={p.id} value={p.id}>{CATEGORY_LABEL[p.category]} · {p.score} · {p.id}</option>
              ))}
            </select>
          </label>
        )}
      </div>
      {items.length === 0 ? (
        <p className="mt-3 rounded-xl bg-page px-3 py-2 text-sm text-muted">Nothing here yet.</p>
      ) : (
        <ol className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((p, i) => (
            <li key={p.id} className={cn("card overflow-hidden", rejected.has(p.id) && "opacity-50")}>
              <Thumb photo={p} />
              <Decision photo={p} approved={approved.has(p.id)} rejected={rejected.has(p.id)} onApprove={() => onApprove(p.id)} onReject={() => onReject(p.id)} />
              <div className="flex items-center justify-between border-t border-line px-2 py-1">
                <span className="text-[11px] font-bold text-muted">{i + 1}</span>
                <span className="flex gap-1">
                  <button type="button" className="btn-ghost min-h-8 w-8 px-0" onClick={() => onMove(p.id, -1)} disabled={i === 0} aria-label="Move earlier"><ChevronLeftIcon size={14} /></button>
                  <button type="button" className="btn-ghost min-h-8 w-8 px-0" onClick={() => onMove(p.id, 1)} disabled={i === items.length - 1} aria-label="Move later"><ChevronRightIcon size={14} /></button>
                  <button type="button" className="btn-ghost min-h-8 px-2 text-xs" onClick={() => onRemove(p.id)}>Remove</button>
                </span>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
