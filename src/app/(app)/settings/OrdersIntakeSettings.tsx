"use client";

import { useState, useTransition } from "react";
import { createCaptureCredential, revokeCaptureCredential } from "@/lib/actions/capture-credentials";
import type { CredentialView } from "@/lib/capture/settings";
import { cn } from "@/lib/utils";

type Props = { enabled: boolean; credentials: CredentialView[]; endpoint: string; now: string };

/**
 * Owner-only: credentials for the Zap that forwards Pic-Time orders to
 * POST /api/orders/intake. Shown once at creation; revocable; separate from
 * the Windows agent's capture credentials (different prefix and kind).
 */
export function OrdersIntakeSettings({ enabled, credentials, endpoint, now }: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ token: string; expiresAt: string } | null>(null);
  const [name, setName] = useState("Zapier: Pic-Time orders");
  const [days, setDays] = useState(180);
  const nowMs = new Date(now).getTime();

  function create() {
    setError(null);
    startTransition(async () => {
      const res = await createCaptureCredential({ name, days, kind: "orders" });
      if (!res.ok) return setError(res.error);
      setIssued({ token: res.token, expiresAt: res.expiresAt });
    });
  }

  return (
    <section className="card space-y-4 p-5" aria-labelledby="orders-intake-heading">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="orders-intake-heading" className="text-base font-bold text-ink">Orders intake (Pic-Time via Zapier)</h2>
          <p className="mt-1 text-sm text-muted">A Zap posts each new Pic-Time order to this app so it shows under Orders and reaches your Telegram as an [Orders] message. Fawran and bank-transfer orders are recorded as “payment not yet confirmed” until you confirm them yourself.</p>
        </div>
        <span className={cn("shrink-0 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider", enabled ? "bg-lightblue text-primary" : "bg-page text-muted")}>{enabled ? "Enabled" : "Off on the server"}</span>
      </div>

      <dl className="grid gap-1 rounded-xl bg-page p-3 text-xs">
        <dt className="font-semibold text-ink">Webhook URL for the Zap</dt>
        <dd className="break-all font-mono text-ink">{endpoint}</dd>
        <dt className="mt-1 font-semibold text-ink">Header</dt>
        <dd className="font-mono text-ink">Authorization: Bearer &lt;credential below&gt;</dd>
        <dd className="text-muted">Field mapping: docs/orders-intake.md</dd>
      </dl>
      <p className="text-xs text-muted">
        The same credential also authorises gallery events at <code className="break-all font-mono text-ink">{endpoint.replace(/\/api\/orders\/intake$/, "/api/galleries/intake")}</code>: point the Pic-Time Zapier triggers “Main Client Gallery Invite Sent” and “New Gallery Visitor” there with the same header. An invite marks the matching gallery ready and a visit bumps its counter; nothing is e-mailed to clients from these events.
      </p>

      {issued ? (
        <div className="rounded-xl border-2 border-primary bg-lightblue/40 p-4" aria-live="polite">
          <p className="eyebrow">Copy this credential into the Zap now</p>
          <p className="mt-1 text-xs text-muted">Shown once. Expires {new Date(issued.expiresAt).toLocaleDateString()}.</p>
          <pre className="mt-2 overflow-x-auto rounded-lg bg-white p-3 font-mono text-xs text-ink">{issued.token}</pre>
          <div className="mt-2 flex gap-2">
            <button type="button" className="btn-primary" onClick={() => navigator.clipboard.writeText(issued.token).catch(() => setError("Could not copy; select the text."))}>Copy</button>
            <button type="button" className="btn-ghost" onClick={() => setIssued(null)}>Done</button>
          </div>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
          <label className="block text-sm">
            <span className="mb-1 block font-semibold text-ink">Name</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} disabled={pending} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-semibold text-ink">Expires in</span>
            <select className="input" value={days} onChange={(e) => setDays(Number(e.target.value))} disabled={pending}>
              {[30, 90, 180, 365].map((d) => <option key={d} value={d}>{d} days</option>)}
            </select>
          </label>
          <button type="button" className="btn-primary" onClick={create} disabled={pending}>Create credential</button>
        </div>
      )}
      {error && <p className="text-sm text-danger" role="alert">{error}</p>}

      {credentials.length > 0 && (
        <ul className="divide-y divide-line text-sm">
          {credentials.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div>
                <p className="font-semibold text-ink">{c.name} <span className="font-mono text-xs text-muted">{c.prefix}…</span></p>
                <p className="text-xs text-muted">{c.state === "active" ? `Expires ${new Date(c.expiresAt).toLocaleDateString()}` : c.state}{c.lastUsedAt ? ` · last order ${Math.round((nowMs - new Date(c.lastUsedAt).getTime()) / 60_000)} min ago (${c.useCount} total)` : " · no orders received yet"}</p>
              </div>
              {c.state === "active" && (
                <button type="button" className="btn-secondary border-danger/40 text-danger" disabled={pending} onClick={() => { setError(null); startTransition(async () => { const r = await revokeCaptureCredential(c.id); if (!r.ok) setError(r.error); }); }}>Revoke</button>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted">Collaborators never see orders: the Orders pages and this card are owner-only, and the database allows only the owner to read <code>photo_orders</code>.</p>
    </section>
  );
}
