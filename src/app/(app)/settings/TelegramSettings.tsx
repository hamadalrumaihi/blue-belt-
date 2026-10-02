"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createLinkCode, disableTelegram, enableTelegram, saveTelegramSubscription } from "@/lib/actions/telegram";
import { TELEGRAM_ALERT_KINDS, TELEGRAM_KIND_LABELS, type TelegramAlertKind } from "@/lib/notifications/telegram/kinds";
import type { TelegramSettingsState } from "@/lib/notifications/telegram/settings";
import { cn } from "@/lib/utils";

type Props = {
  /** TELEGRAM_ENABLED=1 and a bot token are set on the server. */
  configured: boolean;
  botUsername: string | null;
  state: TelegramSettingsState;
};

export function TelegramSettings({ configured, botUsername, state }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(state.code && state.codeExpiresAt ? { code: state.code, expiresAt: state.codeExpiresAt } : null);
  const [kinds, setKinds] = useState<TelegramAlertKind[]>(state.kinds);
  const [subscribed, setSubscribed] = useState(state.subscriptionEnabled);

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
          <p className="text-sm text-ink">{state.linked ? "Match alerts for your clients are sent to the linked Telegram chat whenever a refresh runs." : "Get match alerts in Telegram: link a chat once, then the bot messages you when a client is up."}</p>

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
                <p className="hint">Expires {new Date(code.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}. One use only.</p>
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
