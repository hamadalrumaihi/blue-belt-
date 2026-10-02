/**
 * Structured server logging: one JSON object per line, with a request
 * correlation id and automatic redaction. Vercel's runtime log search works on
 * the `msg` field and on any top-level key, so queries like `[watch]` keep
 * working through the `tag` field.
 *
 * Never log HTML, tokens, cookies, phone numbers or e-mail addresses. The
 * redactor masks obvious secrets by key name and by value shape, but callers
 * remain responsible for not passing page bodies in.
 */

export type LogFields = Record<string, unknown>;
export type LogLevel = "debug" | "info" | "warn" | "error";

const SECRET_KEY_RE = /token|secret|password|passwd|authorization|cookie|api[_-]?key|signature|session|phone|email|html|body/i;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_RE = /(?<!\d)\+?\d[\d\s().-]{7,}\d(?!\d)/g;
const BEARER_RE = /bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const MAX_STRING = 400;

export function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[depth]";
  if (typeof value === "string") return redactString(value);
  if (typeof value === "number" || typeof value === "boolean" || value === null || value === undefined) return value;
  if (value instanceof Error) return { name: value.name, message: redactString(value.message) };
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redactValue(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEY_RE.test(k) ? maskSecretField(v) : redactValue(v, depth + 1);
    }
    return out;
  }
  return String(value);
}

function maskSecretField(v: unknown): unknown {
  if (v === null || v === undefined || v === "") return v;
  if (typeof v === "boolean" || typeof v === "number") return v;
  return "[redacted]";
}

export function redactString(s: string): string {
  const trimmed = s.length > MAX_STRING ? `${s.slice(0, MAX_STRING)}…[${s.length - MAX_STRING} more]` : s;
  return trimmed.replace(BEARER_RE, "Bearer [redacted]").replace(EMAIL_RE, "[email]").replace(PHONE_RE, (m) => (/\d{8,}/.test(m.replace(/\D/g, "")) ? "[phone]" : m));
}

export interface Logger {
  readonly fields: LogFields;
  child(fields: LogFields): Logger;
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
}

type Sink = (level: LogLevel, line: string) => void;

const defaultSink: Sink = (level, line) => {
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
};

let sink: Sink = defaultSink;

/** Test hook: capture log lines instead of printing them. */
export function setLogSink(next: Sink | null): void {
  sink = next ?? defaultSink;
}

export function createLogger(fields: LogFields = {}): Logger {
  const emit = (level: LogLevel, msg: string, extra?: LogFields) => {
    if (level === "debug" && process.env.LOG_LEVEL !== "debug") return;
    const record = { ts: new Date().toISOString(), level, msg, ...(redactValue({ ...fields, ...(extra ?? {}) }) as LogFields) };
    sink(level, JSON.stringify(record));
  };
  return {
    fields,
    child: (more) => createLogger({ ...fields, ...more }),
    debug: (msg, extra) => emit("debug", msg, extra),
    info: (msg, extra) => emit("info", msg, extra),
    warn: (msg, extra) => emit("warn", msg, extra),
    error: (msg, extra) => emit("error", msg, extra),
  };
}

const REQUEST_ID_RE = /^[A-Za-z0-9._:-]{4,128}$/;

/** Correlation id for a request: caller-supplied, Vercel's id, or a fresh one. */
export function requestIdFrom(headers: Headers): string {
  const supplied = headers.get("x-request-id");
  if (supplied && REQUEST_ID_RE.test(supplied)) return supplied;
  const vercel = headers.get("x-vercel-id");
  if (vercel && REQUEST_ID_RE.test(vercel)) return vercel;
  return crypto.randomUUID();
}

/** Logger for one Route Handler invocation. */
export function requestLogger(request: Request, route: string): { log: Logger; requestId: string } {
  const requestId = requestIdFrom(request.headers);
  return { log: createLogger({ requestId, route }), requestId };
}
