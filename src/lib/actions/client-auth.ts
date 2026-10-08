"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { magicLinkRedirect } from "@/lib/auth/magic-link";
import { rateLimit, RULES } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { isValidEmail, trimOrNull } from "@/lib/utils";

/**
 * Client portal sign-in: a magic link e-mailed by Supabase Auth. The reply
 * is the same whether or not the address is known, so the form cannot be
 * used to find out who is a client. Rate limited per address.
 */
export type ClientAuthState = { error?: string; fieldErrors?: Record<string, string>; sent?: true } | null;

async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}

export async function requestClientMagicLink(_prev: ClientAuthState, formData: FormData): Promise<ClientAuthState> {
  const email = trimOrNull(formData.get("email"))?.toLowerCase() ?? null;
  if (!email || !isValidEmail(email) || email.length > 160) return { fieldErrors: { email: "Enter the e-mail address you booked with." } };
  const limit = rateLimit(`client-login:${await clientIp()}`, RULES.clientLoginPerIp);
  if (!limit.ok) return { error: `Too many requests. Try again in ${Math.ceil(limit.retryAfterSeconds / 60)} minutes.` };

  const supabase = await createClient();
  // Errors are deliberately not surfaced: the answer must not depend on whether the address exists.
  await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: magicLinkRedirect(), shouldCreateUser: true } });
  return { sent: true };
}

export async function signOutClient(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/client/login");
}
