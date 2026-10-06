import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Bot, type Context } from "grammy";
import { createLogger } from "@/lib/log";
import type { Database, PhotoTelegramLinkRow } from "@/lib/supabase/database.types";
import { createServiceClient } from "@/lib/supabase/service";
import { telegramBotToken } from "./config";

/**
 * grammY bot in webhook mode. Commands only manage the chat ↔ account link;
 * notifications are sent by the notifier through `bot.api.sendMessage`.
 * The command handlers run without a user session (Telegram calls the
 * webhook), so they go through the service-role client via `LinkStore`.
 */
export type LinkStore = {
  findByCode(code: string): Promise<PhotoTelegramLinkRow | null>;
  findByChat(chatId: number): Promise<PhotoTelegramLinkRow | null>;
  link(id: string, chatId: number, chatTitle: string | null, now: Date): Promise<void>;
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
    async link(id, chatId, chatTitle, now) {
      const { error } = await supabase
        .from("photo_telegram_links")
        .update({ chat_id: chatId, chat_title: chatTitle, linked_at: now.toISOString(), link_code: null, link_code_expires_at: null, enabled: true, updated_at: now.toISOString() })
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

export function createTelegramBot(token: string, store: LinkStore, now: () => Date = () => new Date()): Bot {
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
    await store.link(row.id, chatId, chatTitleOf(ctx), now());
    log.info("telegram.linked", { linkId: row.id });
    await ctx.reply("Linked. You will get match alerts here. Send /stop to pause them.");
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
    await ctx.reply(row.enabled ? "Linked. Alerts are on." : "Linked, but alerts are paused. Turn Telegram on in Settings to resume.");
  });

  bot.catch((err) => {
    // Never log the update body: it carries chat ids and names.
    log.error("telegram.update_failed", { error: err.error instanceof Error ? err.error.message : String(err.error) });
  });

  return bot;
}

let singleton: Bot | null = null;

/** Process-wide bot built from the environment and the service-role client. */
export function getBot(): Bot {
  if (!singleton) singleton = createTelegramBot(telegramBotToken(), createLinkStore(createServiceClient()));
  return singleton;
}
