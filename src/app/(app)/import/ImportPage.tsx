"use client";

import Link from "next/link";
import { useMemo, useState, useSyncExternalStore } from "react";
import { FormError, FormField } from "@/components/FormField";
import { CheckIcon } from "@/components/icons";
import { watchStateCopy } from "@/components/watchStateCopy";
import { buildBookmarklet, buildShortcutScript, clearPendingImport, parsePendingImport, readPendingImport, subscribePendingImport, urlFromHtml } from "@/lib/pending-import";
import { cn } from "@/lib/utils";
import type { RefreshResult } from "@/lib/watch-service";

type Props = { appOrigin: string; initialUrl: string };

type ImportResponse =
  | { ok: true; url: string; matched: number; results: RefreshResult[]; checkedAt: string }
  | { ok?: false; error: string; code: string; url?: string; candidates?: string[]; retryAfterSeconds?: number };

const serverSnapshot = () => null;

/**
 * Two ways in: a page handed over by the bookmarklet / Shortcut (parked in
 * sessionStorage by /api/import/receive) or HTML pasted by hand. Either way
 * the photographer confirms with one tap and sees the per-client outcome.
 */
export function ImportPage({ appOrigin, initialUrl }: Props) {
  const pendingRaw = useSyncExternalStore(subscribePendingImport, readPendingImport, serverSnapshot);
  const pending = useMemo(() => parsePendingImport(pendingRaw), [pendingRaw]);

  const [url, setUrl] = useState(initialUrl);
  const [html, setHtml] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<string[]>([]);
  const [result, setResult] = useState<Extract<ImportResponse, { ok: true }> | null>(null);
  const [copied, setCopied] = useState<"bookmarklet" | "shortcut" | null>(null);

  const effectiveUrl = pending?.url ?? url;
  const effectiveHtml = pending?.html ?? html;
  const bookmarklet = useMemo(() => buildBookmarklet(appOrigin), [appOrigin]);
  const shortcutScript = useMemo(() => buildShortcutScript(appOrigin), [appOrigin]);

  async function submit() {
    setError(null);
    setCandidates([]);
    setResult(null);
    const targetUrl = (effectiveUrl || urlFromHtml(effectiveHtml) || "").trim();
    if (!targetUrl) return setError("Enter the page URL (the bracket or athlete page the clients use as their source).");
    if (!effectiveHtml.trim()) return setError("Paste the page's HTML, or send the page from your browser with the bookmarklet.");
    setBusy(true);
    try {
      const res = await fetch("/api/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: targetUrl, html: effectiveHtml }) });
      const body = (await res.json().catch(() => null)) as ImportResponse | null;
      if (!res.ok || !body || body.ok !== true) {
        const msg = body && "error" in body ? body.error : `Import failed (${res.status}).`;
        setError(msg);
        if (body && "candidates" in body && Array.isArray(body.candidates)) setCandidates(body.candidates);
        return;
      }
      setResult(body);
      if (pending) clearPendingImport();
      setHtml("");
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
        <p className="mt-1 text-sm text-muted">When the source site asks for a human check (CAPTCHA) the app cannot read it for you. Open the page yourself, pass the check, then hand the page over here. The schedule is read from what your browser already loaded; nothing is fetched by the server.</p>
      </section>

      {pending ? (
        <section className="card border-2 border-primary p-4" aria-live="polite">
          <p className="eyebrow">Page received from your browser</p>
          <p className="mt-1 break-all text-sm font-semibold text-ink">{pending.url}</p>
          <p className="mt-1 text-xs text-muted">{formatBytes(pending.html.length)} of HTML{pending.receivedAt ? ` · received ${new Date(pending.receivedAt).toLocaleTimeString()}` : ""}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="btn-primary" onClick={submit} disabled={busy}>{busy ? "Importing…" : "Import this page"}</button>
            <button type="button" className="btn-ghost" onClick={() => clearPendingImport()} disabled={busy}>Discard</button>
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
              <button type="button" className="btn-primary" onClick={submit} disabled={busy}>{busy ? "Importing…" : "Import"}</button>
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

      {result && (
        <section className="card p-4" aria-live="polite">
          <p className="eyebrow">Imported</p>
          <p className="mt-1 text-sm text-muted">{result.matched} client{result.matched === 1 ? "" : "s"} updated from <span className="break-all">{result.url}</span></p>
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

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
