"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { AlertIcon, CheckIcon, TrashIcon } from "@/components/icons";
import { applyBracketRows, type BracketApplyReport } from "@/lib/actions/matches";
import type { ExtractedBracket } from "@/lib/bracket-extract";
import type { BracketRow } from "@/lib/manual-matches";
import { MATCH_STATUSES, type MatchStatus } from "@/lib/types";
import { STATUS_LABEL } from "@/lib/eta";
import { cn } from "@/lib/utils";

type Props = { eventId: string; configured: boolean; clientNames: string[] };

type ReviewRow = BracketRow & { key: number; keep: boolean };

type ExtractResponse = { ok: true; extracted: ExtractedBracket; rows: BracketRow[]; clientNames: string[] } | { error: string; code: string };

const MAX_EDGE = 1800;
let seq = 1;

/** Shrinks a photo in the browser so uploads stay small; keeps PNG for screenshots, JPEG for photos. */
async function prepareImage(file: File): Promise<{ data: string; mediaType: "image/jpeg" | "image/png" }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not read the image.");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const png = file.type === "image/png" && file.size < 2 * 1024 * 1024;
  const url = canvas.toDataURL(png ? "image/png" : "image/jpeg", 0.88);
  return { data: url.replace(/^data:[^,]+,/, ""), mediaType: png ? "image/png" : "image/jpeg" };
}

/**
 * Bracket photo → rows to review. The reading is a draft: every cell can be
 * corrected, rows can be dropped, and nothing is saved until "Add matches".
 */
export function BracketPhotoReview({ eventId, configured, clientNames }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [extracted, setExtracted] = useState<ExtractedBracket | null>(null);
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [createMissing, setCreateMissing] = useState(false);
  const [report, setReport] = useState<BracketApplyReport | null>(null);
  const [pending, start] = useTransition();
  const known = new Set(clientNames.map((n) => n.trim().replace(/\s+/g, " ").toLowerCase()));
  const isKnown = (name: string) => known.has(name.trim().replace(/\s+/g, " ").toLowerCase());

  async function onFile(file: File | null) {
    if (!file) return;
    setError(null);
    setReport(null);
    setExtracted(null);
    setRows([]);
    setBusy(true);
    try {
      const prepared = await prepareImage(file);
      setPreview(`data:${prepared.mediaType};base64,${prepared.data}`);
      const res = await fetch("/api/brackets/extract", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ eventId, mediaType: prepared.mediaType, image: prepared.data }) });
      const body = (await res.json()) as ExtractResponse;
      if (!res.ok || !("ok" in body)) throw new Error("error" in body ? body.error : "Reading failed.");
      setExtracted(body.extracted);
      setRows(body.rows.map((r) => ({ ...r, key: seq++, keep: true })));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reading failed.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function patch(key: number, p: Partial<ReviewRow>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));
  }

  function apply() {
    setError(null);
    const kept = rows.filter((r) => r.keep && r.athlete.trim());
    if (!kept.length) return setError("Keep at least one row.");
    start(async () => {
      const res = await applyBracketRows(eventId, kept.map(({ key: _k, keep: _keep, ...row }) => row), { createMissing });
      if (!res.ok) return setError(res.error);
      setReport(res.report);
      setRows([]);
      setExtracted(null);
    });
  }

  if (!configured) {
    return (
      <section className="card p-5">
        <p className="text-sm font-bold text-ink">Reading bracket photos is not set up on this server.</p>
        <p className="mt-1 text-sm text-muted">It needs the <code>ANTHROPIC_API_KEY</code> environment variable on the server. Until then, use the CSV import above or add matches on each client’s page.</p>
      </section>
    );
  }

  const unknownKept = rows.filter((r) => r.keep && r.athlete.trim() && !isKnown(r.athlete)).length;

  return (
    <section className="space-y-4">
      {report && (
        <div className="card space-y-2 p-4" role="status" aria-live="polite">
          <p className="flex items-center gap-2 text-sm font-extrabold text-ink"><CheckIcon size={16} className="text-success" /> Added {report.matchesCreated} match{report.matchesCreated === 1 ? "" : "es"}{report.clientsCreated ? ` and ${report.clientsCreated} new client${report.clientsCreated === 1 ? "" : "s"}` : ""}.</p>
          {report.skipped.length > 0 && <ul className="list-disc pl-5 text-xs text-danger">{report.skipped.map((s) => <li key={`${s.line}-${s.reason}`}>Row {s.line}: {s.reason}</li>)}</ul>}
          <Link href={`/watcher?event=${eventId}`} className="btn-secondary mt-1 inline-flex">Open the watcher</Link>
        </div>
      )}

      <div className="card space-y-3 p-5">
        <label className="block">
          <span className="label">Bracket photo or screenshot</span>
          <input ref={fileRef} type="file" accept="image/*" className="input py-2" disabled={busy} onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
        </label>
        <p className="hint">One bracket per picture reads best. The names, round, mat, time and result are read for you to check. Nothing is saved until you add the rows below.</p>
        {busy && <p className="text-sm font-semibold text-ink" role="status">Reading the bracket… this takes a few seconds.</p>}
        {error && <p className="flex gap-2 rounded-lg bg-danger-soft px-3 py-2 text-sm font-semibold text-danger" role="alert"><AlertIcon size={16} className="mt-px shrink-0" /> {error}</p>}
      </div>

      {extracted && (
        <div className="card space-y-3 p-4">
          <div className="flex flex-wrap items-start gap-3">
            {preview && <img src={preview} alt="The uploaded bracket" className="h-28 w-auto rounded-lg border border-line object-contain" />}
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-bold text-ink">Read from the picture: {extracted.ageGroup ?? "age group not printed"} · {extracted.division ?? "division not printed"}</p>
              <p className="text-muted">{rows.length} row{rows.length === 1 ? "" : "s"}. Correct anything that was misread, untick rows you do not want, then add them. Names in <span className="font-semibold text-ink">bold</span> match a client in this event.</p>
              {extracted.unreadable.length > 0 && (
                <ul className="mt-1 list-disc pl-5 text-xs text-amber-800">{extracted.unreadable.map((u) => <li key={u}>Could not read: {u}</li>)}</ul>
              )}
            </div>
          </div>

          <div className="-mx-4 overflow-x-auto px-4">
            <table className="w-full min-w-[56rem] text-sm">
              <caption className="sr-only">Rows read from the bracket, for review</caption>
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-muted">
                  <th scope="col" className="px-1 py-2 font-bold">Keep</th>
                  <th scope="col" className="px-1 py-2 font-bold">Athlete</th>
                  <th scope="col" className="px-1 py-2 font-bold">Opponent</th>
                  <th scope="col" className="px-1 py-2 font-bold">Round</th>
                  <th scope="col" className="px-1 py-2 font-bold">Mat</th>
                  <th scope="col" className="px-1 py-2 font-bold">Time</th>
                  <th scope="col" className="px-1 py-2 font-bold">Status</th>
                  <th scope="col" className="px-1 py-2 font-bold">Result</th>
                  <th scope="col" className="px-1 py-2 font-bold"><span className="sr-only">Remove</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.key} className={cn("border-t border-line", !r.keep && "opacity-50")}>
                    <td className="px-1 py-1.5"><input type="checkbox" checked={r.keep} onChange={(e) => patch(r.key, { keep: e.target.checked })} className="h-5 w-5 accent-primary" aria-label={`Keep row ${i + 1}`} /></td>
                    <td className="px-1 py-1.5">
                      <input className={cn("input min-h-10 w-44", isKnown(r.athlete) && "font-bold")} value={r.athlete} onChange={(e) => patch(r.key, { athlete: e.target.value })} aria-label={`Row ${i + 1} athlete`} list="bracket-client-names" />
                      {r.athlete.trim() && !isKnown(r.athlete) && <span className="block text-[11px] text-amber-800">Not a client yet</span>}
                    </td>
                    <td className="px-1 py-1.5"><input className="input min-h-10 w-40" value={r.opponent ?? ""} onChange={(e) => patch(r.key, { opponent: e.target.value || null })} aria-label={`Row ${i + 1} opponent`} /></td>
                    <td className="px-1 py-1.5"><input className="input min-h-10 w-32" value={r.round ?? ""} onChange={(e) => patch(r.key, { round: e.target.value || null })} aria-label={`Row ${i + 1} round`} /></td>
                    <td className="px-1 py-1.5"><input className="input min-h-10 w-20" value={r.mat ?? ""} onChange={(e) => patch(r.key, { mat: e.target.value || null })} aria-label={`Row ${i + 1} mat`} /></td>
                    <td className="px-1 py-1.5"><input className="input min-h-10 w-20" value={r.time ?? ""} onChange={(e) => patch(r.key, { time: e.target.value || null })} placeholder="HH:MM" aria-label={`Row ${i + 1} time`} /></td>
                    <td className="px-1 py-1.5">
                      <select className="input min-h-10 w-28" value={r.status} onChange={(e) => patch(r.key, { status: e.target.value as MatchStatus })} aria-label={`Row ${i + 1} status`}>
                        {MATCH_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                      </select>
                    </td>
                    <td className="px-1 py-1.5"><input className="input min-h-10 w-36" value={r.result ?? ""} onChange={(e) => patch(r.key, { result: e.target.value || null })} aria-label={`Row ${i + 1} result`} /></td>
                    <td className="px-1 py-1.5"><button type="button" className="btn-ghost min-h-10 w-10 px-0 text-muted" aria-label={`Remove row ${i + 1}`} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}><TrashIcon size={16} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <datalist id="bracket-client-names">{clientNames.map((n) => <option key={n} value={n} />)}</datalist>
          </div>

          <label className="flex min-h-11 items-center gap-3 rounded-xl border border-line px-3">
            <input type="checkbox" checked={createMissing} onChange={(e) => setCreateMissing(e.target.checked)} className="h-5 w-5 accent-primary" />
            <span className="text-sm font-semibold text-ink">Add names that are not clients yet as new clients{unknownKept ? ` (${unknownKept})` : ""} <span className="font-normal text-muted">(otherwise those rows are skipped)</span></span>
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary min-h-11" onClick={apply} disabled={pending || busy} aria-busy={pending}><CheckIcon size={16} /> {pending ? "Adding…" : `Add ${rows.filter((r) => r.keep).length} match${rows.filter((r) => r.keep).length === 1 ? "" : "es"}`}</button>
            <button type="button" className="btn-ghost min-h-11" onClick={() => { setRows([]); setExtracted(null); setPreview(null); }} disabled={pending}>Discard</button>
          </div>
        </div>
      )}
    </section>
  );
}
