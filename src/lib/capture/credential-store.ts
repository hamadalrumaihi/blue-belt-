import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json, PhotoCaptureCredentialRow } from "@/lib/supabase/database.types";
import { credentialState, hashCaptureToken, type CredentialState } from "./credentials";

type Client = SupabaseClient<Database>;

export type CredentialLookup =
  | { ok: true; credential: PhotoCaptureCredentialRow }
  | { ok: false; reason: "UNKNOWN" | CredentialState };

/**
 * Resolves a presented capture token to its credential row. Runs on the
 * service client (there is no user session on machine intake), so every
 * later query must scope by `credential.owner_id` explicitly.
 */
export async function findCredentialByToken(supabase: Client, token: string, now: Date): Promise<CredentialLookup> {
  const { data, error } = await supabase.from("photo_capture_credentials").select("*").eq("token_hash", hashCaptureToken(token)).maybeSingle();
  if (error) throw new Error(`photo_capture_credentials lookup: ${error.message}`);
  if (!data) return { ok: false, reason: "UNKNOWN" };
  const state = credentialState(data, now);
  if (state !== "active") return { ok: false, reason: state };
  return { ok: true, credential: data };
}

/** Records a successful use (best effort; never fails the request). */
export async function touchCredential(supabase: Client, credential: PhotoCaptureCredentialRow, now: Date): Promise<void> {
  await supabase
    .from("photo_capture_credentials")
    .update({ last_used_at: now.toISOString(), use_count: (credential.use_count ?? 0) + 1 })
    .eq("id", credential.id)
    .eq("owner_id", credential.owner_id)
    .then(() => undefined, () => undefined);
}

/** Stores the agent's heartbeat (redacted scalar status only). */
export async function recordHeartbeat(supabase: Client, credential: PhotoCaptureCredentialRow, input: { now: Date; agentVersion: string | null; status: Json }): Promise<void> {
  const { error } = await supabase
    .from("photo_capture_credentials")
    .update({ last_heartbeat_at: input.now.toISOString(), agent_version: input.agentVersion, agent_status: input.status })
    .eq("id", credential.id)
    .eq("owner_id", credential.owner_id);
  if (error) throw new Error(`photo_capture_credentials heartbeat: ${error.message}`);
}
