import type { Metadata } from "next";
import { BrandHeader } from "@/components/BrandHeader";
import { PageBody } from "@/components/AppShell";
import { EmptyState } from "@/components/EmptyState";
import { UsersIcon } from "@/components/icons";
import { loadCollaboratorBoard, loadCollaboratorEvents } from "@/lib/collaborator";
import { CoverageBoard } from "./CoverageBoard";

export const metadata: Metadata = { title: "My coverage" };
export const dynamic = "force-dynamic";

/**
 * Collaborator view: the events the signed-in user is on and the clients
 * assigned to them, with operational fields only (no contact or payment data).
 * Everything here comes from SECURITY DEFINER RPCs scoped to the viewer.
 */
export default async function CoveragePage({ searchParams }: PageProps<"/coverage">) {
  const params = await searchParams;
  const events = await loadCollaboratorEvents();
  if (!events.length) {
    return (
      <>
        <BrandHeader title="My coverage" />
        <PageBody className="max-w-2xl">
          <EmptyState icon={<UsersIcon />} title="No shared events yet" description="When a photographer invites you to an event and assigns you clients, they appear here." />
        </PageBody>
      </>
    );
  }
  const selectedId = typeof params.event === "string" && events.some((e) => e.event_id === params.event) ? params.event : events[0].event_id;
  const selected = events.find((e) => e.event_id === selectedId)!;
  const board = await loadCollaboratorBoard(selectedId);
  return (
    <>
      <BrandHeader title="My coverage" subtitle={selected.name} />
      <PageBody className="max-w-3xl">
        <CoverageBoard events={events} selectedId={selectedId} rows={board} timezone={selected.timezone} />
      </PageBody>
    </>
  );
}
