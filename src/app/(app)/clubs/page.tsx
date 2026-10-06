import type { Metadata } from "next";
import Link from "next/link";
import { BrandHeader } from "@/components/BrandHeader";
import { PageBody } from "@/components/AppShell";
import { EmptyState } from "@/components/EmptyState";
import { BuildingIcon, PlusIcon, SearchIcon } from "@/components/icons";
import { ORGANIZATION_KIND_LABEL } from "@/lib/organizations/form";
import { listOrganizations } from "@/lib/organizations/queries";

export const metadata: Metadata = { title: "Teams & clubs" };
export const dynamic = "force-dynamic";

export default async function ClubsPage({ searchParams }: PageProps<"/clubs">) {
  const params = await searchParams;
  const q = typeof params.q === "string" && params.q.trim() ? params.q.trim().slice(0, 60) : null;
  const orgs = await listOrganizations({ q });

  return (
    <>
      <BrandHeader title="Teams & clubs" subtitle="Academies and teams you shoot for" actions={<Link href="/clubs/new" className="btn-primary min-h-10"><PlusIcon size={16} /> New</Link>} />
      <PageBody className="max-w-3xl">
        <form method="get" action="/clubs" className="mb-3 flex gap-2" role="search">
          <label htmlFor="q" className="sr-only">Search teams and clubs</label>
          <input id="q" name="q" className="input" type="search" inputMode="search" placeholder="Name, e-mail or Instagram" defaultValue={q ?? ""} autoComplete="off" />
          <button type="submit" className="btn-secondary min-h-11 shrink-0" aria-label="Search"><SearchIcon size={18} /></button>
        </form>
        {orgs.length === 0 ? (
          q ? (
            <EmptyState compact title={`Nothing matches “${q}”`} action={<Link href="/clubs" className="btn-secondary">Show all</Link>} />
          ) : (
            <EmptyState icon={<BuildingIcon />} title="No teams or clubs yet" description="Add the academies and teams you cover so club bookings and contacts stay together." action={<Link href="/clubs/new" className="btn-primary">Add a club</Link>} />
          )
        ) : (
          <ul className="card divide-y divide-line">
            {orgs.map((o) => (
              <li key={o.id}>
                <Link href={`/clubs/${o.id}`} className="flex min-h-16 items-center gap-3 px-4 py-3 hover:bg-page">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-extrabold text-ink">{o.name} <span className="ml-1 rounded-full bg-page px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted">{ORGANIZATION_KIND_LABEL[o.kind]}</span></p>
                    <p className="truncate text-xs text-muted">{[o.contact?.full_name, o.phone, o.email, o.instagram ? `@${o.instagram}` : null].filter(Boolean).join(" · ") || "No contact details"}</p>
                  </div>
                  <p className="shrink-0 text-xs text-muted">{o.bookingCount} booking{o.bookingCount === 1 ? "" : "s"}</p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </PageBody>
    </>
  );
}
