import { esignStatus } from "@/lib/esign/config";
import type { PhotoBookingRow, PhotoDocumentRow } from "@/lib/supabase/database.types";
import { ContractPanelClient, type ContractPanelDocument, type ContractPanelEsign } from "@/app/(app)/documents/ContractPanelClient";

/**
 * Agreement panel on the owner's booking page: every document for the
 * booking with its signer role, status, timestamps, provider details and
 * the owner's actions (prepare, send, resend, copy link, void, refresh,
 * and the test buttons when the mock provider is on). Server component so
 * the provider status comes from the environment, never from the browser.
 */
export function ContractPanel({ booking, documents, esign }: { booking: PhotoBookingRow; documents: PhotoDocumentRow[]; esign?: ContractPanelEsign }) {
  const status = esign ?? toPanelEsign();
  const rows: ContractPanelDocument[] = documents.map((d) => ({
    id: d.id,
    kind: d.kind,
    title: d.title,
    status: d.status,
    signer_role: d.signer_role,
    signer_name: d.signer_name,
    required_for_confirmation: d.required_for_confirmation,
    provider: d.provider,
    provider_envelope_id: d.provider_envelope_id,
    provider_status: d.provider_status,
    provider_error: d.provider_error,
    created_at: d.created_at,
    sent_at: d.sent_at,
    viewed_at: d.viewed_at,
    signed_at: d.signed_at,
    declined_at: d.declined_at,
    voided_at: d.voided_at,
    expires_at: d.expires_at,
  }));
  return (
    <ContractPanelClient
      booking={{
        id: booking.id,
        booking_status: booking.booking_status,
        booking_type: booking.booking_type,
        athlete_name: booking.athlete_name,
        requires_contract: booking.requires_contract,
        requires_guardian_release: booking.requires_guardian_release,
        subject_is_minor: booking.subject_is_minor,
        contract_state: booking.contract_state,
        deposit_state: booking.deposit_state,
        balance_state: booking.balance_state,
        amount_qr: booking.amount_qr,
        guardianName: guardianNameOf(booking),
      }}
      documents={rows}
      esign={status}
    />
  );
}

function toPanelEsign(): ContractPanelEsign {
  const s = esignStatus();
  return { provider: s.provider, configured: s.configured, mock: s.mock, missing: s.missing, notes: s.notes };
}

function guardianNameOf(booking: PhotoBookingRow): string | null {
  const g = booking.guardian;
  if (!g || typeof g !== "object" || Array.isArray(g)) return null;
  const name = (g as Record<string, unknown>).name;
  return typeof name === "string" && name.trim() ? name.trim() : null;
}
