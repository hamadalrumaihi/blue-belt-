import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuditActorKind, Database, Json } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;

export type AuditInput = {
  ownerId: string;
  actorId?: string | null;
  actorKind?: AuditActorKind;
  entity: "booking" | "document" | "payment" | "gallery" | "lead" | "person" | "organization" | "order" | "service" | "studio";
  entityId?: string | null;
  action: string;
  data?: Record<string, Json | undefined>;
};

/**
 * Append one audit row. Never throws: an audit failure is logged by the
 * caller's logger, not surfaced to the user, and never blocks the action.
 * With the user client RLS requires actor_id = auth.uid(); the service
 * client (webhooks, public forms) passes `actorKind` 'system' / 'public'.
 */
export async function writeAudit(supabase: Client, input: AuditInput): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from("photo_audit_log").insert({
    owner_id: input.ownerId,
    actor_id: input.actorId ?? null,
    actor_kind: input.actorKind ?? "owner",
    entity: input.entity,
    entity_id: input.entityId ?? null,
    action: input.action,
    data: (input.data ?? {}) as Json,
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}
