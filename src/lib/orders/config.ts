import "server-only";

/**
 * Orders intake feature flag. Off by default: while off, POST /api/orders/intake
 * answers 404 and nothing order-related runs on the server. The Orders pages
 * still render (owner-only) so manually recorded orders stay visible.
 *
 *   ORDERS_INTAKE_ENABLED=1   turns the intake endpoint on (also needs SUPABASE_SERVICE_ROLE_KEY)
 */
export function isOrdersIntakeEnabled(): boolean {
  return process.env.ORDERS_INTAKE_ENABLED === "1";
}
