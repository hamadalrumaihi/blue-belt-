import type { PhotoBookingRow, PhotoDocumentRow } from "@/lib/supabase/database.types";

/**
 * Agreement panel on the owner's booking page. Placeholder: the e-signature
 * slice replaces this file with the real prepare / send / resend / copy link /
 * void controls and the status timeline.
 */
export function ContractPanel({ booking, documents }: { booking: PhotoBookingRow; documents: PhotoDocumentRow[] }) {
  const signed = documents.filter((d) => d.status === "signed").length;
  return (
    <div className="card p-4 sm:p-5" data-contract-state={booking.contract_state}>
      <p className="text-sm font-bold text-ink">Agreement</p>
      <p className="mt-1 text-sm text-muted">{documents.length === 0 ? "No agreement prepared yet." : `${signed} of ${documents.length} signed.`}</p>
    </div>
  );
}
