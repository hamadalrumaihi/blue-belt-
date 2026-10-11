import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Bot, type Context } from "grammy";
import type { InlineKeyboardMarkup } from "grammy/types";
import { createLogger } from "@/lib/log";
import { getPaymentsConfig, isPaymentsEnabled } from "@/lib/payments/config";
import { createMyFatoorahClient } from "@/lib/payments/myfatoorah/client";
import { siteUrl } from "@/lib/studio/queries";
import type { Database, PhotoTelegramLinkRow } from "@/lib/supabase/database.types";
import { createServiceClient } from "@/lib/supabase/service";
import { buildInlineKeyboard, callbackSecret } from "./callbacks";
import { telegramBotToken } from "./config";
import { ACK_TEXT, authorizeOrderCallback, performOrderAction, type CallbackDeps } from "./order-callbacks";

/**
 * grammY bot in webhook mode. Commands manage the chat ↔ account link;
 * inline buttons under [Orders] cards run the order actions; notifications
 * are sent by the delivery runner through `bot.api`. Handlers run without a
 * user session (Telegram calls the webhook), so they use the service-role
 * client via `LinkStore` and check ownership themselves.
 */
export type LinkStore = {
  findByCode(code: string): Promise<PhotoTelegramLinkRow | null>;
  findByChat(chatId: number): Promise<PhotoTelegramLinkRow | null>;
  link(id: string, chat: { chatId: number; chatTitle: string | null; userId: number | null; chatType: string | null }, now: Date): Promise<void>;
  setEnabled(id: string, enabled: boolean): Promise<void>;
};

export const LINK_CODE_RE = /^[A-Z0-9]{8}$/;

export function createLinkStore(supabase: SupabaseClient<Database>): LinkStore {
  return {
    async findByCode(code) {
      const { data, error } = await supabase.from("photo_telegram_links").select("*").eq("link_code", code).maybeSingle();
      if (error) throw new Error(error.message);
      return data ?? null;
    },
    async findByChat(chatId) {
      const { data, error } = await supabase.from("photo_telegram_links").select("*").eq("chat_id", chatId).order("updated_at", { ascending: false }).limit(1).maybeSingle();
      if (error) throw new Error(error.message);
      return data ?? null;
    },
    async link(id, chat, now) {
      const { error } = await supabase
        .from("photo_telegram_links")
        .update({ chat_id: chat.chatId, chat_title: chat.chatTitle, user_id: chat.userId, chat_type: chat.chatType, linked_at: now.toISOString(), link_code: null, link_code_expires_at: null, enabled: true, updated_at: now.toISOString() })
        .eq("id", id);
      if (error) throw new Error(error.message);
    },
    async setEnabled(id, enabled) {
      const { error } = await supabase.from("photo_telegram_links").update({ enabled, updated_at: new Date().toISOString() }).eq("id", id);
      if (error) throw new Error(error.message);
    },
  };
}

function chatTitleOf(ctx: Context): string | null {
  const chat = ctx.chat;
  if (!chat) return null;
  if (chat.type === "private") {
    const name = [chat.first_name, chat.last_name].filter(Boolean).join(" ").trim();
    return (name || (chat.username ? `@${chat.username}` : null))?.slice(0, 120) ?? null;
  }
  return chat.title?.slice(0, 120) ?? null;
}

export type BotDeps = {
  now?: () => Date;
  /** Order-button handling; omit to leave buttons unanswered (tests of the link commands). */
  callbacks?: () => CallbackDeps;
};

export function createTelegramBot(token: string, store: LinkStore, deps: BotDeps = {}): Bot {
  const now = deps.now ?? (() => new Date());
  const bot = new Bot(token);
  const log = createLogger({ route: "telegram/bot" });

  bot.command("start", async (ctx) => {
    const chatId = ctx.chat?.id;
    if (chatId === undefined) return;
    const code = (ctx.match ?? "").trim().toUpperCase();
    if (!code) {
      await ctx.reply("Open Settings in Blue Belt Media Studio, tap “Generate link code”, then send: /start CODE");
      return;
    }
    if (!LINK_CODE_RE.test(code)) {
      await ctx.reply("That code does not look right. Codes are 8 letters or digits.");
      return;
    }
    const row = await store.findByCode(code);
    if (!row) {
      await ctx.reply("Unknown or already used code. Generate a new one in Settings.");
      return;
    }
    const expires = row.link_code_expires_at ? new Date(row.link_code_expires_at).getTime() : 0;
    if (!expires || expires < now().getTime()) {
      await ctx.reply("That code has expired. Generate a new one in Settings.");
      return;
    }
    await store.link(row.id, { chatId, chatTitle: chatTitleOf(ctx), userId: ctx.from?.id ?? null, chatType: ctx.chat?.type ?? null }, now());
    log.info("telegram.linked", { linkId: row.id, chatType: ctx.chat?.type });
    await ctx.reply(ctx.chat?.type === "private" ? "Linked. You will get match alerts and order cards here; the buttons under order cards work for you. Send /stop to pause alerts." : "Linked. This group gets match alerts and order cards. Only you (the person who sent the code) can use the buttons under order cards. Send /stop to pause alerts.");
  });

  const stop = async (ctx: Context) => {
    const chatId = ctx.chat?.id;
    if (chatId === undefined) return;
    const row = await store.findByChat(chatId);
    if (!row) {
      await ctx.reply("This chat is not linked.");
      return;
    }
    await store.setEnabled(row.id, false);
    log.info("telegram.unsubscribed", { linkId: row.id });
    await ctx.reply("Alerts paused. Generate a new code in Settings or turn Telegram back on there to resume.");
  };
  bot.command("stop", stop);
  bot.command("unsubscribe", stop);

  bot.command("status", async (ctx) => {
    const chatId = ctx.chat?.id;
    if (chatId === undefined) return;
    const row = await store.findByChat(chatId);
    if (!row) {
      await ctx.reply("Not linked. Generate a code in Settings and send /start CODE.");
      return;
    }
    const actions = row.user_id !== null ? (ctx.from?.id === Number(row.user_id) ? "Order buttons: enabled for you." : "Order buttons: enabled for the person who linked this chat.") : ctx.chat?.type === "private" ? "Order buttons: enabled." : "Order buttons: send /start CODE again (from Settings) to enable them in this group.";
    await ctx.reply(`${row.enabled ? "Linked. Alerts are on." : "Linked, but alerts are paused. Turn Telegram on in Settings to resume."}\n${actions}`);
  });

  if (deps.callbacks) {
    const getDeps = deps.callbacks;
    bot.on("callback_query:data", async (ctx) => {
      const chat = ctx.chat;
      const from = ctx.from;
      if (!chat || !from) {
        await ctx.answerCallbackQuery({ text: "This button cannot be used here." }).catch(() => undefined);
        return;
      }
      const cb = getDeps();
      const auth = await authorizeOrderCallback({ data: ctx.callbackQuery.data, chatId: chat.id, chatType: chat.type, fromId: from.id, now: now() }, cb);
      if (!auth.ok) {
        await ctx.answerCallbackQuery({ text: auth.answer, show_alert: auth.reason === "not_authorized" }).catch(() => undefined);
        if (auth.reason === "expired" || auth.reason === "invalid") await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } }).catch(() => undefined);
        return;
      }
      // Acknowledge at once so the button stops spinning, then do the work and update the card.
      await ctx.answerCallbackQuery({ text: ACK_TEXT[auth.action] }).catch(() => undefined);
      const done = await performOrderAction(auth, cb);
      const markup: InlineKeyboardMarkup = { inline_keyboard: buildInlineKeyboard(done.card.buttons, { orderId: auth.order.id, secret: cb.secret, now: now() }) as InlineKeyboardMarkup["inline_keyboard"] };
      try {
        await ctx.editMessageText(done.card.text, { parse_mode: "HTML", reply_markup: markup, link_preview_options: { is_disabled: true } });
      } catch (err) {
        // "message is not modified" or too old: say it in a reply instead of failing the update.
        log.info("telegram.callback_edit_failed", { error: err instanceof Error ? err.message.slice(0, 120) : String(err) });
        await ctx.reply(done.answer).catch(() => undefined);
      }
    });
  }

  bot.catch((err) => {
    // Never log the update body: it carries chat ids and names.
    log.error("telegram.update_failed", { error: err.error instanceof Error ? err.error.message : String(err.error) });
  });

  return bot;
}

let singleton: Bot | null = null;

/** Process-wide bot built from the environment and the service-role client. */
export function getBot(): Bot {
  if (!singleton) {
    const token = telegramBotToken();
    singleton = createTelegramBot(token, createLinkStore(createServiceClient()), {
      callbacks: () => {
        const enabled = isPaymentsEnabled();
        const config = getPaymentsConfig();
        return {
          supabase: createServiceClient(),
          secret: callbackSecret(token),
          siteUrl: siteUrl(),
          provider: enabled ? createMyFatoorahClient({ apiKey: config.apiKey, baseUrl: config.baseUrl }) : null,
          log: createLogger({ route: "telegram/callbacks" }),
          now: () => new Date(),
        };
      },
    });
  }
  return singleton;
}
