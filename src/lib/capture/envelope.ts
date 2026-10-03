import { createHash, randomUUID } from "node:crypto";
import { isPlainObject } from "@/lib/validation";

/**
 * Capture envelope: the facts recorded about one capture of a source page,
 * whatever transport delivered it (the signed-in import page, the browser
 * hand-over, the Windows agent, or the render worker). Everything here is
 * pure; persistence lives in ./store.
 *
 * Owner identity is NEVER part of what a client may supply: the owner comes
 * from the authenticated session / credential at the endpoint.
 */

export type CaptureTransport = "import" | "handoff" | "agent" | "worker" | "http";
export type CaptureCompleteness = "complete" | "partial" | "unknown";

export const CAPTURE_TRANSPORTS: readonly CaptureTransport[] = ["import", "handoff", "agent", "worker", "http"];
export const CAPTURE_COMPLETENESS: readonly CaptureCompleteness[] = ["complete", "partial", "unknown"];

/** Client-supplied metadata (all optional). */
export type CaptureMeta = {
  captureId?: string;
  capturedAt?: string;
  finalUrl?: string;
  transport?: CaptureTransport;
  completeness?: CaptureCompleteness;
};

export type CaptureEnvelope = {
  /** Client-stable id used for replay: the same id never applies twice. */
  captureId: string;
  sourceUrl: string;
  finalUrl: string;
  transport: CaptureTransport;
  /** When the page was captured (client clock, validated against receivedAt). */
  capturedAt: string;
  /** When the server received it. */
  receivedAt: string;
  completeness: CaptureCompleteness;
  contentHash: string;
  bytes: number;
};

/** A capture may be at most this old when it arrives (a forgotten tab is not fresh data). */
export const MAX_CAPTURE_AGE_MS = 12 * 60 * 60 * 1000;
/** Client clocks drift; anything further ahead than this is implausible. */
export const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

const CAPTURE_ID_RE = /^[A-Za-z0-9._:-]{8,128}$/;

export function hashContent(html: string): string {
  return createHash("sha256").update(html, "utf8").digest("hex");
}

export type TimingCheck = { ok: true } | { ok: false; code: "CAPTURE_TIME_INVALID" | "CAPTURE_IN_FUTURE" | "CAPTURE_TOO_OLD"; message: string };

export function checkCaptureTiming(input: { capturedAt: string; receivedAt: Date; maxAgeMs?: number; maxFutureSkewMs?: number }): TimingCheck {
  const captured = new Date(input.capturedAt).getTime();
  if (!Number.isFinite(captured)) return { ok: false, code: "CAPTURE_TIME_INVALID", message: "capturedAt is not a valid timestamp." };
  const received = input.receivedAt.getTime();
  const maxAge = input.maxAgeMs ?? MAX_CAPTURE_AGE_MS;
  const maxSkew = input.maxFutureSkewMs ?? MAX_FUTURE_SKEW_MS;
  if (captured - received > maxSkew) return { ok: false, code: "CAPTURE_IN_FUTURE", message: "The capture time is in the future; check the device clock." };
  if (received - captured > maxAge) return { ok: false, code: "CAPTURE_TOO_OLD", message: `The capture is older than ${Math.round(maxAge / 3_600_000)} hours; open the page again and re-capture.` };
  return { ok: true };
}

export type CaptureMetaResult = { ok: true; meta: CaptureMeta } | { ok: false; code: "INVALID_CAPTURE"; error: string };

/** Validates the optional `capture` object a client may attach to an import. Unknown keys are rejected. */
export function parseCaptureMeta(value: unknown): CaptureMetaResult {
  if (value === undefined || value === null) return { ok: true, meta: {} };
  if (!isPlainObject(value)) return { ok: false, code: "INVALID_CAPTURE", error: "capture must be an object." };
  const meta: CaptureMeta = {};
  for (const key of Object.keys(value)) {
    const v = value[key];
    switch (key) {
      case "captureId":
        if (typeof v !== "string" || !CAPTURE_ID_RE.test(v)) return { ok: false, code: "INVALID_CAPTURE", error: "capture.captureId must be 8-128 characters of letters, digits, . _ : -." };
        meta.captureId = v;
        break;
      case "capturedAt":
        if (typeof v !== "string" || v.length > 40 || !Number.isFinite(new Date(v).getTime())) return { ok: false, code: "INVALID_CAPTURE", error: "capture.capturedAt must be an ISO timestamp." };
        meta.capturedAt = v;
        break;
      case "finalUrl":
        if (typeof v !== "string" || !v.trim() || v.length > 2048) return { ok: false, code: "INVALID_CAPTURE", error: "capture.finalUrl must be a URL string." };
        meta.finalUrl = v.trim();
        break;
      case "transport":
        if (typeof v !== "string" || !(CAPTURE_TRANSPORTS as readonly string[]).includes(v)) return { ok: false, code: "INVALID_CAPTURE", error: `capture.transport must be one of ${CAPTURE_TRANSPORTS.join(", ")}.` };
        meta.transport = v as CaptureTransport;
        break;
      case "completeness":
        if (typeof v !== "string" || !(CAPTURE_COMPLETENESS as readonly string[]).includes(v)) return { ok: false, code: "INVALID_CAPTURE", error: `capture.completeness must be one of ${CAPTURE_COMPLETENESS.join(", ")}.` };
        meta.completeness = v as CaptureCompleteness;
        break;
      default:
        return { ok: false, code: "INVALID_CAPTURE", error: `Unsupported capture field: ${key}.` };
    }
  }
  return { ok: true, meta };
}

export function buildEnvelope(input: { sourceUrl: string; html: string; now: Date; meta: CaptureMeta; defaultTransport?: CaptureTransport }): CaptureEnvelope {
  const receivedAt = input.now.toISOString();
  return {
    captureId: input.meta.captureId ?? randomUUID(),
    sourceUrl: input.sourceUrl,
    finalUrl: input.meta.finalUrl ?? input.sourceUrl,
    transport: input.meta.transport ?? input.defaultTransport ?? "import",
    capturedAt: input.meta.capturedAt ?? receivedAt,
    receivedAt,
    completeness: input.meta.completeness ?? "unknown",
    contentHash: hashContent(input.html),
    bytes: Buffer.byteLength(input.html, "utf8"),
  };
}

/** Diagnostic keys that may be persisted or shown. Anything else is dropped. */
const DIAG_STRING_KEYS = new Set(["strategy", "finalUrl", "workerCode", "completeness", "readiness", "transport"]);
const DIAG_NUMBER_KEYS = new Set(["sourceStatus", "elapsedMs", "attempts", "pages", "frames", "bytes"]);
const MAX_DIAG_STRING = 200;

/**
 * Redacted diagnostic mode: keeps a fixed allow-list of scalar facts about how
 * a page was fetched. No HTML, no names, no headers, no cookies, no nested
 * objects can get through, whatever a caller passes in.
 */
export function redactDiagnostics(input: unknown): Record<string, string | number | null> {
  if (!isPlainObject(input)) return {};
  const out: Record<string, string | number | null> = {};
  for (const [key, value] of Object.entries(input)) {
    if (DIAG_NUMBER_KEYS.has(key)) {
      if (typeof value === "number" && Number.isFinite(value)) out[key] = Math.round(value);
      else if (value === null) out[key] = null;
      continue;
    }
    if (DIAG_STRING_KEYS.has(key)) {
      if (typeof value !== "string") continue;
      if (/[<>]/.test(value)) continue;
      out[key] = value.length > MAX_DIAG_STRING ? value.slice(0, MAX_DIAG_STRING) : value;
    }
  }
  return out;
}
