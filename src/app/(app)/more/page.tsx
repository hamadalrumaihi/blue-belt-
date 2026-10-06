import type { Metadata } from "next";
import Link from "next/link";
import { BrandHeader } from "@/components/BrandHeader";
import { PageBody } from "@/components/AppShell";
import { Logo } from "@/components/Logo";
import { ChevronRightIcon, LogoutIcon, ShieldIcon } from "@/components/icons";
import { groupNavItems, MORE_ITEMS, NAV_GROUP_LABEL, navItemsFor } from "@/components/nav";
import { signOut } from "@/lib/actions/auth";
import { resolveViewerMode } from "@/lib/collaborator";
import { resolveViewer } from "@/lib/roles";

export const metadata: Metadata = { title: "More" };

export default async function MorePage() {
  const viewer = await resolveViewer();
  const mode = await resolveViewerMode();
  // Owner surfaces are hidden for a collaborator-only account; Settings stays
  // so they can manage their own Telegram link. Same list as the sidebar.
  const collaboratorOnly = viewer?.role === "staff" || mode.collaboratorOnly;
  const groups = groupNavItems(navItemsFor(MORE_ITEMS, collaboratorOnly));
  return (
    <>
      <BrandHeader title="More" />
      <PageBody className="max-w-xl space-y-4">
        <div className="card flex items-center gap-3 p-4">
          <Logo variant="mark" size={44} href={null} />
          <div className="min-w-0">
            <p className="font-extrabold text-ink">Blue Belt Media</p>
            <p className="truncate text-xs text-muted">{viewer?.email}</p>
          </div>
        </div>
        {groups.map(({ group, items }) => (
          <section key={group} aria-labelledby={`more-${group}`}>
            <h2 id={`more-${group}`} className="eyebrow mb-2 px-1">{NAV_GROUP_LABEL[group]}</h2>
            <ul className="card divide-y divide-line">
              {items.map(({ href, label, icon: Icon }) => (
                <li key={href}>
                  <Link href={href} className="flex min-h-14 items-center gap-3 px-4 text-sm font-semibold text-ink hover:bg-page">
                    <Icon size={20} className="text-primary" /> <span className="flex-1">{label}</span> <ChevronRightIcon size={18} className="text-muted" />
                  </Link>
                </li>
              ))}
              {group === "account" && !collaboratorOnly && (
                <li>
                  <Link href="/settings/danger" className="flex min-h-14 items-center gap-3 px-4 text-sm font-semibold text-ink hover:bg-page">
                    <ShieldIcon size={20} className="text-primary" /> <span className="flex-1">Danger zone / delete management</span> <ChevronRightIcon size={18} className="text-muted" />
                  </Link>
                </li>
              )}
              {group === "account" && (
                <li>
                  <form action={signOut}>
                    <button type="submit" className="flex min-h-14 w-full items-center gap-3 px-4 text-left text-sm font-semibold text-danger hover:bg-page">
                      <LogoutIcon size={20} /> Sign out
                    </button>
                  </form>
                </li>
              )}
            </ul>
          </section>
        ))}
        <p className="pt-2 text-center text-[11px] text-muted">Galleries, photos and photo sales live in Pic-Time. Blue Belt Media Studio holds bookings, contracts, payments and the tournament watcher.</p>
      </PageBody>
    </>
  );
}
