import { heartbeatAge, loadJobHeartbeats } from "@/lib/jobs/heartbeat";
import { isEmailEnabled } from "@/lib/notifications/email/config";
import { readOrderInvoicing } from "@/lib/orders/eligibility";
import { orderQueueOverview } from "@/lib/orders/queries";
import { isAutoInvoiceEnabled, isPaymentsEnabled, isSandboxPayments } from "@/lib/payments/config";
import { loadStudio } from "@/lib/studio/queries";
import { createClient } from "@/lib/supabase/server";
import type { PhotoJobHeartbeatRow } from "@/lib/supabase/database.types";
import { OrdersInvoicingSettings, type InvoicingFlags, type RunnerView } from "./OrdersInvoicingSettings";

/**
 * Server half of the "Photo-order payment links" card: the owner's mode and
 * activation time (studio settings), the server flags that gate automatic
 * invoicing, the invoice queue and the last runner ticks. Nothing here holds
 * a secret; flags are reported as on/off only.
 */
export async function OrdersInvoicingSection() {
  const supabase = await createClient();
  const now = new Date();
  const [studio, queue, beats] = await Promise.all([
    loadStudio(),
    orderQueueOverview().catch(() => ({ waiting: 0, oldestWaitingAt: null, exceptions: 0, emailFailed: 0 })),
    loadJobHeartbeats(supabase).catch((): Record<string, PhotoJobHeartbeatRow> => ({})),
  ]);
  const invoicing = readOrderInvoicing(studio?.settings ?? null);
  const payments = isPaymentsEnabled();
  const flags: InvoicingFlags = {
    payments,
    sandbox: payments && isSandboxPayments(),
    autoSwitch: isAutoInvoiceEnabled(),
    email: isEmailEnabled(),
    testOrders: (payments && isSandboxPayments()) || process.env.ORDERS_TEST_ORDERS_ENABLED === "1",
  };
  const runner = (name: "payments" | "deliveries"): RunnerView => {
    const row = beats[name];
    return row ? { ranAt: row.ran_at, age: heartbeatAge(row.ran_at, now), ok: row.ok, stale: now.getTime() - new Date(row.ran_at).getTime() > 30 * 60_000 } : { ranAt: null, age: "never", ok: false, stale: true };
  };
  return <OrdersInvoicingSettings mode={invoicing.mode} autoSince={invoicing.autoSince} flags={flags} queue={queue} runners={{ payments: runner("payments"), deliveries: runner("deliveries") }} />;
}
