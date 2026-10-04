import { EMPTY_CAPTURE_AGENT_STATE, loadCaptureAgentState } from "@/lib/capture/settings";
import { createClient } from "@/lib/supabase/server";
import { isServiceClientConfigured } from "@/lib/supabase/service";
import { CaptureAgentSettings } from "./CaptureAgentSettings";

/**
 * Server half of the "Capture agent" card: reads the owner's credentials
 * (user client, RLS) and whether machine intake is configured on the server.
 */
export async function CaptureAgentSection() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const now = new Date();
  const state = user ? await loadCaptureAgentState(supabase, user.id, now) : EMPTY_CAPTURE_AGENT_STATE;
  return <CaptureAgentSettings configured={isServiceClientConfigured()} state={state} now={now.toISOString()} />;
}
