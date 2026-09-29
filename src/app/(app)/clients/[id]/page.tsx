import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BrandHeader } from "@/components/BrandHeader";
import { PageBody } from "@/components/AppShell";
import { EditIcon } from "@/components/icons";
import { getAthlete, listHistory } from "@/lib/queries";
import { ClientDetail } from "./ClientDetail";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/clients/[id]">): Promise<Metadata> {
  const { id } = await params;
  const athlete = await getAthlete(id);
  return { title: athlete?.name ?? "Client" };
}

export default async function ClientDetailPage({ params }: PageProps<"/clients/[id]">) {
  const { id } = await params;
  const athlete = await getAthlete(id);
  if (!athlete) notFound();
  const history = await listHistory({ athleteId: id, limit: 100 });

  return (
    <>
      <BrandHeader title={athlete.name} backHref="/clients" actions={<Link href={`/clients/${id}/edit`} className="btn-secondary min-h-10"><EditIcon size={16} /> Edit</Link>} />
      <PageBody>
        <ClientDetail athlete={athlete} history={history} />
      </PageBody>
    </>
  );
}
