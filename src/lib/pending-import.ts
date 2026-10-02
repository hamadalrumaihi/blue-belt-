/**
 * The hand-over page (/api/import/receive) parks the posted source page in
 * this tab's sessionStorage and navigates to /import. This tiny store lets
 * the import page read it with useSyncExternalStore (no setState-in-effect)
 * and clear it once the import is done.
 */
export const PENDING_IMPORT_KEY = "bbm:pending-import";

export type PendingImport = { url: string; html: string; receivedAt: string };

const listeners = new Set<() => void>();

export function readPendingImport(): string | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage.getItem(PENDING_IMPORT_KEY);
  } catch {
    return null;
  }
}

export function clearPendingImport(): void {
  try {
    window.sessionStorage.removeItem(PENDING_IMPORT_KEY);
  } catch {
    // Storage blocked: nothing to clear.
  }
  for (const l of listeners) l();
}

export function subscribePendingImport(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === PENDING_IMPORT_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function parsePendingImport(raw: string | null): PendingImport | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== "object") return null;
    const o = v as Record<string, unknown>;
    if (typeof o.url !== "string" || typeof o.html !== "string") return null;
    return { url: o.url, html: o.html, receivedAt: typeof o.receivedAt === "string" ? o.receivedAt : "" };
  } catch {
    return null;
  }
}

/**
 * The bookmarklet that runs on the source page: posts the page's URL and
 * rendered HTML to the hand-over endpoint as a normal form submission.
 * No popups, no CORS, works in Safari and Chrome on phones. The same code
 * is what an iOS Shortcut "Run JavaScript on Web Page" action runs.
 */
export function buildBookmarklet(appOrigin: string): string {
  const action = `${appOrigin}/api/import/receive`;
  const body =
    `var f=document.createElement("form");f.method="POST";f.enctype="multipart/form-data";f.action=${JSON.stringify(action)};f.style.display="none";` +
    `function i(n,v){var e=document.createElement("input");e.type="hidden";e.name=n;e.value=v;f.appendChild(e);}` +
    `i("url",location.href);i("html",document.documentElement.outerHTML);document.body.appendChild(f);f.submit();`;
  return `javascript:(function(){${body}})();`;
}

/** Body of the bookmarklet as an iOS Shortcuts "Run JavaScript on Web Page" script (needs completion()). */
export function buildShortcutScript(appOrigin: string): string {
  const inner = buildBookmarklet(appOrigin).replace(/^javascript:\(function\(\)\{/, "").replace(/\}\)\(\);$/, "");
  return `${inner}\ncompletion("sent");`;
}

/** Best-effort URL of a pasted page from its canonical / og:url tag. */
export function urlFromHtml(html: string): string | null {
  const head = html.slice(0, 200_000);
  const canonical = /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i.exec(head) ?? /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i.exec(head);
  if (canonical?.[1]) return canonical[1];
  const og = /<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["']/i.exec(head) ?? /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:url["']/i.exec(head);
  return og?.[1] ?? null;
}
