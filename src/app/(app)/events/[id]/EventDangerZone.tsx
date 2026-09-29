"use client";

import { DeleteDialog } from "@/components/DeleteDialog";
import { deleteEvent, deleteMatchDataForEvent } from "@/lib/actions/danger";

type Props = { eventId: string; eventName: string; clients: number; matches: number };

export function EventDangerZone({ eventId, eventName, clients, matches }: Props) {
  return (
    <section className="card border-danger/20 p-4">
      <h3 className="text-sm font-extrabold uppercase tracking-wider text-danger">Danger zone</h3>
      <p className="mt-1 text-xs text-muted">Nothing is deleted automatically. These actions cannot be undone.</p>
      <div className="mt-3 flex flex-col gap-2">
        <DeleteDialog
          trigger="Delete match data"
          title="Delete match data"
          summary={<p>Deletes <strong>{matches} tracked match{matches === 1 ? "" : "es"}</strong> and their change history for this event. Clients and the event stay.</p>}
          confirmLabel="Delete match data"
          onConfirm={() => deleteMatchDataForEvent(eventId)}
        />
        <DeleteDialog
          trigger="Delete tournament"
          title="Delete tournament"
          requireTyping
          summary={
            <ul className="list-disc space-y-0.5 pl-4">
              <li>Event: <strong>{eventName}</strong></li>
              <li><strong>{clients}</strong> client{clients === 1 ? "" : "s"}</li>
              <li><strong>{matches}</strong> tracked match{matches === 1 ? "" : "es"} and all change history</li>
            </ul>
          }
          confirmLabel="Delete tournament"
          onConfirm={() => deleteEvent(eventId, "DELETE")}
        />
      </div>
    </section>
  );
}
