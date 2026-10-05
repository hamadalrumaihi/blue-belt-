"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { inviteCollaborator, removeCollaborator } from "@/lib/actions/coverage";
import type { EventTeamMember } from "@/lib/collaborator";

type Props = { eventId: string; members: EventTeamMember[] };

/** Owner control to invite and remove photo/video collaborators on an event. */
export function EventTeam({ eventId, members }: Props) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"photographer" | "assistant">("photographer");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function invite() {
    setError(null);
    setNote(null);
    startTransition(async () => {
      const res = await inviteCollaborator(eventId, email, role);
      if (!res.ok) setError(res.error);
      else {
        setNote(`Invited ${email}.`);
        setEmail("");
        router.refresh();
      }
    });
  }

  function remove(userId: string) {
    setError(null);
    startTransition(async () => {
      const res = await removeCollaborator(eventId, userId);
      if (!res.ok) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <section className="card p-4" aria-label="Collaborators">
      <h3 className="text-sm font-extrabold uppercase tracking-wider text-muted">Collaborators</h3>
      <p className="mt-1 text-xs text-muted">They see only the clients you assign to them, with mat and time, and can mark their own Photos/Video done. No contact or payment details.</p>

      {members.length > 0 && (
        <ul className="mt-3 divide-y divide-line">
          {members.map((m) => (
            <li key={m.userId} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink">{m.email ?? m.userId.slice(0, 8)}</p>
                <p className="text-xs text-muted">{m.role}</p>
              </div>
              <button type="button" className="btn-ghost min-h-9 px-3 text-xs text-danger" disabled={pending} onClick={() => remove(m.userId)}>Remove</button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 space-y-2">
        <input className="input" type="email" inputMode="email" aria-label="Collaborator email" placeholder="collaborator@email.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        <div className="flex gap-2">
          <select className="input flex-1" aria-label="Collaborator role" value={role} onChange={(e) => setRole(e.target.value as "photographer" | "assistant")}>
            <option value="photographer">Photographer</option>
            <option value="assistant">Assistant</option>
          </select>
          <button type="button" className="btn-primary" disabled={pending || !email} onClick={invite}>Invite</button>
        </div>
      </div>
      {note && <p className="mt-2 text-xs font-semibold text-success">{note}</p>}
      {error && <p className="mt-2 text-xs font-semibold text-danger" role="alert">{error}</p>}
      <p className="mt-2 text-[11px] text-muted">The person must have a Tournament Watcher account already. Assign them to clients from each client&rsquo;s page.</p>
    </section>
  );
}
