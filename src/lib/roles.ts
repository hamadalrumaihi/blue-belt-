import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { ProfileRole } from "@/lib/supabase/database.types";

export type Viewer = { userId: string; email: string | null; role: ProfileRole };

const ROLES: readonly ProfileRole[] = ["owner", "staff", "client"];

/**
 * Who is signed in and what they may open. The role comes from
 * photo_profiles via the SECURITY DEFINER RPC `photo_my_role` — never from
 * the browser. A user with no profile row falls back to owner if they own
 * events, staff if they collaborate, otherwise client (the RPC does this).
 * On an RPC error the caller's own profile row is the only fallback; it
 * never infers owner from data the user could have inserted themselves.
 *
 * The studio shell admits owner + staff; the client portal admits everyone
 * signed in (RLS decides what they see). Null = signed out.
 */
export const resolveViewer = cache(async (): Promise<Viewer | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase.rpc("photo_my_role");
  // Fail closed for new users (client), but never lock an existing owner out
  // because of a transient RPC error: fall back to the pre-roles rule.
  let role: ProfileRole = "client";
  if (!error && typeof data === "string" && ROLES.includes(data as ProfileRole)) role = data as ProfileRole;
  else if (error) {
    // The profile row itself (self-select policy) is the only acceptable fallback.
    const { data: profile } = await supabase.from("photo_profiles").select("role").eq("user_id", user.id).maybeSingle();
    if (profile && ROLES.includes(profile.role)) role = profile.role;
  }
  return { userId: user.id, email: user.email ?? null, role };
});

export type StudioUser = { ok: true; viewer: Viewer } | { ok: false; error: string };

/**
 * Guard for studio server actions: a signed-in owner or staff member. A
 * client-portal account (or a signed-out caller) gets a clear error. RLS
 * (photo_is_studio_user) enforces the same rule in the database; this makes
 * the refusal visible instead of a silent "0 rows".
 */
export async function requireStudioUser(): Promise<StudioUser> {
  const viewer = await resolveViewer();
  if (!viewer) return { ok: false, error: "You are signed out." };
  if (!isStudioRole(viewer.role)) return { ok: false, error: "This action is for the studio team only." };
  return { ok: true, viewer };
}

/**
 * Guard for owner-only surfaces (pricing research, quotes): the role must be
 * exactly "owner". Staff and client accounts are refused here and again by
 * RLS (photo_is_owner_user), so a bypass of this check still reads nothing.
 */
export async function requireOwner(): Promise<StudioUser> {
  const viewer = await resolveViewer();
  if (!viewer) return { ok: false, error: "You are signed out." };
  if (viewer.role !== "owner") return { ok: false, error: "Only the studio owner can use pricing." };
  return { ok: true, viewer };
}

export function isStudioRole(role: ProfileRole): boolean {
  return role === "owner" || role === "staff";
}
