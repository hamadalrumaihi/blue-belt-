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
    const owned = await supabase.from("photo_events").select("id", { count: "exact", head: true });
    if ((owned.count ?? 0) > 0) role = "owner";
  }
  return { userId: user.id, email: user.email ?? null, role };
});

export function isStudioRole(role: ProfileRole): boolean {
  return role === "owner" || role === "staff";
}
