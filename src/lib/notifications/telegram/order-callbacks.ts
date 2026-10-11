import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Logger } from "@/lib/log";
import { exceptionCard, invoiceCard, paidCard, type OrderCard } from "@/lib/orders/cards";
import { checkOrderPaymentNow, fulfillOrder, resendOrderInvoiceEmail, sendOrderInvoiceNow, type OrderActor, type OrderServiceDeps } from "@/lib/orders/payment-link";
import type { PaymentProvider } from "@/lib/payments/myfatoorah/client";
import { rateLimit, RULES } from "@/lib/rate-limit";
import type { Database, PhotoOrderRow, PhotoTelegramLinkRow } from "@/lib/supabase/database.types";
import { verifyCallback, type CallbackAction } from "./callbacks";

type Client = SupabaseClient<Database>;

/**
 * Inline-button presses under [Orders] cards. Every press is checked
 * server-side before anything happens:
 *   1. the callback data verifies (HMAC, not expired, known action);
 *   2. the chat is a linked chat, and the PRESSER is its authorised user:
 *      in a private chat the chat id is the user; in a group only the user
 *      who linked the chat (photo_telegram_links.user_id) may act, group
 *      membership alone is nothing;
 *   3. the order belongs to the link's owner;
 *   4. the action is still meaningful for the order's current state.
 * Then the SAME services the dashboard uses run; the button carries no
 * amount, no e-mail address and no owner.
 */
export type CallbackInput = { data: unknown; chatId: number; chatType: string; fromId: number; now: Date };

export type CallbackDeps = {
  supabase: Client;
  secret: string;
  siteUrl: string;
  provider: PaymentProvider | null;
  log: Logger;
  now: () => Date;
};

export type Authorized = { ok: true; action: CallbackAction; order: PhotoOrderRow; link: PhotoTelegramLinkRow; actor: OrderActor };
export type Refused = { ok: false; answer: string; reason: "invalid" | "expired" | "not_linked" | "not_authorized" | "not_found" | "rate_limited" };

/** Immediate acknowledgement per action (shown as the toast while the work runs). */
export const ACK_TEXT: Record<CallbackAction, string> = {
  send: "Invoice queued. Creating the payment link and e-mail…",
  resend: "E-mail queued…",
  check: "Checking the payment…",
  done: "Marking the order done…",
  refresh: "Refreshing…",
};

export async function authorizeOrderCallback(input: CallbackInput, deps: CallbackDeps): Promise<Authorized | Refused> {
  const verdict = verifyCallback(input.data, deps.secret, input.now);
  if (!verdict.ok) {
    deps.log.warn("telegram.callback_rejected", { reason: verdict.reason });
    return { ok: false, reason: verdict.reason === "expired" ? "expired" : "invalid", answer: verdict.reason === "expired" ? "This button has expired. Open the order in the dashboard." : "This button is not valid." };
  }
  const limit = rateLimit(`tg-action:${input.fromId}`, RULES.providerActionPerUser);
  if (!limit.ok) return { ok: false, reason: "rate_limited", answer: `Too many actions. Wait ${Math.ceil(limit.retryAfterSeconds / 60)} min.` };

  const { data: link } = await deps.supabase.from("photo_telegram_links").select("*").eq("chat_id", input.chatId).order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (!link || link.chat_id === null) return { ok: false, reason: "not_linked", answer: "This chat is not linked to a Blue Belt Media account." };
  if (!isAuthorizedUser(link, input)) {
    deps.log.warn("telegram.callback_unauthorized", { linkId: link.id, chatType: input.chatType });
    return { ok: false, reason: "not_authorized", answer: input.chatType === "private" ? "Only the linked account may use these buttons." : "Only the person who linked this chat may use these buttons. Re-link with /start CODE to enable them for you." };
  }
  const { data: order } = await deps.supabase.from("photo_orders").select("*").eq("id", verdict.payload.orderId).maybeSingle();
  if (!order || order.owner_id !== link.owner_id) return { ok: false, reason: "not_found", answer: "This order is not yours or no longer exists." };
  return { ok: true, action: verdict.payload.action, order, link, actor: { kind: "telegram", userId: link.owner_id, telegramUserId: input.fromId } };
}

/** Who may press financial buttons: the stored user id; before it is stored, only a private chat's own user. */
export function isAuthorizedUser(link: Pick<PhotoTelegramLinkRow, "user_id" | "chat_id" | "enabled">, input: Pick<CallbackInput, "fromId" | "chatId" | "chatType">): boolean {
  if (link.user_id !== null && link.user_id !== undefined) return Number(link.user_id) === input.fromId;
  return input.chatType === "private" && Number(link.chat_id) === input.fromId && input.chatId === input.fromId;
}

export type Performed = { answer: string; card: OrderCard };

/** Runs the action through the shared services and returns the card the message should now show. */
export async function performOrderAction(auth: Authorized, deps: CallbackDeps): Promise<Performed> {
  const services: OrderServiceDeps = { supabase: deps.supabase, provider: deps.provider, now: deps.now, log: deps.log, siteUrl: deps.siteUrl };
  const { action, order, actor } = auth;
  let result: { ok: boolean; order?: PhotoOrderRow; message?: string; error?: string };
  switch (action) {
    case "send":
      result = await sendOrderInvoiceNow(services, order.id, actor);
      break;
    case "resend":
      result = await resendOrderInvoiceEmail(services, order.id, actor);
      break;
    case "check":
      result = await checkOrderPaymentNow(services, order.id, actor);
      break;
    case "done":
      result = await fulfillOrder(services, order.id, actor);
      break;
    default:
      result = { ok: true, order, message: "Up to date." };
  }
  const fresh = result.order ?? (await reload(deps.supabase, order.id)) ?? order;
  const note = result.ok ? result.message ?? "Done." : result.error ?? "Something went wrong.";
  deps.log.info("telegram.order_action", { action, orderId: order.id, ok: result.ok });
  return { answer: note.slice(0, 190), card: cardFor(fresh, deps.siteUrl, note) };
}

async function reload(supabase: Client, id: string): Promise<PhotoOrderRow | null> {
  const { data } = await supabase.from("photo_orders").select("*").eq("id", id).maybeSingle();
  return data ?? null;
}

/** The card that matches the order's state right now. */
export function cardFor(order: PhotoOrderRow, siteUrl: string, note?: string | null): OrderCard {
  if (order.payment_state === "paid") return paidCard(order, siteUrl, { amountText: `${Number(order.amount_qr).toFixed(2)} ${order.currency}`, source: order.payment_confirmed_by ? "owner" : "online" });
  if (order.invoice_exception) return exceptionCard(order, siteUrl, note ?? "Needs attention.");
  return invoiceCard(order, siteUrl, note);
}
