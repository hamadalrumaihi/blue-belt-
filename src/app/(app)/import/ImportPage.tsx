"use client";

import Link from "next/link";
import { useMemo, useState, useSyncExternalStore } from "react";
import { FormError, FormField } from "@/components/FormField";
import { useNow } from "@/hooks/useNow";
import { CheckIcon } from "@/components/icons";
import { watchStateCopy } from "@/components/watchStateCopy";
import { buildBookmarklet, buildShortcutScript, clearPendingImport, parsePendingImport, readPendingImport, subscribePendingImport, urlFromHtml } from "@/lib/pending-import";
import { cn } from "@/lib/utils";
import type { ImportPreview, ImportPreviewRow } from "@/lib/import-service";
import type { RefreshResult } from "@/lib/watch-service";

type Props = { appOrigin: string; initialUrl: string };

type CaptureSummary = { captureId: string; transport: string; capturedAt: string; completeness: string; replayed: boolean };

type ImportResponse =
  | { ok: true; url: string; matched: number; results: RefreshResult[]; checkedAt: string; capture?: CaptureSummary }
  | { ok?: false; error: string; code: string; url?: string; candidates?: string[]; retryAfterSeconds?: number; capture?: CaptureSummary };

type PreviewOk = Extract<ImportPreview, { ok: true }>;

const serverSnapshot = () => null;

/**
 * Two ways in: a page handed over by the bookmarklet / Shortcut (parked in
 * sessionStorage by /api/import/receive) or HTML pasted by hand. Either way
 * the photographer confirms with one tap and sees the per-client outcome.
 */
export function ImportPage({ appOrigin, initialUrl }: Props) {
  const pendingRaw = useSyncExternalStore(subscribePendingImport, readPendingImport, serverSnapshot);
  const pending = useMemo(() => parsePendingImport(pendingRaw), [pendingRaw]);
  const now = useNow(30_000);
  const pendingStale = Boolean(pending?.capturedAt && now && now.getTime() - new Date(pending.capturedAt).getTime() > 10 * 60_000);

  const [url, setUrl] = useState(initialUrl);
  const [html, setHtml] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<string[]>([]);
  const [preview, setPreview] = useState<PreviewOk | null>(null);
  const [result, setResult] = useState<Extract<ImportResponse, { ok: true }> | null>(null);
  const [copied, setCopied] = useState<"bookmarklet" | "shortcut" | null>(null);

  const effectiveUrl = pending?.url ?? url;
  const effectiveHtml = pending?.html ?? html;
  // One capture id per pasted page too, so a retried Apply replays instead of re-applying.
  const [pastedCaptureId, setPastedCaptureId] = useState<string>(() => newCaptureId());
  const bookmarklet = useMemo(() => buildBookmarklet(appOrigin), [appOrigin]);
  const shortcutScript = useMemo(() => buildShortcutScript(appOrigin), [appOrigin]);

  function targetOrError(): { url: string; html: string } | null {
    const targetUrl = (effectiveUrl || urlFromHtml(effectiveHtml) || "").trim();
    if (!targetUrl) {
      setError("Enter the page URL (the bracket or athlete page the clients use as their source).");
      return null;
    }
    if (!effectiveHtml.trim()) {
      setError("Paste the page's HTML, or send the page from your browser with the bookmarklet.");
      return null;
    }
    return { url: targetUrl, html: effectiveHtml };
  }

  /** Step 1: preview the outcome without persisting anything. */
  async function runPreview() {
    setError(null);
    setCandidates([]);
    setResult(null);
    setPreview(null);
    const t = targetOrError();
    if (!t) return;
    setBusy(true);
    try {
      const res = await fetch("/api/import?preview=1", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(t) });
      const body = (await res.json().catch(() => null)) as ImportPreview | { error: string; code: string; candidates?: string[] } | null;
      if (!res.ok || !body || !("ok" in body) || body.ok !== true) {
        setError(body && "error" in body ? body.error : `Preview failed (${res.status}).`);
        if (body && "candidates" in body && Array.isArray(body.candidates)) setCandidates(body.candidates);
        return;
      }
      setPreview(body);
    } catch {
      setError("Network problem while reading the page. Try again.");
    } finally {
      setBusy(false);
    }
  }

  /** Step 2: apply the previewed page to its clients. */
  async function apply() {
    if (!preview) return;
    setError(null);
    setBusy(true);
    try {
      const capture = pending
        ? { captureId: pending.captureId ?? pastedCaptureId, ...(pending.capturedAt ? { capturedAt: pending.capturedAt } : {}), finalUrl: pending.url, transport: "handoff" }
        : { captureId: pastedCaptureId, transport: "import" };
      const res = await fetch("/api/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: preview.url, html: effectiveHtml, capture }) });
      const body = (await res.json().catch(() => null)) as ImportResponse | null;
      if (!res.ok || !body || body.ok !== true) {
        setError(body && "error" in body ? body.error : `Import failed (${res.status}).`);
        if (body && "code" in body && (body.code === "STALE_CAPTURE" || body.code === "CAPTURE_TIMING")) {
          // This page can never apply; a fresh capture is needed.
          if (pending) clearPendingImport();
          setPreview(null);
        }
        return;
      }
      setResult(body);
      setPreview(null);
      if (pending) clearPendingImport();
      setHtml("");
      setPastedCaptureId(newCaptureId());
    } catch {
      setError("Network problem while importing. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function pasteFromClipboard() {
    setError(null);
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) return setError("Clipboard is empty.");
      setHtml(text);
      if (!url) {
        const guessed = urlFromHtml(text);
        if (guessed) setUrl(guessed);
      }
    } catch {
      setError("Could not read the clipboard. Paste into the box instead.");
    }
  }

  async function copy(text: string, which: "bookmarklet" | "shortcut") {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
    } catch {
      setError("Could not copy. Select the text and copy it by hand.");
    }
  }

  return (
    <div className="space-y-4">
      <section className="card p-4">
        <p className="eyebrow">Why this exists</p>
        <p className="mt-1 text-sm text-muted">Your browser can open this page, but our automatic worker is blocked by the site&rsquo;s security check. Import the schedule you can see to update your clients. The data is a snapshot from the moment you capture it, not a live connection, so re-import when you need fresh times.</p>
      </section>

      {pending ? (
        <section className="card border-2 border-primary p-4" aria-live="polite">
          <p className="eyebrow">Page received from your browser</p>
          <p className="mt-1 break-all text-sm font-semibold text-ink">{pending.url}</p>
          <p className="mt-1 text-xs text-muted">{formatBytes(pending.html.length)} of HTML{pending.capturedAt ? ` · captured ${new Date(pending.capturedAt).toLocaleTimeString()}` : pending.receivedAt ? ` · received ${new Date(pending.receivedAt).toLocaleTimeString()}` : ""}</p>
          {pendingStale && (
            <p className="mt-1 rounded-lg bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800">This page was captured more than 10 minutes ago. Mats and times may have moved since; re-send the page if you can.</p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="btn-primary" onClick={runPreview} disabled={busy}>{busy ? "Reading…" : "Preview import"}</button>
            <button type="button" className="btn-ghost" onClick={() => { clearPendingImport(); setPreview(null); }} disabled={busy}>Discard</button>
          </div>
        </section>
      ) : (
        <section className="card p-4">
          <p className="eyebrow">Paste by hand</p>
          <div className="mt-3 space-y-3">
            <FormField label="Page URL" htmlFor="import-url" hint="The exact source URL the client(s) use. Filled from the page when it carries a canonical link.">
              <input id="import-url" className="input" inputMode="url" placeholder="https://ajptour.com/en/event/…/bracket/…" value={url} onChange={(e) => setUrl(e.target.value)} />
            </FormField>
            <FormField label="Page HTML" htmlFor="import-html" hint="Desktop: view-source, select all, copy. Phone: use the bookmarklet or Shortcut below instead.">
              <textarea id="import-html" className="input min-h-32 py-2 font-mono text-xs" value={html} onChange={(e) => setHtml(e.target.value)} spellCheck={false} />
            </FormField>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-secondary" onClick={pasteFromClipboard} disabled={busy}>Paste from clipboard</button>
              <button type="button" className="btn-primary" onClick={runPreview} disabled={busy}>{busy ? "Reading…" : "Preview import"}</button>
            </div>
          </div>
        </section>
      )}

      <FormError message={error ?? undefined} />
      {candidates.length > 0 && (
        <div className="card p-4 text-sm">
          <p className="font-semibold text-ink">Active clients watch these pages:</p>
          <ul className="mt-2 space-y-1">
            {candidates.map((c) => (
              <li key={c}>
                <button type="button" className="break-all text-left text-primary hover:underline" onClick={() => setUrl(c)}>{c}</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {preview && (
        <section className="card border-2 border-primary p-4" aria-live="polite">
          <p className="eyebrow">Preview — nothing saved yet</p>
          <p className="mt-1 text-sm font-semibold text-ink">
            {preview.found} client{preview.found === 1 ? "" : "s"} on this page · {preview.withMatches} with matches
            {preview.notFound > 0 ? ` · ${preview.notFound} not found` : ""}
          </p>
          <p className="mt-0.5 break-all text-xs text-muted">{preview.url}</p>
          <p className="mt-0.5 text-xs text-muted">Captured {new Date(preview.capturedAt).toLocaleTimeString()} — snapshot, not live.</p>
          <ul className="mt-3 divide-y divide-line">
            {preview.rows.map((r: ImportPreviewRow) => {
              const ok = r.status === "OK";
              return (
                <li key={r.athleteId} className="flex items-start gap-3 py-2">
                  <span className={cn("mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold", ok ? "bg-success/15 text-success" : "bg-amber-50 text-amber-700")} aria-hidden>{ok ? <CheckIcon size={14} /> : "!"}</span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-ink">{r.name}{r.eventName ? <span className="font-normal text-muted"> · {r.eventName}</span> : null}</p>
                    <p className="text-xs text-muted">{ok ? `${r.matches} match${r.matches === 1 ? "" : "es"} found` : watchStateCopy(r.status, r.message, r.code)}</p>
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="btn-primary" onClick={apply} disabled={busy}>{busy ? "Applying…" : `Apply to ${preview.found} client${preview.found === 1 ? "" : "s"}`}</button>
            <button type="button" className="btn-ghost" onClick={() => setPreview(null)} disabled={busy}>Cancel</button>
          </div>
        </section>
      )}

      {result && (
        <section className="card p-4" aria-live="polite">
          <p className="eyebrow">{result.capture?.replayed ? "Already imported" : "Imported"}</p>
          <p className="mt-1 text-sm font-semibold text-ink">
            {result.capture?.replayed
              ? `This capture was already applied to ${result.matched} client${result.matched === 1 ? "" : "s"}; nothing was applied twice.`
              : `Updated ${result.results.filter((r) => r.status === "OK").length} of ${result.matched} client${result.matched === 1 ? "" : "s"}${result.results.filter((r) => r.status === "ATHLETE_NOT_FOUND").length > 0 ? `; ${result.results.filter((r) => r.status === "ATHLETE_NOT_FOUND").length} not found` : ""}`}
          </p>
          <p className="mt-0.5 break-all text-xs text-muted">{result.url}</p>
          <p className="mt-0.5 text-xs text-muted">
            Captured {result.capture ? new Date(result.capture.capturedAt).toLocaleTimeString() : "—"} · imported {new Date(result.checkedAt).toLocaleTimeString()} — snapshot, not live.
            {result.capture?.completeness === "partial" ? " The capture may be incomplete (more pages or rows existed)." : ""}
          </p>
          <ul className="mt-3 divide-y divide-line">
            {result.results.map((r) => {
              const ok = r.status === "OK";
              return (
                <li key={r.athleteId} className="flex items-start gap-3 py-2">
                  <span className={cn("mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold", ok ? "bg-success/15 text-success" : "bg-amber-50 text-amber-700")} aria-hidden>{ok ? <CheckIcon size={14} /> : "!"}</span>
                  <div className="min-w-0 flex-1">
                    <Link href={`/clients/${r.athleteId}`} className="font-semibold text-ink hover:text-primary">{r.athleteName}</Link>
                    <p className="text-xs text-muted">{ok ? `${r.matches.length} match${r.matches.length === 1 ? "" : "es"} · ${r.changes.length} change${r.changes.length === 1 ? "" : "s"}` : watchStateCopy(r.status, r.message, r.code)}</p>
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="mt-3">
            <Link href="/dashboard" className="btn-secondary">Back to dashboard</Link>
          </div>
        </section>
      )}

      <section className="card p-4">
        <p className="eyebrow">Set up once on your phone</p>
        <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm text-ink">
          <li>
            <span className="font-semibold">Copy the bookmarklet.</span>{" "}
            <button type="button" className="text-primary underline" onClick={() => copy(bookmarklet, "bookmarklet")}>{copied === "bookmarklet" ? "Copied" : "Copy bookmarklet"}</button>
          </li>
          <li><span className="font-semibold">Safari (iPhone):</span> bookmark any page, then edit the bookmark: name it <em>Send to Watcher</em> and replace its address with the copied text.</li>
          <li><span className="font-semibold">Chrome (Android):</span> same, then open it by typing its name in the address bar while on the bracket page.</li>
          <li><span className="font-semibold">On event day:</span> open the bracket page, pass the check if asked, open the bookmark. You land back here with the page ready to import.</li>
        </ol>
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer font-semibold text-ink">Prefer an iOS Shortcut?</summary>
          <p className="mt-2 text-muted">Create a Shortcut that accepts <em>Safari web pages</em> from the share sheet with one action, <em>Run JavaScript on Web Page</em>, and paste this script into it:</p>
          <pre className="mt-2 overflow-x-auto rounded-xl bg-page p-3 text-[11px] leading-snug text-ink">{shortcutScript}</pre>
          <button type="button" className="mt-2 text-primary underline" onClick={() => copy(shortcutScript, "shortcut")}>{copied === "shortcut" ? "Copied" : "Copy script"}</button>
        </details>
        <p className="mt-3 text-xs text-muted">Only pages on ajptour.com and smoothcomp.com are accepted. The page is read once and not stored.</p>
      </section>
    </div>
  );
}

function newCaptureId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch {
    // Older WebViews: fall through.
  }
  return `cap-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
