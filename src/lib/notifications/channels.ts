import type { AppAlert, NotificationChannel } from "./types";

/**
 * In-app channel: alerts are rendered by <AlertBanners/>; nothing to send.
 * Future channels (n8n webhook, push, WhatsApp) implement the same interface
 * and are listed here. They are labelled "Coming Soon" in Settings.
 */
export const inAppChannel: NotificationChannel = {
  id: "in-app",
  label: "In-app banners",
  isAvailable: () => true,
  async send() {
    /* rendered reactively by the UI */
  },
};

export const comingSoonChannels: Array<Pick<NotificationChannel, "id" | "label">> = [
  { id: "push", label: "Push notifications" },
  { id: "n8n", label: "n8n / webhook automations" },
  { id: "whatsapp", label: "WhatsApp" },
];

export async function dispatch(alert: AppAlert, channels: NotificationChannel[] = [inAppChannel]): Promise<void> {
  await Promise.all(channels.filter((c) => c.isAvailable()).map((c) => c.send(alert)));
}
