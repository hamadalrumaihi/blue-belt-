"use client";

import { useState, useTransition } from "react";
import { createCaptureCredential, revokeCaptureCredential } from "@/lib/actions/capture-credentials";
import type { CaptureAgentState, CredentialView } from "@/lib/capture/settings";
import { cn } from "@/lib/utils";

type Props = { configured: boolean; state: CaptureAgentState; /** Server time (ISO) the state was read at; keeps the render pure. */ now: string };

/**
 * Owner-only management of capture credentials for the Windows event-session
 * agent. The token is shown once, right after creation; afterwards only its
 * prefix, expiry, last use and the agent's last heartbeat are visible.
 */
export function CaptureAgentSettings({ configured, state, now }: Props) {
  const nowMs = new Date(now).getTime();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ token: string; name: string; expiresAt: string } | null>(null);
  const [name, setName] = useState("");
  const [days, setDays] = useState(3);
  const [eventId, setEventId] = useState<string>("");
  const [copied, setCopied] = useState(false);

  function create() {
    setError(null);
    startTransition(async () => {
      const res = await createCaptureCredential({ name, days, eventId: eventId || null });
      if (!res.ok) return setError(res.error);
      setIssued({ token: res.token, name: res.name, expiresAt: res.expiresAt });
      setName("");
    });
  }

  function revoke(id: string) {
    setError(null);
    startTransition(async () => {
      const res = await revokeCaptureCredential(id);
      if (!res.ok) setError(res.error);
    });
  }

  async function copyToken() {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.token);
      setCopied(true);
    } catch {
      setError("Could not copy. Select the token and copy it by hand.");
    }
  }

  return (
    <section className="card space-y-4 p-5" aria-labelledby="capture-agent-heading">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="capture-agent-heading" className="text-base font-bold text-ink">Capture agent (Windows)</h2>
          <p className="mt-1 text-sm text-muted">A small program on your event laptop keeps the bracket pages open in a real browser and sends what it sees every minute. It signs in with a credential you create here — never with your account password or any server key — and you can revoke it at any time.</p>
        </div>
        <span className={cn("shrink-0 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider", configured ? "bg-lightblue text-primary" : "bg-page text-muted")}>{configured ? "Available" : "Not configured on the server"}</span>
      </div>

      {issued ? (
        <div className="rounded-xl border-2 border-primary bg-lightblue/40 p-4" aria-live="polite">
          <p className="eyebrow">Credential “{issued.name}” — copy it now</p>
          <p className="mt-1 text-xs text-muted">This is the only time the token is shown. Paste it into the agent&rsquo;s <code>agent.env</code> as <code>CAPTURE_TOKEN</code>. Expires {new Date(issued.expiresAt).toLocaleString()}.</p>
          <pre className="mt-2 overflow-x-auto rounded-lg bg-white p-3 font-mono text-xs text-ink">{issued.token}</pre>
          <div className="mt-2 flex gap-2">
            <button type="button" className="btn-primary" onClick={copyToken}>{copied ? "Copied" : "Copy token"}</button>
            <button type="button" className="btn-ghost" onClick={() => { setIssued(null); setCopied(false); }}>Done</button>
          </div>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
          <label className="block text-sm">
            <span className="mb-1 block font-semibold text-ink">Name</span>
            <input className="input" placeholder="Event laptop" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} disabled={!configured || pending} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-semibold text-ink">Expires in</span>
            <select className="input" value={days} onChange={(e) => setDays(Number(e.target.value))} disabled={!configured || pending}>
              {[1, 2, 3, 5, 7, 14].map((d) => (
                <option key={d} value={d}>{d} day{d === 1 ? "" : "s"}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-semibold text-ink">Scope</span>
            <select className="input" value={eventId} onChange={(e) => setEventId(e.target.value)} disabled={!configured || pending}>
              <option value="">All my events</option>
              {state.events.map((e) => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </select>
          </label>
          <button type="button" className="btn-primary" onClick={create} disabled={!configured || pending}>Create credential</button>
        </div>
      )}

      {error && <p className="text-sm text-danger" role="alert">{error}</p>}

      {state.credentials.length > 0 && (
        <ul className="divide-y divide-line">
          {state.credentials.map((c) => (
            <CredentialRow key={c.id} c={c} nowMs={nowMs} pending={pending} onRevoke={() => revoke(c.id)} />
          ))}
        </ul>
      )}
      <p className="text-xs text-muted">Setup steps for the laptop are in <code>docs/windows-agent.md</code>. A credential only lets the agent send pages for your own clients; it cannot read orders, settings or anyone else&rsquo;s data.</p>
    </section>
  );
}

function CredentialRow({ c, nowMs, pending, onRevoke }: { c: CredentialView; nowMs: number; pending: boolean; onRevoke: () => void }) {
  const heartbeat = c.lastHeartbeatAt ? ageLabel(c.lastHeartbeatAt, nowMs) : null;
  const live = c.state === "active" && c.lastHeartbeatAt && nowMs - new Date(c.lastHeartbeatAt).getTime() < 3 * 60_000;
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
      <div className="min-w-0">
        <p className="font-semibold text-ink">
          {c.name} <span className="font-mono text-xs text-muted">{c.prefix}…</span>
          {c.eventName ? <span className="ml-1 text-xs text-muted">· {c.eventName}{c.scopedSources !== null ? ` (${c.scopedSources} source${c.scopedSources === 1 ? "" : "s"})` : ""}</span> : null}
        </p>
        <p className="text-xs text-muted">
          {c.state === "active" ? `Expires ${new Date(c.expiresAt).toLocaleString()}` : c.state === "expired" ? "Expired" : "Revoked"}
          {c.lastUsedAt ? ` · used ${c.useCount}× (last ${ageLabel(c.lastUsedAt, nowMs)})` : " · never used"}
          {heartbeat ? ` · agent ${live ? "online" : "last seen"} ${heartbeat}${c.agentState ? ` (${c.agentState}${c.agentPausedReason ? `: ${c.agentPausedReason}` : ""})` : ""}${c.agentSpooled ? ` · ${c.agentSpooled} queued` : ""}` : ""}
        </p>
      </div>
      {c.state === "active" && (
        <button type="button" className="btn-secondary border-danger/40 text-danger" disabled={pending} onClick={onRevoke}>Revoke</button>
      )}
    </li>
  );
}

function ageLabel(iso: string, nowMs: number): string {
  const s = Math.max(0, Math.round((nowMs - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
