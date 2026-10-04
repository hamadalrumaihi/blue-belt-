import type { ChangeType } from "@/lib/types";

export type AlertLevel = "info" | "warning" | "danger";

export type AlertKind =
  | "THRESHOLD_30"
  | "THRESHOLD_15"
  | "THRESHOLD_5"
  | "GO_TO_MAT"
  | "ON_MAT"
  | "MAT_CHANGE"
  | "MOVED_EARLIER"
  | "MOVED_LATER"
  | "REMIND_15"
  | "REMIND_5";

/**
 * A single actionable alert. In V1 these render as in-app banners; the same
 * objects can later be handed to push / n8n channels without reshaping.
 */
export interface AppAlert {
  /** Stable id so a dismissed alert stays dismissed across re-renders. */
  id: string;
  kind: AlertKind;
  level: AlertLevel;
  title: string;
  body: string;
  athleteId: string;
  athleteName: string;
  mat: string | null;
  createdAt: string;
  changeType?: ChangeType;
}

/** Contract for any delivery channel (in-app today, push / n8n / WhatsApp later). */
export interface NotificationChannel {
  id: string;
  label: string;
  /** Whether this channel is ready to deliver. Coming-soon channels return false. */
  isAvailable(): boolean;
  send(alert: AppAlert): Promise<void>;
}
