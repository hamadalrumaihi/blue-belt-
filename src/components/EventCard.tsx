import Link from "next/link";
import type { EventRow } from "@/lib/types";
import { formatEventDate, todayInZone } from "@/lib/time";
import { cn } from "@/lib/utils";
import { LiveIndicator } from "./LiveIndicator";
import { PlatformBadge } from "./PlatformBadge";
import { ChevronRightIcon, MapPinIcon } from "./icons";

export function eventStatus(event: EventRow): "live" | "upcoming" | "past" | "archived" {
  if (!event.active) return "archived";
  const today = todayInZone(event.timezone);
  if (!event.event_date) return "upcoming";
  if (event.event_date === today) return "live";
  return event.event_date > today ? "upcoming" : "past";
}

type Props = {
  event: EventRow;
  clients?: number;
  matches?: number;
  nextClient?: string | null;
  className?: string;
};

export function EventCard({ event, clients = 0, matches = 0, nextClient, className }: Props) {
  const status = eventStatus(event);
  return (
    <Link href={`/events/${event.id}`} className={cn("card block p-4 transition-colors hover:border-primary/40", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <PlatformBadge platform={event.platform} />
            <LiveIndicator status={status} />
          </div>
          <h3 className="mt-2 line-clamp-2 text-base font-extrabold leading-snug text-ink">{event.name}</h3>
          <p className="mt-1 flex items-center gap-1 truncate text-xs text-muted">
            <MapPinIcon size={14} /> {event.venue ?? "Venue TBC"}
          </p>
          <p className="mt-0.5 text-xs font-semibold text-ink">{formatEventDate(event.event_date)}</p>
        </div>
        <ChevronRightIcon className="shrink-0 text-muted" />
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-line pt-3 text-center">
        <div>
          <dt className="text-[10px] font-bold uppercase tracking-wider text-muted">Clients</dt>
          <dd className="text-lg font-black text-ink">{clients}</dd>
        </div>
        <div>
          <dt className="text-[10px] font-bold uppercase tracking-wider text-muted">Matches</dt>
          <dd className="text-lg font-black text-ink">{matches}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[10px] font-bold uppercase tracking-wider text-muted">Next up</dt>
          <dd className="truncate text-sm font-bold text-primary" title={nextClient ?? undefined}>{nextClient ?? "—"}</dd>
        </div>
      </dl>
    </Link>
  );
}
