"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createLinkCode, disableTelegram, enableTelegram, inspectTelegramWebhook, registerTelegramWebhook, saveTelegramSubscription } from "@/lib/actions/telegram";
import { TELEGRAM_ALERT_KINDS, TELEGRAM_KIND_LABELS, type TelegramAlertKind } from "@/lib/notifications/telegram/kinds";
import type { DeliveryHealth } from "@/lib/notifications/telegram/health";
import type { TelegramSettingsState } from "@/lib/notifications/telegram/settings";
import { WEBHOOK_VERDICT_LABEL, type WebhookSummary } from "@/lib/notifications/telegram/webhook-admin";
import { formatStamp } from "@/lib/time";
import { cn } from "@/lib/utils";

type Props = {
  /** TELEGRAM_ENABLED=1 and a bot token are set on the server. */
  configured: boolean;
  botUsername: string | null;
  state: TelegramSettingsState;
  /** Recent delivery outcomes; null when not linked or not readable. */
  health?: DeliveryHealth | null;
};

const HEALTH_TONE: Record<DeliveryHealth["verdict"], { label: string; tone: string }> = {
  working: { label: "Working", tone: "border-success/30 bg-success-soft text-success" },
  idle: { label: "No messages yet", tone: "border-line bg-page text-muted" },
  failing: { label: "Problems", tone: "border-danger/30 bg-danger-soft text-danger" },
  stuck: { label: "Messages waiting", tone: "border-amber-200 bg-amber-50 text-amber-800" },
  blocked: { label: "Stopped by Telegram", tone: "border-danger/30 bg-danger-soft text-danger" },
};

export function TelegramSettings({ configured, botUsername, state, health = null }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(state.code && state.codeExpiresAt ? { code: state.code, expiresAt: state.codeExpiresAt } : null);
  const [kinds, setKinds] = useState<TelegramAlertKind[]>(state.kinds);
  const [subscribed, setSubscribed] = useState(state.subscriptionEnabled);
  const [webhook, setWebhook] = useState<{ summary: WebhookSummary; message?: string } | null>(null);
  const [webhookBusy, setWebhookBusy] = useState<"check" | "register" | null>(null);

  function runWebhook(kind: "check" | "register") {
    setError(null);
    setWebhookBusy(kind);
    startTransition(async () => {
      const res = kind === "check" ? await inspectTelegramWebhook() : await registerTelegramWebhook();
      setWebhookBusy(null);
      if (!res.ok) setError(res.error);
      else setWebhook({ summary: res.summary, message: res.message });
    });
  }

  // Server re-renders (after an action or a manual refresh) supply fresh props.
  const [seen, setSeen] = useState(state);
  if (seen !== state) {
    setSeen(state);
    setKinds(state.kinds);
    setSubscribed(state.subscriptionEnabled);
    if (state.code && state.codeExpiresAt) setCode({ code: state.code, expiresAt: state.codeExpiresAt });
    else if (state.linked) setCode(null);
  }

  const status = !configured ? "Not configured on the server" : !state.linked ? "Not linked" : state.enabled ? `Linked to ${state.chatTitle ?? "Telegram"}` : `Paused (${state.chatTitle ?? "Telegram"})`;
  const botLabel = botUsername ? `@${botUsername}` : "the bot";

  function run(action: () => Promise<{ ok: boolean; error?: string }>, onError?: () => void) {
    setError(null);
    startTransition(async () => {
      const res = await action();
      if (!res.ok) {
        setError(res.error ?? "Something went wrong");
        onError?.();
      }
    });
  }

  function saveKinds(nextKinds: TelegramAlertKind[], nextEnabled: boolean) {
    const prevKinds = kinds;
    const prevEnabled = subscribed;
    setKinds(nextKinds);
    setSubscribed(nextEnabled);
    run(
      () => saveTelegramSubscription({ eventId: null, kinds: nextKinds, enabled: nextEnabled }),
      () => {
        setKinds(prevKinds);
        setSubscribed(prevEnabled);
      },
    );
  }

  return (
    <section className="card space-y-4 p-5" aria-labelledby="telegram-heading">
      <div className="flex items-center justify-between gap-2">
        <h2 id="telegram-heading" className="text-sm font-extrabold uppercase tracking-wider text-muted">Telegram</h2>
        <span className={cn("rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider", configured && state.linked && state.enabled ? "bg-lightblue text-primary" : "bg-page text-muted")}>{status}</span>
      </div>

      {!configured ? (
        <p className="hint">Telegram alerts are off on this server. Set <code>TELEGRAM_ENABLED=1</code> and <code>TELEGRAM_BOT_TOKEN</code> (see <code>docs/telegram.md</code>) to turn them on.</p>
      ) : (
        <>
          <p className="text-sm text-ink">{state.linked ? "Match alerts for your clients are sent to the linked Telegram chat whenever a refresh runs." : "Get match alerts in Telegram: link a chat once, then the bot messages you when a client is up."} Blocked or failing checks are reported there too, with the reason and what to do next.</p>

          {health && (
            <div className={cn("rounded-xl border px-3 py-2.5", HEALTH_TONE[health.verdict].tone)} role="status">
              <p className="text-xs font-bold uppercase tracking-wide">Delivery: {HEALTH_TONE[health.verdict].label}</p>
              <p className="mt-1 text-sm text-ink">{health.summary}</p>
              <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs text-muted">
                <dt>Last delivered</dt><dd className="text-ink">{health.lastSentAt ? formatStamp(health.lastSentAt) : "Never"}</dd>
                {health.waiting > 0 && <><dt>Waiting</dt><dd className="text-ink">{health.waiting}</dd></>}
                {health.lastError && <><dt>Last error</dt><dd className="break-words text-ink">{health.lastError}{health.lastErrorAt ? ` (${formatStamp(health.lastErrorAt)})` : ""}</dd></>}
              </dl>
            </div>
          )}

          <div className="space-y-2">
            <div className="flex flex-col gap-2 sm:flex-row">
              <button type="button" className="btn-primary" disabled={pending} onClick={() => run(async () => {
                const res = await createLinkCode();
                if (res.ok) setCode({ code: res.code, expiresAt: res.expiresAt });
                return res;
              })}>
                {state.linked ? "Link a different chat" : "Generate link code"}
              </button>
              <button type="button" className="btn-secondary" disabled={pending} onClick={() => router.refresh()}>Check status</button>
            </div>
            {code ? (
              <div className="rounded-xl border border-line bg-page p-3">
                <p className="label">Your link code</p>
                <p className="select-all font-mono text-2xl font-extrabold tracking-[0.3em] text-ink" aria-live="polite">{code.code}</p>
                <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-ink">
                  <li>Open Telegram and start {botUsername ? <a className="font-semibold text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" href={`https://t.me/${botUsername}`} target="_blank" rel="noreferrer">{botLabel}</a> : botLabel}.</li>
                  <li>Send <code className="select-all font-semibold">/start {code.code}</code></li>
                  <li>Come back and tap “Check status”.</li>
                </ol>
                <p className="hint">Expires {formatStamp(code.expiresAt)}. One use only.</p>
              </div>
            ) : null}
          </div>

          <div className="space-y-3">
            <p className="label">Send me</p>
            {TELEGRAM_ALERT_KINDS.map((k) => (
              <Toggle key={k} label={TELEGRAM_KIND_LABELS[k]} checked={kinds.includes(k)} disabled={pending} onChange={(v) => saveKinds(v ? [...kinds, k] : kinds.filter((x) => x !== k), subscribed)} />
            ))}
            <Toggle label="Telegram alerts on" checked={subscribed} disabled={pending} onChange={(v) => saveKinds(kinds, v)} />
            <p className="hint">Alerts fire when a refresh runs (the app open on any device, or the scheduled refresh). Each alert is sent once.</p>
          </div>

          <div className="space-y-2 rounded-xl border border-line p-3">
            <p className="label">Order buttons</p>
            {state.linked ? (
              state.userLinked ? (
                <p className="text-sm text-ink">Enabled for the Telegram account that linked this {state.chatType === "private" || !state.chatType ? "chat" : state.chatType}. Only that account can press Send invoice, Check payment, Retry e-mail and Done on [Orders] cards; anyone else sees “not allowed”.</p>
              ) : (
                <p className="text-sm text-amber-800">This chat was linked before the order buttons existed, so the bot does not know which Telegram account is you. Generate a new link code and send <code className="font-semibold">/start CODE</code> again from your own account; the chat stays the same.</p>
              )
            ) : (
              <p className="text-sm text-muted">Link a chat first. [Orders] cards then carry buttons (Send invoice, Check payment, Retry e-mail, Done) that only your Telegram account can use.</p>
            )}
            <p className="text-xs text-muted">Button clicks arrive only if the webhook is registered for <code>callback_query</code> updates. Check it here after every change to the bot or the site address.</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <button type="button" className="btn-secondary" disabled={pending} aria-busy={webhookBusy === "check"} onClick={() => runWebhook("check")}>{webhookBusy === "check" ? "Checking…" : "Check webhook"}</button>
              <button type="button" className="btn-secondary" disabled={pending} aria-busy={webhookBusy === "register"} onClick={() => runWebhook("register")}>{webhookBusy === "register" ? "Registering…" : "Register webhook (messages + buttons)"}</button>
            </div>
            {webhook && (
              <div className={cn("rounded-lg px-3 py-2 text-xs", webhook.summary.verdict === "ok" ? "bg-success-soft text-success" : "bg-amber-50 text-amber-800")} role="status">
                <p className="font-bold">{WEBHOOK_VERDICT_LABEL[webhook.summary.verdict]}</p>
                {webhook.message && <p className="mt-0.5 text-ink">{webhook.message}</p>}
                <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-ink">
                  {webhook.summary.registered && !webhook.summary.urlMatches && <><dt>Points at</dt><dd>{webhook.summary.registeredHost} (expected this site)</dd></>}
                  {webhook.summary.missingUpdates.length > 0 && <><dt>Missing updates</dt><dd>{webhook.summary.missingUpdates.join(", ")}</dd></>}
                  <dt>Waiting at Telegram</dt><dd>{webhook.summary.pendingUpdates}</dd>
                  {webhook.summary.lastError && <><dt>Last error</dt><dd className="break-words">{webhook.summary.lastError}{webhook.summary.lastErrorAt ? ` (${formatStamp(webhook.summary.lastErrorAt)})` : ""}</dd></>}
                </dl>
              </div>
            )}
          </div>

          {state.linked ? (
            <div className="flex flex-col gap-2 sm:flex-row">
              {state.enabled ? (
                <button type="button" className="btn-secondary border-danger/40 text-danger" disabled={pending} onClick={() => run(disableTelegram)}>Unsubscribe</button>
              ) : (
                <button type="button" className="btn-secondary" disabled={pending} onClick={() => run(enableTelegram)}>Resume alerts</button>
              )}
            </div>
          ) : null}

          {error ? <p className="text-xs font-semibold text-danger" role="alert">{error}</p> : null}
        </>
      )}
    </section>
  );
}

function Toggle({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex min-h-11 w-full items-center justify-between rounded-xl border border-line px-3 text-left text-sm font-semibold text-ink disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      {label}
      <span className={cn("relative inline-block h-6 w-11 rounded-full transition-colors", checked ? "bg-primary" : "bg-line")}>
        <span className={cn("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform", checked ? "translate-x-5" : "translate-x-0.5")} />
      </span>
    </button>
  );
}
