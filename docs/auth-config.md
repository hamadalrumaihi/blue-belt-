# Supabase Auth configuration for the client portal sign-in

The client portal signs people in with an e-mailed link. The code in this
repository builds the request (`src/lib/actions/client-auth.ts`) and turns the
link into a session (`src/app/auth/callback/route.ts`). The two things the
code cannot set are the project's URL configuration and the e-mail templates.
They live in the Supabase dashboard and must match what is below.

Project: `nuujdewnkovtdvlbfzdx` (production).

## 1. Authentication, URL Configuration

Site URL:

```
https://www.bluebeltmedia.com
```

Redirect URLs (allow list). Add exactly these; remove every
`tournament-watcher.vercel.app` and `bluebeltmedia.vercel.app` entry, since
those hosts are no longer attached to the project and open a Vercel 404.

```
https://www.bluebeltmedia.com/auth/callback
https://www.bluebeltmedia.com/auth/callback?next=/client
https://www.bluebeltmedia.com/auth/callback?next=/reset-password
http://localhost:3000/auth/callback
http://localhost:3000/auth/callback?next=/client
http://localhost:3000/auth/callback?next=/reset-password
```

Preview deployments: if you want sign-in links to work on Vercel previews,
add the single pattern `https://bluebeltmedia-*-hamadalrumaihis-projects.vercel.app/auth/callback**`.
Do not add a bare `https://*.vercel.app/**` pattern.

Why this matters: when the `redirect_to` the app asks for is not on the
allow list, Supabase silently replaces it with the Site URL. That is exactly
what the logs showed on 8 October: the app asked for
`https://www.bluebeltmedia.com/auth/callback?next=/client`, the e-mail link
redirected to `https://tournament-watcher.vercel.app/`, and the customer saw
`DEPLOYMENT_NOT_FOUND`.

## 2. Authentication, Email templates

Use the token-hash form so the link works from any browser or device (Gmail's
in-app browser, a phone that did not request the link, a different profile).
The default `{{ .ConfirmationURL }}` form uses PKCE, which only succeeds in
the browser that holds the code verifier cookie.

**Magic Link** (sent when an existing client asks for a sign-in link):

```html
<h2>Your sign-in link</h2>
<p>Tap the button to open your bookings. The link works once and expires after an hour.</p>
<p><a href="{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=magiclink&next=/client">Open my bookings</a></p>
<p>If you did not ask for this, you can ignore this e-mail.</p>
```

**Confirm signup** (sent the first time an address signs in, because the
portal creates the account on first use):

```html
<h2>Confirm your e-mail</h2>
<p>Tap the button to confirm your e-mail address and open your bookings.</p>
<p><a href="{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=signup&next=/client">Open my bookings</a></p>
<p>If you did not ask for this, you can ignore this e-mail.</p>
```

**Reset password** (studio staff):

```html
<h2>Reset your password</h2>
<p><a href="{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password">Choose a new password</a></p>
```

**Invite user** (studio staff):

```html
<h2>You have been invited</h2>
<p><a href="{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=invite&next=/reset-password">Accept the invitation</a></p>
```

Do not put a hostname in a template. `{{ .SiteURL }}` is the Site URL from
section 1, so changing the domain later is one setting.

## 3. Rate limits and sender

The built-in Supabase sender allows only a few e-mails per hour per project.
A second request within a few minutes returns `429 over_email_send_rate_limit`
and no e-mail is sent, which looks to the customer like a broken link. For
production use set up a custom SMTP sender (Authentication, SMTP settings)
and raise the e-mail rate limit (Authentication, Rate Limits).

## 4. What the code guarantees

- The link's return address is always the configured site
  (`NEXT_PUBLIC_SITE_URL`, then `APP_URL`, then `https://www.bluebeltmedia.com`),
  never the request's Host header.
- `/auth/callback` accepts `token_hash` + `type` (any browser) and the PKCE
  `code` (same browser), only follows same-site `next` paths, and sends a
  failed client link to `/client/login?error=link` with a message and the
  form to request a new one. Staff links fail to `/login?error=link`.
- The portal shows a booking only when the signed-in user's verified e-mail
  matches the person on the booking. A booking reference alone grants nothing.
- The sign-in form answers the same way for known and unknown addresses and
  is rate limited per IP.
