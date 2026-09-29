/**
 * Public Supabase configuration. Only the anon/publishable key is ever
 * exposed to the browser; RLS enforces per-owner access. Never add a
 * service-role key here.
 */
export function getSupabaseEnv(): { url: string; anonKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. Copy .env.example to .env.local and fill both values.",
    );
  }
  return { url, anonKey };
}
