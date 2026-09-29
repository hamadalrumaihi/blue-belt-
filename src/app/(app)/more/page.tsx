import type { Metadata } from "next";
import Link from "next/link";
import { BrandHeader } from "@/components/BrandHeader";
import { PageBody } from "@/components/AppShell";
import { Logo } from "@/components/Logo";
import { ChevronRightIcon, HistoryIcon, LogoutIcon, SettingsIcon, ShieldIcon } from "@/components/icons";
import { signOut } from "@/lib/actions/auth";
import { getUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "More" };

export default async function MorePage() {
  const user = await getUser();
  const items = [
    { href: "/history", label: "Activity / change history", icon: HistoryIcon },
    { href: "/settings", label: "Settings", icon: SettingsIcon },
    { href: "/settings/danger", label: "Danger zone / delete management", icon: ShieldIcon },
  ];
  return (
    <>
      <BrandHeader title="More" />
      <PageBody className="max-w-xl">
        <div className="card mb-4 flex items-center gap-3 p-4">
          <Logo variant="mark" size={44} href={null} />
          <div className="min-w-0">
            <p className="font-extrabold text-ink">Blue Belt Media</p>
            <p className="truncate text-xs text-muted">{user?.email}</p>
          </div>
        </div>
        <ul className="card divide-y divide-line">
          {items.map(({ href, label, icon: Icon }) => (
            <li key={href}>
              <Link href={href} className="flex min-h-14 items-center gap-3 px-4 text-sm font-semibold text-ink hover:bg-page">
                <Icon size={20} className="text-primary" /> <span className="flex-1">{label}</span> <ChevronRightIcon size={18} className="text-muted" />
              </Link>
            </li>
          ))}
          <li>
            <form action={signOut}>
              <button type="submit" className="flex min-h-14 w-full items-center gap-3 px-4 text-left text-sm font-semibold text-danger hover:bg-page">
                <LogoutIcon size={20} /> Sign out
              </button>
            </form>
          </li>
        </ul>
        <p className="mt-6 text-center text-[11px] text-muted">Tournament Watcher holds temporary operational data only. Galleries, customers and sales live in Pic-Time.</p>
      </PageBody>
    </>
  );
}
