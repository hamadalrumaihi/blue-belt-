import "server-only";
import { siteUrl } from "@/lib/studio/queries";

/**
 * The address a client sign-in e-mail returns to. Always the configured
 * public site (NEXT_PUBLIC_SITE_URL, then APP_URL, then the custom domain),
 * never the request's Host header: a preview or retired deployment host
 * would produce a link that opens a dead page, and Supabase only honours
 * redirects on its allow list anyway.
 *
 * Lives outside the "use server" action module because every export of
 * such a module must be an async server action.
 */
export function magicLinkRedirect(): string {
  return `${siteUrl()}/auth/callback?next=/client`;
}
