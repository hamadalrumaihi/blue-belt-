"use client";

import { useRouter } from "next/navigation";
import { DeleteDialog } from "@/components/DeleteDialog";
import { deleteManualPayment } from "@/lib/actions/bookings";

/** Removes one manual payment record (never a provider-verified one). */
export function DeletePaymentButton({ recordId, summary }: { recordId: string; summary: string }) {
  const router = useRouter();
  return (
    <DeleteDialog
      trigger={<span className="sr-only">Remove payment</span>}
      triggerClassName="h-9 w-9 p-0"
      title="Remove this payment?"
      summary={<span>{summary} will be removed and the booking balance recalculated. The provider&rsquo;s own records are not affected.</span>}
      confirmLabel="Remove"
      onConfirm={async () => {
        const res = await deleteManualPayment(recordId);
        if (!res.ok) return { error: res.error };
        router.refresh();
        return null;
      }}
    />
  );
}
