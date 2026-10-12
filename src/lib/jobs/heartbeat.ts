import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json, PhotoJobHeartbeatRow } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;

/**
 * "When did this job last run, and how did it go?" for the dashboard: one
 * row per job name, overwritten on every run. Counts only, never secrets or
 * customer data. Writes come from the service role (cron routes); the studio
 * team can read them (RLS).
 */
export const JOB_NAMES = { deliveries: "deliveries", payments: "payments", refresh: "refresh", ops: "ops" } as const;
export type JobName = (typeof JOB_NAMES)[keyof typeof JOB_NAMES];

export async function recordJobHeartbeat(supabase: Client, name: JobName, ok: boolean, summary: Record<string, Json | undefined>, now = new Date()): Promise<void> {
  const clean: Record<string, Json> = {};
  for (const [k, v] of Object.entries(summary)) if (v !== undefined) clean[k] = v;
  const { error } = await supabase.from("photo_job_heartbeats").upsert({ name, ran_at: now.toISOString(), ok, summary: clean as Json }, { onConflict: "name" });
  if (error) throw new Error(`heartbeat ${name}: ${error.message}`);
}

export async function loadJobHeartbeats(supabase: Client): Promise<Record<string, PhotoJobHeartbeatRow>> {
  const { data } = await supabase.from("photo_job_heartbeats").select("*").limit(20);
  return Object.fromEntries((data ?? []).map((r) => [r.name, r]));
}

/** "2 min ago" / "never", for a heartbeat timestamp. */
export function heartbeatAge(ranAt: string | null | undefined, now: Date): string {
  if (!ranAt) return "never";
  const s = Math.max(0, Math.round((now.getTime() - new Date(ranAt).getTime()) / 1000));
  if (s < 90) return `${s}s ago`;
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 172_800) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86_400)} days ago`;
}
