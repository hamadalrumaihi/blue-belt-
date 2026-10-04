/**
 * Fulfilment after a confirmed payment — SHIPPED DISABLED.
 *
 * "Fulfilment" here means approving / releasing the customer's order in
 * Pic-Time once the money is confirmed. No Pic-Time order-approval API or
 * Zapier action has been verified for this account, so there is no real
 * integration to call. Rather than pretend, this module names the dependency
 * and turns the step into an explicit manual task: the paid transition
 * enqueues an [Orders] "Payment confirmed — approve the order in Pic-Time"
 * message and records `metadata.fulfillment = { state: "manual", … }` on the
 * booking. Nothing here is reachable without PAYMENTS_MYFATOORAH_ENABLED.
 *
 * To enable automatic fulfilment later: implement a provider that satisfies
 * `FulfillmentProvider`, verify it against a real Pic-Time order in the test
 * portal, and register it in `fulfillmentProvider()`; until then
 * `isFulfillmentAvailable()` is hard-coded false (no env flag can turn it on).
 */
export const FULFILLMENT_DEPENDENCY = "Pic-Time order approval integration (API or Zapier action) — not verified for this account";

export type FulfillmentResult =
  | { ok: true; provider: string; reference: string | null }
  | { ok: false; code: "NOT_AVAILABLE"; dependency: string };

export interface FulfillmentProvider {
  name: string;
  approveOrder(input: { bookingId: string; externalRef: string | null }): Promise<FulfillmentResult>;
}

export function isFulfillmentAvailable(): boolean {
  return false;
}

export function fulfillmentProvider(): FulfillmentProvider | null {
  return null;
}

/** What the paid transition records and tells the owner while fulfilment is manual. */
export function fulfillmentPlan(booking: { id: string; metadata: unknown }): { metadata: Record<string, unknown>; ownerText: string } {
  const current = booking.metadata && typeof booking.metadata === "object" && !Array.isArray(booking.metadata) ? (booking.metadata as Record<string, unknown>) : {};
  return {
    metadata: { ...current, fulfillment: { state: "manual", dependency: FULFILLMENT_DEPENDENCY } },
    ownerText: "Approve the order in Pic-Time by hand (automatic approval is not connected yet).",
  };
}
