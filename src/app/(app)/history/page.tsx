import type { Metadata } from "next";
import Link from "next/link";
import { BrandHeader } from "@/components/BrandHeader";
import { PageBody } from "@/components/AppShell";
import { ChangeHistory } from "@/components/ChangeHistory";
import { CHANGE_LABEL, isChangeType } from "@/lib/changes";
import { listAthleteOptions, listEvents, listHistoryPage, pickCurrentEvent } from "@/lib/queries";
import { isUuid } from "@/lib/validation";
import { HistoryFilter } from "./HistoryFilter";

export const metadata: Metadata = { title: "Activity" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;

export default async function HistoryPage({ searchParams }: PageProps<"/history">) {
  const params = await searchParams;
  const events = await listEvents();
  const eventParam = typeof params.event === "string" ? params.event : null;
  const scope = eventParam === "all" ? null : pickCurrentEvent(events, eventParam);
  const athleteId = typeof params.athlete === "string" && isUuid(params.athlete) ? params.athlete : null;
  const changeType = typeof params.type === "string" && isChangeType(params.type) ? params.type : null;
  const cursor = typeof params.cursor === "string" ? params.cursor : null;

  const [athletes, page] = await Promise.all([
    listAthleteOptions(scope?.id ?? null),
    listHistoryPage({ eventId: scope?.id ?? null, athleteId, changeType, limit: PAGE_SIZE, cursor }),
  ]);
  const tz = scope?.timezone ?? "Asia/Qatar";

  const nextHref = page.nextCursor
    ? `/history?${new URLSearchParams({ event: scope?.id ?? "all", ...(athleteId ? { athlete: athleteId } : {}), ...(changeType ? { type: changeType } : {}), cursor: page.nextCursor }).toString()}`
    : null;

  return (
    <>
      <BrandHeader title="Activity" subtitle="Change history detected by the watcher" />
      <PageBody>
        <HistoryFilter
          events={events}
          athletes={athletes}
          currentEventId={scope?.id ?? "all"}
          currentAthleteId={athleteId ?? ""}
          currentType={changeType ?? ""}
          types={Object.entries(CHANGE_LABEL).map(([value, label]) => ({ value, label }))}
        />
        <ChangeHistory
          entries={page.entries}
          timezone={tz}
          showDate
          emptyTitle={cursor ? "No more activity" : "No activity yet"}
          emptyDescription="Refresh clients from the Match Watcher; every mat, time, opponent and status change lands here."
        />
        {nextHref && (
          <div className="pt-3 text-center">
            <Link href={nextHref} className="btn-secondary" rel="next">Load older activity</Link>
          </div>
        )}
        {cursor && (
          <p className="pt-2 text-center text-[11px] text-muted">Showing an older page. <Link href={`/history?event=${scope?.id ?? "all"}`} className="font-semibold text-primary">Back to latest</Link></p>
        )}
      </PageBody>
    </>
  );
}
