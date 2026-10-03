import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BrandHeader } from "@/components/BrandHeader";
import { PageBody } from "@/components/AppShell";
import { EditIcon } from "@/components/icons";
import { getAthlete, listHistory } from "@/lib/queries";
import { loadEventCoverage, loadEventTeam } from "@/lib/collaborator";
import { ClientDetail } from "./ClientDetail";
import { CoverageSection } from "./CoverageSection";

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
  const eventId = athlete.event?.id ?? null;
  const [coverageMap, team] = await Promise.all([
    eventId ? loadEventCoverage(eventId) : Promise.resolve(new Map()),
    eventId ? loadEventTeam(eventId) : Promise.resolve([]),
  ]);
  const coverage = coverageMap.get(id) ?? null;

  return (
    <>
      <BrandHeader title={athlete.name} backHref="/clients" actions={<Link href={`/clients/${id}/edit`} className="btn-secondary min-h-10"><EditIcon size={16} /> Edit</Link>} />
      <PageBody>
        <div className="mb-4">
          <CoverageSection
            athleteId={id}
            eventId={eventId}
            photosDoneAt={coverage?.photos_done_at ?? null}
            videosDoneAt={coverage?.videos_done_at ?? null}
            photographerId={coverage?.photographer_id ?? null}
            videographerId={coverage?.videographer_id ?? null}
            team={team}
          />
        </div>
        <ClientDetail athlete={athlete} history={history} />
      </PageBody>
    </>
  );
}
