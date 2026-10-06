"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { FormError, FormField } from "@/components/FormField";
import { updateDraftBody } from "@/lib/actions/documents";

/** Plain-text editor for a draft. Merge fields were already filled in; blanks show as "________". */
export function DraftEditor({ documentId, initialBody }: { documentId: string; initialBody: string }) {
  const router = useRouter();
  const [body, setBody] = useState(initialBody);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const blanks = (body.match(/________/g) ?? []).length;

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await updateDraftBody(documentId, body);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.push(`/documents/${documentId}`);
      router.refresh();
    });
  }

  return (
    <div className="card space-y-4 p-4">
      <FormField label="Document text" htmlFor="body" hint={blanks ? `${blanks} blank${blanks === 1 ? "" : "s"} ("________") still to fill in.` : "Everything is filled in."}>
        <textarea id="body" value={body} onChange={(e) => setBody(e.target.value)} rows={28} className="input min-h-[60vh] py-3 font-mono text-sm leading-6" spellCheck />
      </FormField>
      <FormError message={error ?? undefined} />
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-primary min-h-11" disabled={pending || !body.trim()} onClick={save}>{pending ? "Saving…" : "Save draft"}</button>
        <button type="button" className="btn-ghost min-h-11" disabled={pending} onClick={() => router.push(`/documents/${documentId}`)}>Cancel</button>
      </div>
    </div>
  );
}
