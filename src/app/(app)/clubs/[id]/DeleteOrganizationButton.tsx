"use client";

import { DeleteDialog } from "@/components/DeleteDialog";
import { deleteOrganization } from "@/lib/actions/organizations";

export function DeleteOrganizationButton({ organizationId, name, bookingCount }: { organizationId: string; name: string; bookingCount: number }) {
  if (bookingCount > 0) return <p className="text-xs text-muted">This club has {bookingCount} booking{bookingCount === 1 ? "" : "s"}, so it cannot be deleted.</p>;
  return (
    <DeleteDialog
      trigger="Delete club"
      title="Delete this team or club?"
      summary={<span><strong>{name}</strong> will be removed. Its contacts stay in your client list.</span>}
      onConfirm={async () => {
        const res = await deleteOrganization(organizationId);
        return res.ok ? null : { error: res.error };
      }}
    />
  );
}
