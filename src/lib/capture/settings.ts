import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { credentialState, type CredentialState } from "./credentials";

type Client = SupabaseClient<Database>;

export type CredentialView = {
  id: string;
  name: string;
  prefix: string;
  state: CredentialState;
  expiresAt: string;
  createdAt: string;
  lastUsedAt: string | null;
  useCount: number;
  lastHeartbeatAt: string | null;
  agentVersion: string | null;
  agentState: string | null;
  agentPausedReason: string | null;
  agentSpooled: number | null;
  scopedSources: number | null;
  eventName: string | null;
};

export type CaptureAgentState = { credentials: CredentialView[]; events: Array<{ id: string; name: string }> };

export const EMPTY_CAPTURE_AGENT_STATE: CaptureAgentState = { credentials: [], events: [] };

/** Owner's credentials (never the token) and the events they can be scoped to, for Settings. */
export async function loadCaptureAgentState(supabase: Client, ownerId: string, now = new Date()): Promise<CaptureAgentState> {
  const [{ data: rows }, { data: events }] = await Promise.all([
    supabase.from("photo_capture_credentials").select("*").eq("owner_id", ownerId).order("created_at", { ascending: false }).limit(20),
    supabase.from("photo_events").select("id,name").eq("owner_id", ownerId).eq("active", true).order("event_date", { ascending: false }).limit(50),
  ]);
  const eventName = new Map((events ?? []).map((e) => [e.id, e.name]));
  const credentials: CredentialView[] = (rows ?? []).map((r) => {
    const status = r.agent_status && typeof r.agent_status === "object" && !Array.isArray(r.agent_status) ? (r.agent_status as Record<string, unknown>) : {};
    return {
      id: r.id,
      name: r.name,
      prefix: r.token_prefix,
      state: credentialState(r, now),
      expiresAt: r.expires_at,
      createdAt: r.created_at,
      lastUsedAt: r.last_used_at,
      useCount: r.use_count,
      lastHeartbeatAt: r.last_heartbeat_at,
      agentVersion: r.agent_version,
      agentState: typeof status.state === "string" ? status.state : null,
      agentPausedReason: typeof status.pausedReason === "string" ? status.pausedReason : null,
      agentSpooled: typeof status.spooled === "number" ? status.spooled : null,
      scopedSources: r.scope_source_keys ? r.scope_source_keys.length : null,
      eventName: r.scope_event_id ? eventName.get(r.scope_event_id) ?? null : null,
    };
  });
  return { credentials, events: events ?? [] };
}
