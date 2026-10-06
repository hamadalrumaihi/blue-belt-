"use client";

import { DeleteDialog } from "@/components/DeleteDialog";
import { deleteAllMatchData, deleteEvent, deleteEverything, deleteMatchDataForEvent } from "@/lib/actions/danger";

type Counts = { events: number; athletes: number; matches: number; history: number };
type EventSummary = { id: string; name: string; clients: number; matches: number };

export function DangerZone({ counts, events }: { counts: Counts; events: EventSummary[] }) {
  return (
    <div className="space-y-4">
      <div className="card p-4">
        <p className="eyebrow">What you currently hold</p>
        <dl className="mt-2 grid grid-cols-4 gap-2 text-center">
          <div><dt className="text-[10px] font-bold uppercase text-muted">Events</dt><dd className="text-xl font-black">{counts.events}</dd></div>
          <div><dt className="text-[10px] font-bold uppercase text-muted">Clients</dt><dd className="text-xl font-black">{counts.athletes}</dd></div>
          <div><dt className="text-[10px] font-bold uppercase text-muted">Matches</dt><dd className="text-xl font-black">{counts.matches}</dd></div>
          <div><dt className="text-[10px] font-bold uppercase text-muted">Changes</dt><dd className="text-xl font-black">{counts.history}</dd></div>
        </dl>
        <p className="mt-3 text-xs text-muted">The Tournament Watcher holds temporary operational data. Bookings, clients, contracts, galleries and payments are not touched here; photos and photo sales stay in Pic-Time.</p>
      </div>

      <section className="card p-4">
        <h2 className="text-sm font-extrabold uppercase tracking-wider text-ink">Delete match data</h2>
        <p className="mt-1 text-xs text-muted">Removes tracked matches and change history. Events and clients stay.</p>
        <div className="mt-3 space-y-2">
          {events.map((e) => (
            <div key={e.id} className="flex items-center justify-between gap-3 rounded-xl border border-line p-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-ink">{e.name}</p>
                <p className="text-xs text-muted">{e.clients} clients · {e.matches} matches</p>
              </div>
              <DeleteDialog
                trigger="Matches"
                triggerClassName="min-h-9 px-3 text-xs"
                title="Delete match data"
                summary={<p>Deletes <strong>{e.matches}</strong> tracked match{e.matches === 1 ? "" : "es"} and their change history for <strong>{e.name}</strong>.</p>}
                confirmLabel="Delete match data"
                onConfirm={() => deleteMatchDataForEvent(e.id)}
              />
            </div>
          ))}
          <DeleteDialog
            trigger="Delete all match data"
            triggerClassName="w-full"
            title="Delete all match data"
            summary={<p>Deletes <strong>{counts.matches}</strong> tracked matches and <strong>{counts.history}</strong> change records across every event. Events and clients stay.</p>}
            confirmLabel="Delete all match data"
            onConfirm={deleteAllMatchData}
          />
        </div>
      </section>

      <section className="card p-4">
        <h2 className="text-sm font-extrabold uppercase tracking-wider text-ink">Delete tournament</h2>
        <p className="mt-1 text-xs text-muted">Removes the event with all its clients, matches and history. Requires typing DELETE.</p>
        <div className="mt-3 space-y-2">
          {events.length === 0 && <p className="text-sm text-muted">No events.</p>}
          {events.map((e) => (
            <div key={e.id} className="flex items-center justify-between gap-3 rounded-xl border border-line p-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-ink">{e.name}</p>
                <p className="text-xs text-muted">{e.clients} clients · {e.matches} matches</p>
              </div>
              <DeleteDialog
                trigger="Tournament"
                triggerClassName="min-h-9 px-3 text-xs"
                title="Delete tournament"
                requireTyping
                summary={<ul className="list-disc space-y-0.5 pl-4"><li>Event: <strong>{e.name}</strong></li><li><strong>{e.clients}</strong> client{e.clients === 1 ? "" : "s"}</li><li><strong>{e.matches}</strong> tracked match{e.matches === 1 ? "" : "es"} and all change history</li></ul>}
                confirmLabel="Delete tournament"
                onConfirm={() => deleteEvent(e.id, "DELETE")}
              />
            </div>
          ))}
        </div>
      </section>

      <section className="card border-danger/40 p-4">
        <h2 className="text-sm font-extrabold uppercase tracking-wider text-danger">Delete everything</h2>
        <p className="mt-1 text-xs text-muted">Wipes every Tournament Watcher row you own (events, athletes, matches, history). Bookings, clients and Pic-Time are unaffected.</p>
        <div className="mt-3">
          <DeleteDialog
            trigger="Delete everything"
            triggerClassName="w-full bg-danger text-white hover:bg-red-700 border-transparent"
            title="Delete everything"
            requireTyping
            summary={<ul className="list-disc space-y-0.5 pl-4"><li><strong>{counts.events}</strong> event{counts.events === 1 ? "" : "s"}</li><li><strong>{counts.athletes}</strong> client{counts.athletes === 1 ? "" : "s"}</li><li><strong>{counts.matches}</strong> tracked match{counts.matches === 1 ? "" : "es"}</li><li><strong>{counts.history}</strong> change record{counts.history === 1 ? "" : "s"}</li></ul>}
            confirmLabel="Delete everything"
            onConfirm={() => deleteEverything("DELETE")}
          />
        </div>
      </section>
    </div>
  );
}
