"use server";

import { revalidatePath } from "next/cache";
import { generateCaptureToken } from "@/lib/capture/credentials";
import { sourceKey } from "@/lib/capture/source-identity";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/validation";

/**
 * Owner-side management of capture credentials (Settings → Capture agent).
 * Runs through the user's client, so RLS scopes rows to the signed-in owner.
 * The token is returned exactly once, from createCaptureCredential; only its
 * hash is stored.
 */
export type CredentialActionResult = { ok: true } | { ok: false; error: string };
export type CreateCredentialResult = { ok: true; token: string; expiresAt: string; name: string } | { ok: false; error: string };

export const MAX_CREDENTIAL_DAYS = 14;

export async function createCaptureCredential(input: { name: string; days: number; eventId?: string | null }): Promise<CreateCredentialResult> {
  const name = String(input.name ?? "").trim().slice(0, 60);
  if (!name) return { ok: false, error: "Give the credential a name (e.g. the laptop it runs on)." };
  const days = Number(input.days);
  if (!Number.isInteger(days) || days < 1 || days > MAX_CREDENTIAL_DAYS) return { ok: false, error: `Expiry must be between 1 and ${MAX_CREDENTIAL_DAYS} days.` };
  const eventId = input.eventId ?? null;
  if (eventId !== null && !isUuid(eventId)) return { ok: false, error: "Invalid event." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You are signed out." };

  let scopeSourceKeys: string[] | null = null;
  if (eventId) {
    // Scope to the sources the event's clients use today; new clients added later
    // need a new credential (or an unscoped one), which keeps the blast radius explicit.
    const { data: athletes, error } = await supabase.from("photo_athletes").select("source_url").eq("owner_id", user.id).eq("event_id", eventId).eq("active", true).limit(500);
    if (error) return { ok: false, error: error.message };
    scopeSourceKeys = [...new Set((athletes ?? []).map((a) => sourceKey(a.source_url)).filter((k): k is string => Boolean(k)))];
  }

  const { token, prefix, hash } = generateCaptureToken();
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  const { error } = await supabase.from("photo_capture_credentials").insert({ owner_id: user.id, name, token_hash: hash, token_prefix: prefix, scope_source_keys: scopeSourceKeys, scope_event_id: eventId, expires_at: expiresAt });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings");
  return { ok: true, token, expiresAt, name };
}

export async function revokeCaptureCredential(id: string): Promise<CredentialActionResult> {
  if (!isUuid(id)) return { ok: false, error: "Invalid credential." };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You are signed out." };
  const { data, error } = await supabase.from("photo_capture_credentials").update({ revoked_at: new Date().toISOString() }).eq("id", id).eq("owner_id", user.id).is("revoked_at", null).select("id");
  if (error) return { ok: false, error: error.message };
  if (!data?.length) return { ok: false, error: "Credential not found or already revoked." };
  revalidatePath("/settings");
  return { ok: true };
}
