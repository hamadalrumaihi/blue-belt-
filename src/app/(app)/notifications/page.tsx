import type { Metadata } from "next";
import Link from "next/link";
import { BrandHeader } from "@/components/BrandHeader";
import { PageBody } from "@/components/AppShell";
import { EmptyState } from "@/components/EmptyState";
import { BellIcon } from "@/components/icons";
import { isEmailEnabled } from "@/lib/notifications/email/config";
import { emailStats, listClientPrefs, listRecentDeliveries } from "@/lib/notifications/queries";
import { cn } from "@/lib/utils";
import { ClientNotificationPrefs } from "./ClientNotificationPrefs";
import { RecentDeliveries } from "./RecentDeliveries";

export const metadata: Metadata = { title: "Notifications" };
export const dynamic = "force-dynamic";

/**
 * What leaves the studio and to whom: the client e-mail channel (on/off on
 * this server, last week's outcomes), the owner's per-kind switches, and the
 * last deliveries across Telegram and e-mail with a retry for failures.
 */
export default async function NotificationsPage() {
  const now = new Date();
  const emailOn = isEmailEnabled();
  const [stats, prefs, rows] = await Promise.all([emailStats(now), listClientPrefs(), listRecentDeliveries(50)]);

  return (
    <>
      <BrandHeader title="Notifications" subtitle={emailOn ? "Client e-mails are on" : "Client e-mails are off on this server"} />
      <PageBody className="max-w-3xl space-y-5">
        <section className="card space-y-3 p-5" aria-labelledby="email-heading">
          <div className="flex items-center justify-between gap-2">
            <h2 id="email-heading" className="text-sm font-extrabold uppercase tracking-wider text-muted">Client e-mails</h2>
            <span className={cn("rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider", emailOn ? "bg-lightblue text-primary" : "bg-page text-muted")}>{emailOn ? "On" : "Off on the server"}</span>
          </div>
          {emailOn ? (
            <p className="text-sm text-ink">Booking, payment, agreement and gallery e-mails go out to clients from the studio address. Each one is sent once and shows up below.</p>
          ) : (
            <p className="text-sm text-ink">
              Nothing is e-mailed to clients until the server has <code>EMAIL_ENABLED=1</code>, <code>RESEND_API_KEY</code> and <code>EMAIL_FROM</code> set. Messages are still queued so nothing is lost; they go out once e-mail is switched on.
            </p>
          )}
          <dl className="grid grid-cols-3 gap-2 text-center">
            <Stat label="Queued" value={stats.queued} />
            <Stat label="Sent" value={stats.sent} tone="text-success" />
            <Stat label="Failed" value={stats.failed} tone={stats.failed ? "text-danger" : undefined} />
          </dl>
          <p className="hint">Last 7 days. Owner Telegram messages (new bookings, payments, galleries, failures) are always on while a chat is linked in <Link href="/settings" className="font-semibold text-primary">Settings</Link>.</p>
        </section>

        <section className="card p-5" aria-labelledby="prefs-heading">
          <h2 id="prefs-heading" className="text-sm font-extrabold uppercase tracking-wider text-muted">What clients receive</h2>
          <p className="mt-1 text-sm text-muted">Switch a kind off and that e-mail is skipped for every client. Nothing here charges anyone or sends a payment link by itself.</p>
          <div className="mt-2">
            <ClientNotificationPrefs prefs={prefs} />
          </div>
        </section>

        <section className="card p-5" aria-labelledby="recent-heading">
          <h2 id="recent-heading" className="text-sm font-extrabold uppercase tracking-wider text-muted">Recent deliveries · {rows.length}</h2>
          {rows.length === 0 ? (
            <EmptyState compact className="mt-3" icon={<BellIcon />} title="Nothing sent yet" description="Telegram messages and client e-mails appear here with their outcome." />
          ) : (
            <div className="mt-2">
              <RecentDeliveries rows={rows} now={now.toISOString()} />
            </div>
          )}
        </section>
      </PageBody>
    </>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-xl bg-page px-2 py-3">
      <dt className="text-[11px] font-bold uppercase tracking-wide text-muted">{label}</dt>
      <dd className={cn("text-2xl font-black tabular-nums text-ink", tone)}>{value}</dd>
    </div>
  );
}
