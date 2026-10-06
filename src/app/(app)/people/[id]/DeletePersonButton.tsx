"use client";

import { DeleteDialog } from "@/components/DeleteDialog";
import { deletePerson } from "@/lib/actions/people";

export function DeletePersonButton({ personId, name, bookingCount }: { personId: string; name: string; bookingCount: number }) {
  if (bookingCount > 0) return <p className="text-xs text-muted">This client has {bookingCount} booking{bookingCount === 1 ? "" : "s"}, so the record cannot be deleted.</p>;
  return (
    <DeleteDialog
      trigger="Delete client"
      title="Delete this client?"
      summary={<span><strong>{name}</strong> will be removed from your client list. Bookings are never deleted this way.</span>}
      onConfirm={async () => {
        const res = await deletePerson(personId);
        return res.ok ? null : { error: res.error };
      }}
    />
  );
}
