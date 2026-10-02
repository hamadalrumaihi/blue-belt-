/**
 * Structured JSON logging for the worker. One object per line; secrets are
 * never passed in (the token is only compared, never logged) and page HTML
 * is never logged, only its size.
 */
const SECRET_KEY_RE = /token|secret|password|authorization|cookie|html|proxy_?url/i;

function sanitize(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields ?? {})) {
    if (SECRET_KEY_RE.test(k) && typeof v === "string") out[k] = "[redacted]";
    else if (typeof v === "string" && v.length > 300) out[k] = `${v.slice(0, 300)}…`;
    else out[k] = v;
  }
  return out;
}

export function createLogger(base = {}) {
  const emit = (level, msg, fields) => {
    const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...sanitize({ ...base, ...(fields ?? {}) }) });
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
  };
  return {
    child: (more) => createLogger({ ...base, ...more }),
    info: (msg, fields) => emit("info", msg, fields),
    warn: (msg, fields) => emit("warn", msg, fields),
    error: (msg, fields) => emit("error", msg, fields),
  };
}

export const log = createLogger({ service: "bbm-worker" });
