"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { FormError } from "@/components/FormField";
import { commitReferenceImport, previewReferenceImport, type ImportPreview } from "@/lib/actions/pricing";

/** Two steps: preview (validate, show per-row errors and duplicates), then import what is valid and new. */
export function ImportForm() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const id = useId();
  const previewOk = preview && preview.ok ? preview : null;

  return (
    <div className="card space-y-4 p-5">
      <FormError message={error ?? undefined} />
      {done && <p className="rounded-xl border border-success/30 bg-success-soft px-3 py-2 text-sm font-semibold text-success" role="status">{done}</p>}
      <div>
        <label htmlFor={id} className="label">Evidence (JSON or CSV)</label>
        <textarea
          id={id}
          className="input min-h-56 py-3 font-mono text-xs"
          value={text}
          spellCheck={false}
          onChange={(e) => {
            setText(e.target.value);
            setPreview(null);
            setDone(null);
          }}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-secondary min-h-11"
          disabled={pending || !text.trim()}
          onClick={() => {
            setError(null);
            setDone(null);
            start(async () => {
              const r = await previewReferenceImport(text);
              if (!r.ok) setError(r.error);
              setPreview(r);
            });
          }}
        >
          {pending ? "Checking…" : "Check"}
        </button>
        <button
          type="button"
          className="btn-primary min-h-11"
          disabled={pending || !previewOk || previewOk.valid === 0}
          onClick={() => {
            setError(null);
            start(async () => {
              const r = await commitReferenceImport(text);
              if (!r.ok) setError(r.error);
              else {
                setDone(`Imported ${r.inserted} observation${r.inserted === 1 ? "" : "s"}; skipped ${r.skipped} already present and ${r.invalid} invalid.`);
                setPreview(null);
                router.refresh();
              }
            });
          }}
        >
          {pending ? "Importing…" : previewOk ? `Import ${previewOk.valid} new` : "Import"}
        </button>
      </div>
      {previewOk && (
        <div className="space-y-2">
          <p className="text-sm text-ink">{previewOk.format.toUpperCase()}: <strong>{previewOk.valid}</strong> new, <strong>{previewOk.existing}</strong> already present (skipped), <strong>{previewOk.invalid}</strong> invalid.</p>
          <ul className="divide-y divide-line rounded-xl border border-line text-xs">
            {previewOk.rows.map((r) => (
              <li key={r.index} className="flex items-start justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <p className="font-semibold text-ink">{r.label}{r.seedKey ? <span className="ml-2 font-mono text-muted">{r.seedKey}</span> : null}</p>
                  {!r.ok && <p className="text-danger">{Object.entries(r.errors).map(([k, v]) => `${k}: ${v}`).join(" · ")}</p>}
                </div>
                <span className={r.ok && !r.exists ? "font-bold text-success" : r.exists ? "font-bold text-muted" : "font-bold text-danger"}>{r.ok ? (r.exists ? "exists" : "new") : "invalid"}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-[11px] text-muted">Nothing is overwritten. To update an existing observation, open it and choose "Save as new observation".</p>
    </div>
  );
}
