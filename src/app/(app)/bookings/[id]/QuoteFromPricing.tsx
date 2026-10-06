import Link from "next/link";
import { TagIcon } from "@/components/icons";
import { formatQr } from "@/lib/bookings/state";
import { listQuotes } from "@/lib/pricing/queries";
import { requireOwner } from "@/lib/roles";

const STATUS_LABEL = { draft: "draft", applied: "applied", discarded: "discarded" } as const;

/**
 * Small owner-only panel on the booking page: a link to build a quote from
 * reference prices and the latest quote for this booking. Renders nothing for
 * staff (requireOwner) so pricing never shows outside the owner's view.
 */
export async function QuoteFromPricing({ bookingId }: { bookingId: string }) {
  const owner = await requireOwner();
  if (!owner.ok) return null;
  const [latest] = await listQuotes({ bookingId, limit: 1 });
  return (
    <div className="mt-4 border-t border-line pt-3">
      <p className="mb-2 text-xs font-semibold text-muted">Pricing</p>
      <Link href={`/pricing/quote?booking=${bookingId}`} className="btn-secondary min-h-11"><TagIcon size={16} /> Suggest a quote from reference prices</Link>
      {latest && (
        <p className="mt-2 text-xs text-muted">
          Latest quote:{" "}
          <Link href={`/pricing/quote/${latest.id}`} className="font-semibold text-primary hover:underline">
            {latest.status === "applied" && latest.chosen_amount_qr !== null ? formatQr(latest.chosen_amount_qr) : `${formatQr(latest.suggested_from)}${latest.suggested_to !== null && Number(latest.suggested_to) !== Number(latest.suggested_from) ? ` to ${formatQr(latest.suggested_to)}` : ""}`}
          </Link>{" "}
          ({STATUS_LABEL[latest.status]})
        </p>
      )}
    </div>
  );
}
