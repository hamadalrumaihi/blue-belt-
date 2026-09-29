import "server-only";
import { DEFAULT_TIMEZONE } from "@/lib/time";
import { ajpAdapter } from "./ajp";
import { safeFetchHtml } from "./safe-fetch";
import { smoothcompAdapter } from "./smoothcomp";
import type { WatchResult, WatcherAdapter } from "./types";
import { validateSourceUrl } from "./url-policy";

const ADAPTERS: WatcherAdapter[] = [ajpAdapter, smoothcompAdapter];

export type WatchOptions = {
  athleteName?: string | null;
  timezone?: string | null;
  eventDate?: string | null;
  now?: Date;
};

/**
 * Validates, fetches and parses a source URL. Never throws: every failure
 * mode is expressed as a WatchResult status so one bad athlete cannot take
 * down a batch refresh.
 */
export async function watchUrl(rawUrl: string | null | undefined, options: WatchOptions = {}): Promise<WatchResult> {
  const now = options.now ?? new Date();
  const fetchedAt = now.toISOString();
  const policy = validateSourceUrl(rawUrl);
  if (!policy.ok) {
    return { platform: "OTHER", status: policy.code, athlete: options.athleteName ?? null, matches: [], sourceUrl: rawUrl ?? "", fetchedAt, message: policy.message };
  }

  const adapter = ADAPTERS.find((a) => a.canHandle(policy.url));
  if (!adapter) {
    return { platform: policy.platform, status: "UNSUPPORTED_HOST", athlete: options.athleteName ?? null, matches: [], sourceUrl: policy.url.toString(), fetchedAt, message: "No adapter for this host." };
  }

  const fetched = await safeFetchHtml(policy.url);
  if (!fetched.ok) {
    return { platform: adapter.platform, status: "FETCH_ERROR", athlete: options.athleteName ?? null, matches: [], sourceUrl: policy.url.toString(), fetchedAt, message: fetched.message };
  }

  return adapter.parse(fetched.html, {
    url: new URL(fetched.finalUrl),
    athleteName: options.athleteName ?? null,
    timezone: options.timezone || DEFAULT_TIMEZONE,
    eventDate: options.eventDate ?? null,
    now,
  });
}

export { validateSourceUrl } from "./url-policy";
export type { NormalizedMatch, WatchResult, WatchStatus } from "./types";
