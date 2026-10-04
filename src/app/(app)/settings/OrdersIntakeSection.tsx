import { EMPTY_CAPTURE_AGENT_STATE, loadCaptureAgentState } from "@/lib/capture/settings";
import { isOrdersIntakeEnabled } from "@/lib/orders/config";
import { createClient } from "@/lib/supabase/server";
import { isServiceClientConfigured } from "@/lib/supabase/service";
import { OrdersIntakeSettings } from "./OrdersIntakeSettings";

/** Server half of the "Orders intake (Pic-Time via Zapier)" card. */
export async function OrdersIntakeSection() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const now = new Date();
  const all = user ? await loadCaptureAgentState(supabase, user.id, now) : EMPTY_CAPTURE_AGENT_STATE;
  const credentials = all.credentials.filter((c) => c.kind === "orders");
  const origin = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "");
  return <OrdersIntakeSettings enabled={isOrdersIntakeEnabled() && isServiceClientConfigured()} credentials={credentials} endpoint={`${origin || ""}/api/orders/intake`} now={now.toISOString()} />;
}
