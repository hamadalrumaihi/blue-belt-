import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed, compact callback data for the inline buttons under [Orders]
 * messages. Telegram caps callback_data at 64 bytes, so the order id travels
 * as 22 base64url characters and the whole string is
 *
 *   o|<action>|<order id, 22 chars>|<expiry, base36 seconds>|<HMAC, 16 chars>
 *
 * The HMAC is keyed from the bot token (never stored anywhere else), so a
 * forged or edited button fails verification, and an expired one is refused.
 * The data names WHAT to do to WHICH order; the amount, the e-mail address
 * and who is allowed to press the button are always resolved server-side.
 */
export const CALLBACK_ACTIONS = ["send", "check", "resend", "done", "refresh"] as const;
export type CallbackAction = (typeof CALLBACK_ACTIONS)[number];

export const CALLBACK_TTL_MS = 30 * 24 * 60 * 60_000;
export const CALLBACK_MAX_BYTES = 64;

export type CallbackPayload = { action: CallbackAction; orderId: string; exp: number };

export type CallbackVerdict = { ok: true; payload: CallbackPayload } | { ok: false; reason: "malformed" | "expired" | "bad_signature" | "unknown_action" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Key for signing callbacks: a hash of the bot token, so the token itself is never used as a key. */
export function callbackSecret(botToken: string): string {
  return createHash("sha256").update(`telegram-callbacks:${botToken}`, "utf8").digest("hex");
}

function compactId(uuid: string): string {
  return Buffer.from(uuid.replace(/-/g, ""), "hex").toString("base64url");
}

function expandId(compact: string): string | null {
  if (!/^[A-Za-z0-9_-]{22}$/.test(compact)) return null;
  const hex = Buffer.from(compact, "base64url").toString("hex");
  if (hex.length !== 32) return null;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function mac(parts: string[], secret: string): string {
  return createHmac("sha256", secret).update(parts.join("|"), "utf8").digest("base64url").slice(0, 16);
}

export function isCallbackAction(v: unknown): v is CallbackAction {
  return typeof v === "string" && (CALLBACK_ACTIONS as readonly string[]).includes(v);
}

export function signCallback(input: { action: CallbackAction; orderId: string; now: Date; ttlMs?: number }, secret: string): string {
  if (!UUID_RE.test(input.orderId)) throw new Error("callback: order id must be a uuid");
  const exp = Math.floor((input.now.getTime() + (input.ttlMs ?? CALLBACK_TTL_MS)) / 1000).toString(36);
  const body = ["o", input.action, compactId(input.orderId), exp];
  const data = [...body, mac(body, secret)].join("|");
  if (Buffer.byteLength(data, "utf8") > CALLBACK_MAX_BYTES) throw new Error("callback: data exceeds 64 bytes");
  return data;
}

export function verifyCallback(data: unknown, secret: string, now: Date): CallbackVerdict {
  if (typeof data !== "string" || Buffer.byteLength(data, "utf8") > CALLBACK_MAX_BYTES) return { ok: false, reason: "malformed" };
  const parts = data.split("|");
  if (parts.length !== 5 || parts[0] !== "o") return { ok: false, reason: "malformed" };
  const [, action, id, expRaw, sig] = parts;
  if (!isCallbackAction(action)) return { ok: false, reason: "unknown_action" };
  const orderId = expandId(id);
  const exp = parseInt(expRaw, 36);
  if (!orderId || !Number.isFinite(exp)) return { ok: false, reason: "malformed" };
  const expected = Buffer.from(mac(["o", action, id, expRaw], secret), "utf8");
  const received = Buffer.from(sig, "utf8");
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return { ok: false, reason: "bad_signature" };
  if (exp * 1000 < now.getTime()) return { ok: false, reason: "expired" };
  return { ok: true, payload: { action, orderId, exp } };
}

/** One button as producers describe it: a signed action, or a plain link. */
export type CardButton = { text: string; action?: CallbackAction; url?: string };

/** Telegram's inline keyboard shape (reply_markup.inline_keyboard). */
export type InlineKeyboardRow = Array<{ text: string; callback_data?: string; url?: string }>;

/** Turns button rows into Telegram markup, signing every action for its order. */
export function buildInlineKeyboard(rows: CardButton[][], ctx: { orderId: string; secret: string; now: Date }): InlineKeyboardRow[] {
  return rows
    .map((row) =>
      row.map((b) => (b.url ? { text: b.text, url: b.url } : { text: b.text, callback_data: signCallback({ action: b.action!, orderId: ctx.orderId, now: ctx.now }, ctx.secret) })),
    )
    .filter((row) => row.length > 0);
}
