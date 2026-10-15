import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { referenceNeedsReverification } from "./form";

/**
 * Market research policy and status. There is NO automated browsing or
 * search provider configured in production: evidence is observed by the
 * owner (or imported from the seeded, hand-verified dataset) and the only
 * thing the refresh job does without a provider is count what needs
 * re-verification. A provider-backed refresh may exist only when
 * PRICING_RESEARCH_ENABLED=1 AND PRICING_RESEARCH_API_KEY is set AND an
 * adapter is registered; none is today, so the job reports
 * "not_configured" honestly instead of pretending to browse.
 *
 * Research jobs, when they exist, receive PUBLIC scope descriptions only
 * (service, media, hours, athlete count, location kind); never a name,
 * e-mail, phone or note. They never contact competitors. Unknown stays
 * unknown: nothing is ever inferred into a price.
 */
export type ResearchStatus = { status: "disabled" | "not_configured" | "configured"; reason: string; provider: string | null };

export const RESEARCH_ENABLED_ENV = "PRICING_RESEARCH_ENABLED";
export const RESEARCH_KEY_ENV = "PRICING_RESEARCH_API_KEY";

/** A search-backed evidence source. No implementation ships; the registry is empty on purpose. */
export type ResearchProvider = { name: string; search(query: { scope: string; region: "qatar" | "gcc" }): Promise<Array<{ url: string; title: string; snippet: string }>> };

const PROVIDERS: Record<string, (apiKey: string) => ResearchProvider> = {};

export function researchStatus(env: NodeJS.ProcessEnv = process.env): ResearchStatus {
  if (env[RESEARCH_ENABLED_ENV] !== "1") return { status: "disabled", reason: `${RESEARCH_ENABLED_ENV} is not 1; evidence is observed by the owner only.`, provider: null };
  const key = env[RESEARCH_KEY_ENV];
  if (!key) return { status: "not_configured", reason: `${RESEARCH_KEY_ENV} is not set.`, provider: null };
  const name = env.PRICING_RESEARCH_PROVIDER ?? "";
  const factory = PROVIDERS[name];
  if (!factory) return { status: "not_configured", reason: name ? `No research adapter named "${name}" is registered.` : "No research adapter is registered in this build.", provider: null };
  return { status: "configured", reason: "Provider adapter registered.", provider: name };
}

export function getResearchProvider(env: NodeJS.ProcessEnv = process.env): ResearchProvider | null {
  const s = researchStatus(env);
  if (s.status !== "configured" || !s.provider) return null;
  return PROVIDERS[s.provider](env[RESEARCH_KEY_ENV]!);
}

export type StaleSummary = { scanned: number; needsReverification: number; byReason: Record<string, number> };

/** Counts active references that must be re-verified; writes nothing. */
export async function summariseStaleReferences(supabase: SupabaseClient<Database>, now: Date): Promise<StaleSummary> {
  const { data } = await supabase.from("photo_price_references").select("id,confidence,source_type,observed_on,checked_on,promotion_expires_on").is("superseded_by", null).eq("excluded", false).limit(1000);
  const byReason: Record<string, number> = {};
  let needs = 0;
  for (const ref of data ?? []) {
    const reason = referenceNeedsReverification(ref, now);
    if (!reason) continue;
    needs += 1;
    byReason[reason] = (byReason[reason] ?? 0) + 1;
  }
  return { scanned: (data ?? []).length, needsReverification: needs, byReason };
}
