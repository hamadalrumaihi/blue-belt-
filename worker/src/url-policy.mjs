/**
 * Target URL policy, kept identical to the app's src/lib/watchers/url-policy.ts:
 * https only, allow-listed registrable domains (and subdomains), no credentials,
 * no custom ports, no IP literals, fragment stripped.
 */
const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

export function hostAllowed(hostname, allowedHosts) {
  const host = String(hostname ?? "").toLowerCase().replace(/\.$/, "");
  if (!host || IPV4_RE.test(host) || host.startsWith("[")) return false;
  return allowedHosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

/** @returns {{ok:true,url:URL}|{ok:false,code:"INVALID_URL"|"UNSUPPORTED_HOST",message:string}} */
export function validateTargetUrl(raw, allowedHosts) {
  if (typeof raw !== "string" || !raw.trim() || raw.length > 2048) return { ok: false, code: "INVALID_URL", message: "url must be a non-empty string." };
  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, code: "INVALID_URL", message: "url must be a valid absolute URL." };
  }
  if (url.protocol !== "https:") return { ok: false, code: "INVALID_URL", message: "Only https URLs are allowed." };
  if (url.username || url.password) return { ok: false, code: "INVALID_URL", message: "Credentials in URLs are not allowed." };
  if (url.port && url.port !== "443") return { ok: false, code: "INVALID_URL", message: "Custom ports are not allowed." };
  if (!hostAllowed(url.hostname, allowedHosts)) return { ok: false, code: "UNSUPPORTED_HOST", message: `Host ${url.hostname} is not allow-listed.` };
  url.hash = "";
  return { ok: true, url };
}
