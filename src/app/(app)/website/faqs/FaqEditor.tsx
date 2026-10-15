"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState, useTransition } from "react";
import { FormError, FormField } from "@/components/FormField";
import { TrashIcon } from "@/components/icons";
import { addOpenQuestion, deleteFaq, deleteOpenQuestion, resolveOpenQuestion, saveFaq, type WebsiteState } from "@/lib/actions/website";
import { FAQ_CATEGORIES, FAQ_CATEGORY_LABEL, FAQ_LIMITS, OPEN_QUESTION_LIMITS, type FaqOverride, type OpenQuestion } from "@/lib/studio/site-content";
import { cn } from "@/lib/utils";

export function FaqForm({ record, onDone, prefill, knownIds = [] }: { record: FaqOverride | null; onDone?: () => void; prefill?: string | null; knownIds?: readonly string[] }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<WebsiteState, FormData>(saveFaq, null);
  const fe = state?.fieldErrors ?? {};
  const key = record?.id ?? "new";
  useEffect(() => {
    if (state?.saved) {
      router.refresh();
      onDone?.();
    }
  }, [state?.saved, router, onDone]);
  return (
    <form action={formAction} className="space-y-3" noValidate>
      <FormError message={state?.error} />
      <FormField label="Id" htmlFor={`id-${key}`} error={fe.id} hint="Pick the id of a built-in FAQ to replace its words on the website, or leave blank for a new entry.">
        <input id={`id-${key}`} name="id" className="input font-mono text-xs" defaultValue={record?.id ?? ""} maxLength={64} readOnly={Boolean(record)} list={record ? undefined : `faq-ids-${key}`} />
        {!record && knownIds.length > 0 && <datalist id={`faq-ids-${key}`}>{knownIds.map((id) => <option key={id} value={id} />)}</datalist>}
      </FormField>
      <FormField label="Question (English)" htmlFor={`qen-${key}`} required error={fe.question_en}>
        <input id={`qen-${key}`} name="question_en" className="input" defaultValue={record?.question_en ?? prefill ?? ""} maxLength={FAQ_LIMITS.question} required />
      </FormField>
      <FormField label="Answer (English)" htmlFor={`aen-${key}`} required error={fe.answer_en}>
        <textarea id={`aen-${key}`} name="answer_en" className="input min-h-24 py-3" defaultValue={record?.answer_en ?? ""} maxLength={FAQ_LIMITS.answer} required />
      </FormField>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Question (Arabic)" htmlFor={`qar-${key}`} error={fe.question_ar} hint="Optional; both Arabic fields or neither.">
          <input id={`qar-${key}`} name="question_ar" className="input" defaultValue={record?.question_ar ?? ""} maxLength={FAQ_LIMITS.question} dir="rtl" lang="ar" />
        </FormField>
        <FormField label="Answer (Arabic)" htmlFor={`aar-${key}`} error={fe.answer_ar}>
          <textarea id={`aar-${key}`} name="answer_ar" className="input min-h-24 py-3" defaultValue={record?.answer_ar ?? ""} maxLength={FAQ_LIMITS.answer} dir="rtl" lang="ar" />
        </FormField>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Category" htmlFor={`cat-${key}`} required error={fe.category}>
          <select id={`cat-${key}`} name="category" className="input" defaultValue={record?.category ?? "booking"}>
            {FAQ_CATEGORIES.map((c) => <option key={c} value={c}>{FAQ_CATEGORY_LABEL[c]}</option>)}
          </select>
        </FormField>
        <label className="flex items-center gap-2 self-end pb-3 text-sm text-ink">
          <input type="checkbox" name="published" defaultChecked={record?.published ?? false} /> <span className="font-semibold">Published</span>
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn-primary min-h-11" disabled={pending} aria-busy={pending}>{pending ? "Saving…" : record ? "Save" : "Add FAQ"}</button>
        {onDone && <button type="button" className="btn-secondary min-h-11" onClick={onDone} disabled={pending}>Cancel</button>}
      </div>
    </form>
  );
}

export function FaqRow({ record }: { record: FaqOverride }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <li className="card p-4">
      {editing ? <FaqForm record={record} onDone={() => setEditing(false)} /> : (
        <>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-ink">{record.question_en}</p>
              <p className="mt-1 whitespace-pre-line text-sm text-ink">{record.answer_en}</p>
              {record.question_ar && <p className="mt-2 text-sm font-bold text-ink" dir="rtl" lang="ar">{record.question_ar}</p>}
              {record.answer_ar && <p className="mt-1 whitespace-pre-line text-sm text-ink" dir="rtl" lang="ar">{record.answer_ar}</p>}
              <p className="mt-2 text-[11px] text-muted"><span className="font-mono">{record.id}</span> · {FAQ_CATEGORY_LABEL[record.category]}</p>
            </div>
            <span className={cn("shrink-0 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider", record.published ? "bg-success-soft text-success" : "bg-page text-muted")}>{record.published ? "Published" : "Draft"}</span>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" className="btn-secondary min-h-9 px-3 text-xs" onClick={() => setEditing(true)}>Edit</button>
            {!confirming ? (
              <button type="button" className="btn-ghost min-h-9 px-3 text-xs text-danger" onClick={() => setConfirming(true)}><TrashIcon size={14} /> Delete</button>
            ) : (
              <span className="flex items-center gap-2 text-xs">
                <span className="text-muted">Delete this entry?</span>
                <button type="button" className="btn-danger min-h-9 px-3 text-xs" disabled={pending} onClick={() => start(async () => {
                  const r = await deleteFaq(record.id);
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

export function AddFaq({ prefill, knownIds }: { prefill?: string | null; knownIds?: readonly string[] }) {
  const [open, setOpen] = useState(Boolean(prefill));
  if (!open) return <button type="button" className="btn-primary min-h-11" onClick={() => setOpen(true)}>Add an FAQ</button>;
  return (
    <div className="card p-4">
      <h2 className="mb-3 text-base font-bold text-ink">New FAQ</h2>
      <FaqForm record={null} prefill={prefill} knownIds={knownIds} onDone={() => setOpen(false)} />
    </div>
  );
}

export function OpenQuestionForm() {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<WebsiteState, FormData>(addOpenQuestion, null);
  const fe = state?.fieldErrors ?? {};
  useEffect(() => {
    if (state?.saved) router.refresh();
  }, [state?.saved, router]);
  return (
    <form action={formAction} className="flex flex-col gap-2 sm:flex-row sm:items-end" noValidate key={state?.id ?? "form"}>
      <FormError message={state?.error} />
      <FormField label="A question the website does not answer yet" htmlFor="oq-text" error={fe.text} className="flex-1">
        <input id="oq-text" name="text" className="input" maxLength={OPEN_QUESTION_LIMITS.text} required placeholder="e.g. Do you cover kids' divisions?" />
      </FormField>
      <FormField label="Source" htmlFor="oq-source" error={fe.source} className="sm:w-40">
        <input id="oq-source" name="source" className="input" maxLength={OPEN_QUESTION_LIMITS.source} placeholder="WhatsApp, call…" />
      </FormField>
      <button type="submit" className="btn-secondary min-h-11" disabled={pending} aria-busy={pending}>{pending ? "Saving…" : "Note it"}</button>
    </form>
  );
}

export function OpenQuestionRow({ q }: { q: OpenQuestion }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => start(async () => {
    const r = await fn();
    if (!r.ok) setError(r.error ?? "Something went wrong.");
    else router.refresh();
  });
  return (
    <li className={cn("flex flex-wrap items-start gap-2 py-2.5", q.resolved && "opacity-60")}>
      <div className="min-w-0 flex-1">
        <p className={cn("text-sm text-ink", q.resolved && "line-through")}>{q.text}</p>
        <p className="text-[11px] text-muted">via {q.source}{q.created_at ? ` · ${q.created_at.slice(0, 10)}` : ""}{q.resolved && q.resolved_at ? ` · resolved ${q.resolved_at.slice(0, 10)}` : ""}</p>
        {error && <p className="text-xs font-semibold text-danger" role="alert">{error}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {!q.resolved && <a href={`/website/faqs?answer=${encodeURIComponent(q.text)}#add-faq`} className="btn-ghost min-h-9 px-2 text-xs">Answer as FAQ</a>}
        <button type="button" className="btn-secondary min-h-9 px-2 text-xs" disabled={pending} onClick={() => run(() => resolveOpenQuestion(q.id, !q.resolved))}>{q.resolved ? "Reopen" : "Resolve"}</button>
        <button type="button" className="btn-ghost min-h-9 px-2 text-xs text-danger" disabled={pending} aria-label="Delete question" onClick={() => run(() => deleteOpenQuestion(q.id))}><TrashIcon size={14} /></button>
      </div>
    </li>
  );
}
