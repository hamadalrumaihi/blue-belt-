import { NextResponse } from "next/server";
import { planCallback } from "@/lib/auth/callback";
import { createLogger } from "@/lib/log";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Turns an e-mailed Supabase link into a session cookie, then sends the
 * visitor on. Accepts the token-hash form (works from any browser or
 * device) and the PKCE code form (same browser only). A link that cannot
 * be verified goes back to the matching sign-in page with `?error=link`:
 * client links to the client portal sign-in, staff links to the studio
 * sign-in. Tokens are never logged.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const log = createLogger({ route: "auth/callback" });
  const plan = planCallback({
    tokenHash: searchParams.get("token_hash"),
    type: searchParams.get("type"),
    code: searchParams.get("code"),
    next: searchParams.get("next"),
  });

  if (plan.kind === "invalid") {
    log.warn("auth.callback.invalid", { hasType: searchParams.has("type") });
    return NextResponse.redirect(`${origin}${plan.onError}`);
  }

  const supabase = await createClient();
  const { error } = plan.kind === "token_hash" ? await supabase.auth.verifyOtp({ type: plan.type, token_hash: plan.tokenHash }) : await supabase.auth.exchangeCodeForSession(plan.code);
  if (!error) return NextResponse.redirect(`${origin}${plan.next}`);

  log.warn("auth.callback.failed", { kind: plan.kind, type: plan.kind === "token_hash" ? plan.type : null, code: error.code ?? null, status: error.status ?? null });
  return NextResponse.redirect(`${origin}${plan.onError}`);
}
