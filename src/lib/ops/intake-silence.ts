import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { enqueueOwnerTelegram } from "@/lib/notifications/owner";

type Client = SupabaseClient<Database>;

/**
 * "Is the Pic-Time Zap still delivering?" seen from the app's side.
 *
 * Zapier's SDK does not expose a classic Zap's on/off state or its run
 * history (docs/ops.md), and a Zap POST is indistinguishable from any other
 * caller of /api/orders/intake. What the app does know is when each orders
 * credential (`bbmo_`) was last used, which is exactly what the Settings card
 * shows. This check turns that into [System] Telegram alerts:
 *
 *   silent     the newest use of any orders credential is older than the threshold
 *   never_used an active credential older than the threshold has never been used
 *   no_credential every orders credential is revoked or expired (the Zap now gets 401)
 *   expiring   the active credential expires within EXPIRY_WARN_DAYS
 *
 * Each condition's alert key names the state it was raised for (the last-use
 * timestamp, the credential id), so the 15-minute tick never repeats an alert
 * for the same condition, while a new silence after a later order raises a
 * new one. Read-only apart from the outbox rows.
 */
export const DEFAULT_SILENCE_HOURS = 168;
export const EXPIRY_WARN_DAYS = 7;
const MAX_SILENCE_HOURS = 24 * 90;

export type OrdersCredential = {
  id: string;
  owner_id: string;
  last_used_at: string | null;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
};

export type IntakeCondition = "silent" | "never_used" | "no_credential" | "expiring";

export type IntakeAlert = {
  ownerId: string;
  condition: IntakeCondition;
  alertKey: string;
  title: string;
  lines: string[];
};

/** ORDERS_INTAKE_SILENCE_HOURS: hours without an order before alerting (default 168 = 7 days); 0 turns the silence alert off. */
export function silenceThresholdHours(env: Record<string, string | undefined> = process.env): number {
  const raw = env.ORDERS_INTAKE_SILENCE_HOURS;
  if (raw === undefined || raw.trim() === "") return DEFAULT_SILENCE_HOURS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_SILENCE_HOURS;
  return Math.min(Math.round(n), MAX_SILENCE_HOURS);
}

const ms = (iso: string) => new Date(iso).getTime();
const day = (iso: string) => iso.slice(0, 10);

function ageLabel(hours: number): string {
  return hours < 48 ? `${Math.round(hours)} hours` : `${Math.round(hours / 24)} days`;
}

const CAUSES = "Possible causes: the Pic-Time Zap is off or erroring in Zapier, its Pic-Time connection expired, or no order was approved in Pic-Time in that time (the Zap only fires on approval).";

/** Pure: which alerts each owner's orders credentials call for right now. */
export function assessIntakeSilence(credentials: OrdersCredential[], now: Date, thresholdHours: number): IntakeAlert[] {
  const byOwner = new Map<string, OrdersCredential[]>();
  for (const c of credentials) byOwner.set(c.owner_id, [...(byOwner.get(c.owner_id) ?? []), c]);
  const t = now.getTime();
  const alerts: IntakeAlert[] = [];

  for (const [ownerId, creds] of byOwner) {
    const newestFirst = [...creds].sort((a, b) => ms(b.created_at) - ms(a.created_at));
    const active = newestFirst.filter((c) => !c.revoked_at && ms(c.expires_at) > t);
    const lastUse = creds.map((c) => c.last_used_at).filter((v): v is string => Boolean(v)).sort((a, b) => ms(b) - ms(a))[0] ?? null;

    if (!active.length) {
      alerts.push({
        ownerId,
        condition: "no_credential",
        alertKey: `ops:orders-intake:no-credential:${newestFirst[0].id}`,
        title: "Order intake has no valid credential",
        lines: ["Every orders credential is revoked or expired, so the Pic-Time Zap's requests are now refused (401).", "Create a new credential in Settings → Orders intake and paste it into the Zap's Authorization header."],
      });
      continue;
    }

    // The active credential that lives longest decides whether a lapse is near.
    const longest = [...active].sort((a, b) => ms(b.expires_at) - ms(a.expires_at))[0];
    const daysLeft = (ms(longest.expires_at) - t) / 86_400_000;
    if (daysLeft <= EXPIRY_WARN_DAYS) {
      alerts.push({
        ownerId,
        condition: "expiring",
        alertKey: `ops:orders-intake:expiring:${longest.id}`,
        title: `Order intake credential expires in ${Math.max(1, Math.ceil(daysLeft))} day${Math.ceil(daysLeft) <= 1 ? "" : "s"}`,
        lines: [`Expires ${day(longest.expires_at)}. After that the Pic-Time Zap's requests are refused.`, "Create a new credential in Settings → Orders intake and update the Zap's Authorization header."],
      });
    }

    if (thresholdHours <= 0) continue;
    if (lastUse) {
      const hours = (t - ms(lastUse)) / 3_600_000;
      if (hours >= thresholdHours) {
        alerts.push({
          ownerId,
          condition: "silent",
          alertKey: `ops:orders-intake:silent:${new Date(lastUse).toISOString()}`,
          title: `No Pic-Time order received for ${ageLabel(hours)}`,
          lines: [`Last order received ${day(lastUse)}.`, CAUSES, "Check the Zap's status and Zap history in Zapier."],
        });
      }
      continue;
    }
    const oldest = active[active.length - 1];
    const hours = (t - ms(oldest.created_at)) / 3_600_000;
    if (hours >= thresholdHours) {
      alerts.push({
        ownerId,
        condition: "never_used",
        alertKey: `ops:orders-intake:silent:never:${oldest.id}`,
        title: `No Pic-Time order received since the credential was created ${ageLabel(hours)} ago`,
        lines: [CAUSES, "Check that the Zap is on and uses this credential, then run its test step."],
      });
    }
  }
  return alerts;
}

export type IntakeSilenceSummary = { owners: number; alerts: number; queued: number; conditions: Partial<Record<IntakeCondition, number>> };

export async function runIntakeSilenceCheck({ supabase, now, site, thresholdHours }: { supabase: Client; now: Date; site: string; thresholdHours: number }): Promise<IntakeSilenceSummary> {
  const { data, error } = await supabase
    .from("photo_capture_credentials")
    .select("id, owner_id, last_used_at, created_at, expires_at, revoked_at")
    .eq("kind", "orders")
    .limit(500);
  if (error) throw new Error(`orders credentials: ${error.message}`);
  const rows = (data ?? []) as OrdersCredential[];
  const alerts = assessIntakeSilence(rows, now, thresholdHours);
  const summary: IntakeSilenceSummary = { owners: new Set(rows.map((r) => r.owner_id)).size, alerts: alerts.length, queued: 0, conditions: {} };
  for (const a of alerts) {
    summary.conditions[a.condition] = (summary.conditions[a.condition] ?? 0) + 1;
    const out = await enqueueOwnerTelegram(supabase, { ownerId: a.ownerId, kind: "INTEGRATION_FAILED", alertKey: a.alertKey, title: a.title, lines: a.lines, url: `${site}/settings`, now });
    if (out.queued) summary.queued += 1;
  }
  return summary;
}
