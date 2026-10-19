/**
 * Client-facing notification kinds (e-mail). Shared by the server (enqueue,
 * templates), the Notifications settings page and tests, so no server-only
 * imports here. The owner can switch any kind off for every client.
 */
export const CLIENT_NOTIFICATION_KINDS = [
  "BOOKING_RECEIVED",
  "BOOKING_CONFIRMED",
  "PAYMENT_REQUESTED",
  "PAYMENT_RECEIVED",
  "CONTRACT_READY",
  "CONTRACT_SIGNED",
  "SESSION_REMINDER",
  "GALLERY_READY",
  "DELIVERY_COMPLETE",
  "BOOKING_CHANGED",
  "BOOKING_CANCELLED",
  "ORDER_PAYMENT_LINK",
  "ORDER_PAYMENT_RECEIVED",
  "PORTAL_SIGN_IN",
  "INQUIRY_RECEIVED",
] as const;

export type ClientNotificationKind = (typeof CLIENT_NOTIFICATION_KINDS)[number];

export const CLIENT_NOTIFICATION_LABEL: Record<ClientNotificationKind, string> = {
  BOOKING_RECEIVED: "Booking received",
  BOOKING_CONFIRMED: "Booking confirmed",
  PAYMENT_REQUESTED: "Payment requested",
  PAYMENT_RECEIVED: "Payment received",
  CONTRACT_READY: "Agreement ready to sign",
  CONTRACT_SIGNED: "Agreement signed (copy)",
  SESSION_REMINDER: "Reminder before a session",
  GALLERY_READY: "Gallery ready",
  DELIVERY_COMPLETE: "Delivery complete",
  BOOKING_CHANGED: "Booking changed",
  BOOKING_CANCELLED: "Booking cancelled",
  ORDER_PAYMENT_LINK: "Photo order payment link",
  ORDER_PAYMENT_RECEIVED: "Photo order payment received",
  PORTAL_SIGN_IN: "Portal sign-in link (always on)",
  INQUIRY_RECEIVED: "Inquiry received",
};

export const CLIENT_NOTIFICATION_HELP: Record<ClientNotificationKind, string> = {
  BOOKING_RECEIVED: "Sent right after a client submits a booking request on the website or you add one by hand.",
  BOOKING_CONFIRMED: "Sent when a booking becomes Confirmed (agreement signed and the deposit or advance payment received).",
  PAYMENT_REQUESTED: "Sent only when you press Send payment link for a deposit or balance request. Creating a link never sends anything and never charges anyone.",
  PAYMENT_RECEIVED: "Sent when a MyFatoorah payment is verified or you record a manual payment for a stage.",
  CONTRACT_READY: "Sent with the signing link when you send an agreement.",
  CONTRACT_SIGNED: "A copy of the signed agreement link for the client's records.",
  SESSION_REMINDER: "The day before a session or event.",
  GALLERY_READY: "Sent with the gallery link only when you tick Notify the client on Mark ready or Deliver gallery.",
  DELIVERY_COMPLETE: "Sent when you mark a booking delivered from its status buttons.",
  BOOKING_CHANGED: "Sent when you change the date, time or place of a confirmed booking.",
  BOOKING_CANCELLED: "Sent when a booking is cancelled.",
  ORDER_PAYMENT_LINK: "The private payment link for a gallery photo order paid to you directly: sent automatically in Automatic mode, or when you press Send invoice. Switching it off puts every new order in the exception queue.",
  ORDER_PAYMENT_RECEIVED: "Sent once when an online payment for a photo order is verified.",
  PORTAL_SIGN_IN: "Magic links are sent by Supabase Auth, not by this switch.",
  INQUIRY_RECEIVED: "The acknowledgment sent right after someone submits the Contact & Inquiries form, with their inquiry reference.",
};

/** Kinds the owner cannot switch off (the client needs them to use the portal). */
export const ALWAYS_ON_KINDS: readonly ClientNotificationKind[] = ["PORTAL_SIGN_IN"];

export function isClientNotificationKind(v: unknown): v is ClientNotificationKind {
  return typeof v === "string" && (CLIENT_NOTIFICATION_KINDS as readonly string[]).includes(v);
}
