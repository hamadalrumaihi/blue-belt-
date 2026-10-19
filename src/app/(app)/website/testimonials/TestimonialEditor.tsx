"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState, useTransition } from "react";
import { FormError, FormField } from "@/components/FormField";
import { TrashIcon } from "@/components/icons";
import { deleteTestimonial, saveTestimonial, type WebsiteState } from "@/lib/actions/website";
import { TESTIMONIAL_LIMITS, type TestimonialRecord } from "@/lib/studio/site-content";
import { cn } from "@/lib/utils";

/** Add / edit form for one testimonial. Publishing requires written permission. */
export function TestimonialForm({ record, onDone, prefill }: { record: TestimonialRecord | null; onDone?: () => void; prefill?: { quote: string; role?: string | null } | null }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<WebsiteState, FormData>(saveTestimonial, null);
  const fe = state?.fieldErrors ?? {};
  const [permission, setPermission] = useState(record?.permission_granted ?? false);
  useEffect(() => {
    if (state?.saved) {
      router.refresh();
      onDone?.();
    }
  }, [state?.saved, router, onDone]);
  return (
    <form action={formAction} className="space-y-3" noValidate>
      {record && !record.legacy && <input type="hidden" name="id" value={record.id} />}
      <FormError message={state?.error} />
      {record?.legacy && <p className="rounded-xl border border-warning/30 bg-warning-soft px-3 py-2 text-xs font-semibold text-warning">This review was added before permission tracking. Confirm the client agreed to appear on the website, then publish. Saving creates a proper record; the old row is kept until you delete it.</p>}
      <FormField label="The client's words" htmlFor={`quote-${record?.id ?? "new"}`} required error={fe.quote} hint="Their own sentence or two. No ratings, no edits beyond trimming.">
        <textarea id={`quote-${record?.id ?? "new"}`} name="quote" className="input min-h-24 py-3" defaultValue={record?.quote ?? prefill?.quote ?? ""} maxLength={TESTIMONIAL_LIMITS.quote} required dir="auto" />
      </FormField>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Name" htmlFor={`name-${record?.id ?? "new"}`} error={fe.name} hint="First name is enough. Leave blank to show the review as “Client” when the customer did not approve a name.">
          <input id={`name-${record?.id ?? "new"}`} name="name" className="input" defaultValue={record?.name ?? ""} maxLength={TESTIMONIAL_LIMITS.name} dir="auto" />
        </FormField>
        <FormField label="Role" htmlFor={`role-${record?.id ?? "new"}`} error={fe.role} hint="Athlete, Parent, Coach, Club…">
          <input id={`role-${record?.id ?? "new"}`} name="role" className="input" defaultValue={record?.role ?? prefill?.role ?? ""} maxLength={TESTIMONIAL_LIMITS.role} dir="auto" />
        </FormField>
      </div>
      <div className="rounded-xl border border-line bg-page p-3">
        <label className="flex items-start gap-2 text-sm text-ink">
          <input type="checkbox" name="permission_granted" className="mt-0.5" checked={permission} onChange={(e) => setPermission(e.target.checked)} />
          <span><span className="font-semibold">The client gave written permission</span> to show these words and their name on the website.</span>
        </label>
        <FormField label="Where / when" htmlFor={`pn-${record?.id ?? "new"}`} error={fe.permission_note} className="mt-2" hint="e.g. WhatsApp, 3 Oct 2026. Kept private.">
          <input id={`pn-${record?.id ?? "new"}`} name="permission_note" className="input" defaultValue={record?.permission_note ?? ""} maxLength={TESTIMONIAL_LIMITS.permission_note} />
        </FormField>
      </div>
      <label className={cn("flex items-start gap-2 text-sm", permission ? "text-ink" : "text-muted")}>
        <input type="checkbox" name="published" className="mt-0.5" defaultChecked={record?.published ?? false} disabled={!permission} />
        <span><span className="font-semibold">Published</span> on the website{permission ? "" : " (confirm permission first)"}</span>
      </label>
      {fe.published && <p className="text-xs font-semibold text-danger" role="alert">{fe.published}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn-primary min-h-11" disabled={pending} aria-busy={pending}>{pending ? "Saving…" : record ? "Save" : "Add testimonial"}</button>
        {onDone && <button type="button" className="btn-secondary min-h-11" onClick={onDone} disabled={pending}>Cancel</button>}
      </div>
    </form>
  );
}

/** One stored testimonial with edit / delete. */
export function TestimonialRow({ record }: { record: TestimonialRecord }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const live = record.published && record.permission_granted && !record.legacy;
  return (
    <li className="card p-4">
      {editing ? (
        <TestimonialForm record={record} onDone={() => setEditing(false)} />
      ) : (
        <>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="whitespace-pre-line text-sm text-ink" dir="auto">“{record.quote}”</p>
              <p className="mt-1 text-xs font-semibold text-muted" dir="auto">{record.name || "Client (anonymous)"}{record.role ? ` · ${record.role}` : ""}</p>
            </div>
            <span className={cn("shrink-0 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider", live ? "bg-success-soft text-success" : record.legacy ? "bg-warning-soft text-warning" : "bg-page text-muted")}>
              {live ? "Live" : record.legacy ? "Needs permission confirmation" : record.published ? "Blocked: no permission" : record.permission_granted ? "Draft (permission ok)" : "Draft"}
            </span>
          </div>
          {record.permission_note && <p className="mt-1 text-[11px] text-muted">Permission: {record.permission_note}</p>}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" className="btn-secondary min-h-9 px-3 text-xs" onClick={() => setEditing(true)}>{record.legacy ? "Confirm permission" : "Edit"}</button>
            {!confirming ? (
              <button type="button" className="btn-ghost min-h-9 px-3 text-xs text-danger" onClick={() => setConfirming(true)}><TrashIcon size={14} /> Delete</button>
            ) : (
              <span className="flex items-center gap-2 text-xs">
                <span className="text-muted">Delete this review?</span>
                <button type="button" className="btn-danger min-h-9 px-3 text-xs" disabled={pending} onClick={() => start(async () => {
                  const r = await deleteTestimonial(record.id);
                  if (!r.ok) setError(r.error);
                  else router.refresh();
                })}>Yes, delete</button>
                <button type="button" className="btn-ghost min-h-9 px-3 text-xs" onClick={() => setConfirming(false)}>No</button>
              </span>
            )}
          </div>
          {error && <p className="mt-1 text-xs font-semibold text-danger" role="alert">{error}</p>}
        </>
      )}
    </li>
  );
}

/** "Add" disclosure at the top of the list; `prefill` opens it with a supplied review already in the quote box. */
export function AddTestimonial({ prefill = null }: { prefill?: { quote: string; role?: string | null } | null }) {
  const [open, setOpen] = useState(Boolean(prefill));
  if (!open) return <button type="button" className="btn-primary min-h-11" onClick={() => setOpen(true)}>Add a testimonial</button>;
  return (
    <div className="card p-4">
      <h2 className="mb-3 text-base font-bold text-ink">New testimonial</h2>
      <TestimonialForm record={null} onDone={() => setOpen(false)} prefill={prefill} />
    </div>
  );
}

/** Reviews supplied by the owner that are not stored yet: one click opens the add form with the words filled in; permission is still confirmed by hand. */
export function SuppliedReviews({ reviews }: { reviews: ReadonlyArray<{ key: string; quote: string }> }) {
  const [picked, setPicked] = useState<string | null>(null);
  if (!reviews.length) return null;
  const chosen = reviews.find((r) => r.key === picked) ?? null;
  return (
    <section className="card p-4" aria-labelledby="supplied-h">
      <h2 id="supplied-h" className="text-base font-bold text-ink">Reviews supplied for the website</h2>
      <p className="mt-1 text-xs text-muted">Customer words you provided on 19 Oct 2026 that are not stored yet. Pick one to open it as a draft: confirm the customer agreed in writing, add a name only if they approved it, then publish.</p>
      <ul className="mt-3 space-y-2">
        {reviews.map((r) => (
          <li key={r.key} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-page px-3 py-2">
            <p className="text-sm text-ink" dir="auto">“{r.quote}”</p>
            <button type="button" className="btn-secondary min-h-9 px-3 text-xs" onClick={() => setPicked(r.key)}>Use as draft</button>
          </li>
        ))}
      </ul>
      {chosen && (
        <div className="mt-3">
          <TestimonialForm key={chosen.key} record={null} prefill={{ quote: chosen.quote }} onDone={() => setPicked(null)} />
        </div>
      )}
    </section>
  );
}
