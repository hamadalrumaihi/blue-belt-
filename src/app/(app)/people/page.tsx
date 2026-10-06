import type { Metadata } from "next";
import Link from "next/link";
import { BrandHeader } from "@/components/BrandHeader";
import { PageBody } from "@/components/AppShell";
import { EmptyState } from "@/components/EmptyState";
import { PlusIcon, SearchIcon, UsersIcon } from "@/components/icons";
import { PERSON_KIND_LABEL } from "@/lib/people/form";
import { listPeople } from "@/lib/people/queries";
import { initials } from "@/lib/utils";

export const metadata: Metadata = { title: "Clients" };
export const dynamic = "force-dynamic";

export default async function PeoplePage({ searchParams }: PageProps<"/people">) {
  const params = await searchParams;
  const q = typeof params.q === "string" && params.q.trim() ? params.q.trim().slice(0, 60) : null;
  const people = await listPeople({ q });

  return (
    <>
      <BrandHeader title="Clients" subtitle="Everyone who books, pays or signs — parents, athletes, coaches" actions={<Link href="/people/new" className="btn-primary min-h-10"><PlusIcon size={16} /> New</Link>} />
      <PageBody className="max-w-3xl">
        <form method="get" action="/people" className="mb-3 flex gap-2" role="search">
          <label htmlFor="q" className="sr-only">Search clients</label>
          <input id="q" name="q" className="input" type="search" inputMode="search" placeholder="Name, phone, e-mail or Instagram" defaultValue={q ?? ""} autoComplete="off" />
          <button type="submit" className="btn-secondary min-h-11 shrink-0" aria-label="Search"><SearchIcon size={18} /></button>
        </form>
        {people.length === 0 ? (
          q ? (
            <EmptyState compact title={`Nothing matches “${q}”`} action={<Link href="/people" className="btn-secondary">Show all clients</Link>} />
          ) : (
            <EmptyState icon={<UsersIcon />} title="No clients yet" description="Clients are created automatically from bookings and website requests, or add one by hand." action={<Link href="/people/new" className="btn-primary">Add client</Link>} />
          )
        ) : (
          <ul className="card divide-y divide-line">
            {people.map((p) => (
              <li key={p.id}>
                <Link href={`/people/${p.id}`} className="flex min-h-16 items-center gap-3 px-4 py-3 hover:bg-page">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-lightblue text-sm font-extrabold text-primary">{initials(p.full_name)}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-extrabold text-ink">{p.full_name}{p.kind !== "person" && <span className="ml-2 rounded-full bg-page px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted">{PERSON_KIND_LABEL[p.kind]}</span>}</p>
                    <p className="truncate text-xs text-muted">{[p.phone, p.email, p.instagram ? `@${p.instagram}` : null].filter(Boolean).join(" · ") || "No contact details"}</p>
                  </div>
                  <p className="shrink-0 text-right text-xs text-muted">{p.bookingCount} booking{p.bookingCount === 1 ? "" : "s"}</p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </PageBody>
    </>
  );
}
