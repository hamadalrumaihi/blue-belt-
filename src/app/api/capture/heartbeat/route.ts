import { NextResponse } from "next/server";
import { recordHeartbeat } from "@/lib/capture/credential-store";
import { authenticateIntake } from "@/lib/capture/intake";
import { requestLogger } from "@/lib/log";
import type { Json } from "@/lib/supabase/database.types";
import { isPlainObject } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUS_STRING_KEYS = new Set(["state", "lastCaptureAt", "lastError", "pausedReason", "hostname"]);
const STATUS_NUMBER_KEYS = new Set(["spooled", "jobs", "uptimeSec", "captures", "failures"]);

/**
 * POST /api/capture/heartbeat  (Authorization: Bearer bbmc_…)
 *   { agentVersion?: string, status?: { state, jobs, spooled, lastCaptureAt, lastError, pausedReason, … } }
 *
 * Lets the owner see in Settings that their agent is alive, paused on a human
 * check, or stuck. Only a fixed allow-list of scalar status keys is stored.
 */
export async function POST(request: Request) {
  const { log, requestId } = requestLogger(request, "api/capture/heartbeat");
  const auth = await authenticateIntake(request, "api/capture/heartbeat", requestId, log);
  if (!auth.ok) return auth.response;
  const { supabase, credential, headers, now } = auth.ctx;

  let raw: unknown = {};
  try {
    raw = await request.json();
  } catch {
    raw = {};
  }
  const body = isPlainObject(raw) ? raw : {};
  const agentVersion = typeof body.agentVersion === "string" ? body.agentVersion.slice(0, 40) : null;
  const status: Record<string, string | number> = {};
  if (isPlainObject(body.status)) {
    for (const [k, v] of Object.entries(body.status)) {
      if (STATUS_STRING_KEYS.has(k) && typeof v === "string" && !/[<>]/.test(v)) status[k] = v.slice(0, 200);
      else if (STATUS_NUMBER_KEYS.has(k) && typeof v === "number" && Number.isFinite(v)) status[k] = Math.round(v);
    }
  }
  await recordHeartbeat(supabase, credential, { now, agentVersion, status: status as Json });
  return NextResponse.json({ ok: true, receivedAt: now.toISOString(), credential: { name: credential.name, expiresAt: credential.expires_at } }, { headers });
}
