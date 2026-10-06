import "server-only";

/**
 * Client e-mail is off unless EMAIL_ENABLED=1 AND a Resend key AND a sender
 * address are set. While off, client notifications are still queued (so
 * nothing is lost) and the Notifications page says they are waiting.
 * All variables are server-only; none is ever NEXT_PUBLIC_.
 */
export function isEmailEnabled(): boolean {
  return process.env.EMAIL_ENABLED === "1" && Boolean(process.env.RESEND_API_KEY) && Boolean(process.env.EMAIL_FROM);
}

export function emailFrom(): string {
  return process.env.EMAIL_FROM ?? "Blue Belt Media <no-reply@example.com>";
}

export function emailReplyTo(): string | null {
  return process.env.EMAIL_REPLY_TO ?? null;
}

/** Dry run in tests or when EMAIL_DRY_RUN=1: nothing leaves the server. */
export function isEmailDryRun(): boolean {
  return process.env.NODE_ENV === "test" || Boolean(process.env.VITEST) || process.env.EMAIL_DRY_RUN === "1";
}
