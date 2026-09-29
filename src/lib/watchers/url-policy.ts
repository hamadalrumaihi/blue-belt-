import type { Platform } from "@/lib/types";

/** Only these registrable domains (and their subdomains) may ever be fetched. */
const ALLOWED_HOSTS: Record<string, Platform> = {
  "ajptour.com": "AJP",
  "smoothcomp.com": "SMOOTHCOMP",
};

export type UrlPolicyResult =
  | { ok: true; url: URL; platform: Platform }
  | { ok: false; code: "INVALID_URL" | "UNSUPPORTED_HOST"; message: string };

/**
 * Validates a user-supplied source URL before any network call.
 * Guards against SSRF: https only, allowlisted hosts, no credentials,
 * no custom ports, no IP literals.
 */
export function validateSourceUrl(raw: string | null | undefined): UrlPolicyResult {
  if (!raw || typeof raw !== "string") {
    return { ok: false, code: "INVALID_URL", message: "No source URL set." };
  }
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, code: "INVALID_URL", message: "Source URL is not a valid URL." };
  }

  if (url.protocol === "http:") url.protocol = "https:";
  if (url.protocol !== "https:") {
    return { ok: false, code: "INVALID_URL", message: "Only https URLs are allowed." };
  }
  if (url.username || url.password) {
    return { ok: false, code: "INVALID_URL", message: "Credentials in URLs are not allowed." };
  }
  if (url.port && url.port !== "443") {
    return { ok: false, code: "INVALID_URL", message: "Custom ports are not allowed." };
  }

  const platform = platformForHost(url.hostname);
  if (!platform) {
    return {
      ok: false,
      code: "UNSUPPORTED_HOST",
      message: "Only ajptour.com and smoothcomp.com links can be watched.",
    };
  }
  url.hash = "";
  return { ok: true, url, platform };
}

export function platformForHost(hostname: string): Platform | null {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  for (const [allowed, platform] of Object.entries(ALLOWED_HOSTS)) {
    if (host === allowed || host.endsWith(`.${allowed}`)) return platform;
  }
  return null;
}

/** Best-effort platform guess for the client form (does not validate). */
export function guessPlatform(raw: string | null | undefined): Platform | null {
  if (!raw) return null;
  try {
    return platformForHost(new URL(raw.trim()).hostname);
  } catch {
    return null;
  }
}

export const ALLOWED_HOST_LIST = Object.keys(ALLOWED_HOSTS);
