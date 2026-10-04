import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { requestLogger } from "@/lib/log";
import { rateLimit, RULES } from "@/lib/rate-limit";
import { MAX_IMPORT_HTML_BYTES } from "@/lib/validation";
import { ALLOWED_HOST_LIST, platformForHost } from "@/lib/watchers/url-policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * POST /api/import/receive  (multipart or urlencoded form: url, html)
 *
 * Hand-over target for the bookmarklet / iOS Shortcut that runs on the
 * source page in the photographer's own browser. A cross-site form POST
 * carries no session cookie (SameSite=Lax), so this endpoint stores nothing
 * and decides nothing: it returns a tiny first-party page that parks the
 * payload in this tab's sessionStorage and moves on to /import, where the
 * signed-in app shows what arrived and asks for one tap to confirm.
 *
 * Only pages on the allow-listed source hosts may post here (Origin check),
 * so a third-party site cannot stage a payload for a signed-in user.
 */
export async function POST(request: Request) {
  const { log } = requestLogger(request, "api/import/receive");
  const origin = request.headers.get("origin");
  if (!isAllowedOrigin(origin, request.url)) {
    log.warn("import.receive_rejected", { reason: "origin", origin: origin ?? null });
    return new NextResponse("This hand-over only accepts pages from " + ALLOWED_HOST_LIST.join(" or ") + ".", { status: 403, headers: { "content-type": "text/plain; charset=utf-8" } });
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const limit = rateLimit(`import-receive:${ip}`, RULES.importReceivePerIp);
  if (!limit.ok) return new NextResponse("Too many hand-overs. Try again in a minute.", { status: 429, headers: { "retry-after": String(limit.retryAfterSeconds) } });

  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_IMPORT_HTML_BYTES * 1.5) return new NextResponse("Page too large.", { status: 413 });

  let url = "";
  let html = "";
  let captureId = "";
  let capturedAt = "";
  try {
    const form = await request.formData();
    url = String(form.get("url") ?? "");
    html = String(form.get("html") ?? "");
    captureId = String(form.get("captureId") ?? "").slice(0, 128);
    capturedAt = String(form.get("capturedAt") ?? "").slice(0, 40);
  } catch {
    return new NextResponse("Expected a form submission.", { status: 400 });
  }
  if (!url || !html) return new NextResponse("Missing url or html.", { status: 400 });
  if (html.length > MAX_IMPORT_HTML_BYTES) return new NextResponse("Page too large (3 MB limit).", { status: 413 });

  log.info("import.received", { host: hostOf(url), htmlBytes: html.length, hasCaptureId: Boolean(captureId) });
  const nonce = randomUUID();
  // Capture metadata is carried through untouched; /api/import validates it
  // (and the signed-in session decides the owner), not this public endpoint.
  const payload = JSON.stringify({ url, html, receivedAt: new Date().toISOString(), captureId: captureId || null, capturedAt: capturedAt || null }).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Handing over…</title>
<style>body{font-family:system-ui,sans-serif;background:#0b1f3a;color:#fff;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:24px;text-align:center}a{color:#9fd0ff}</style></head>
<body><div><p id="m">Handing the page over to Tournament Watcher…</p><p id="f" hidden>Could not park the page in this browser (storage full or blocked). Copy the page HTML and paste it on the <a href="/import">Import page</a> instead.</p></div>
<script type="application/json" id="p">${payload}</script>
<script nonce="${nonce}">(function(){try{var t=document.getElementById("p").textContent;JSON.parse(t);sessionStorage.setItem("bbm:pending-import",t);location.replace("/import");}catch(e){document.getElementById("m").hidden=true;document.getElementById("f").hidden=false;}})();</script>
</body></html>`;
  return new NextResponse(page, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "content-security-policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'`,
    },
  });
}

function isAllowedOrigin(origin: string | null, requestUrl: string): boolean {
  if (!origin) return false;
  try {
    const o = new URL(origin);
    if (o.origin === new URL(requestUrl).origin) return true;
    return o.protocol === "https:" && platformForHost(o.hostname) !== null;
  } catch {
    return false;
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "-";
  }
}
