import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/service", () => ({ isServiceClientConfigured: vi.fn(() => true), createServiceClient: vi.fn(() => ({})) }));
vi.mock("@/lib/notifications/delivery-runner", () => ({ runDeliveryBatch: vi.fn() }));
vi.mock("@/lib/notifications/reminders-run", () => ({ enqueueReminders: vi.fn(async () => ({ owners: 1, planned: 2 })) }));

import { POST } from "@/app/api/cron/deliveries/route";
import { runDeliveryBatch } from "@/lib/notifications/delivery-runner";
import { enqueueReminders } from "@/lib/notifications/reminders-run";
import { resetRateLimits } from "@/lib/rate-limit";

const runMock = vi.mocked(runDeliveryBatch);
const SECRET = "cron-secret-0123456789";

function post(auth: string | null = `Bearer ${SECRET}`) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (auth) headers.authorization = auth;
  return POST(new Request("http://localhost/api/cron/deliveries", { method: "POST", body: "{}", headers }));
}

beforeEach(() => {
  resetRateLimits();
  vi.stubEnv("CRON_SECRET", SECRET);
  vi.stubEnv("TELEGRAM_ENABLED", "1");
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "123:abc");
  runMock.mockReset();
  runMock.mockResolvedValue({ claimed: 0, sent: 0, retried: 0, failed: 0, skipped: 0, released: 0, stoppedEarly: false });
  vi.mocked(enqueueReminders).mockClear();
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/cron/deliveries", () => {
  it("requires the cron secret", async () => {
    expect((await post(null)).status).toBe(401);
    expect((await post("Bearer nope")).status).toBe(401);
    expect(runMock).not.toHaveBeenCalled();
  });

  it("is a no-op when Telegram is disabled", async () => {
    vi.stubEnv("TELEGRAM_ENABLED", "0");
    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, enabled: false });
    expect(runMock).not.toHaveBeenCalled();
  });

  it("plans reminders, then drains in bounded batches until a short batch", async () => {
    runMock
      .mockResolvedValueOnce({ claimed: 25, sent: 25, retried: 0, failed: 0, skipped: 0, released: 0, stoppedEarly: false })
      .mockResolvedValueOnce({ claimed: 3, sent: 2, retried: 1, failed: 0, skipped: 0, released: 0, stoppedEarly: false });
    const res = await post();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, enabled: true, claimed: 28, sent: 27, retried: 1, batches: 2, reminders: { planned: 2 } });
    expect(enqueueReminders).toHaveBeenCalledTimes(1);
    expect(runMock.mock.calls[0][0]).toMatchObject({ limit: 25 });
  });

  it("stops the loop when a batch was rate limited", async () => {
    runMock.mockResolvedValueOnce({ claimed: 25, sent: 1, retried: 1, failed: 0, skipped: 0, released: 23, stoppedEarly: true });
    const body = await (await post()).json();
    expect(body.batches).toBe(1);
    expect(runMock).toHaveBeenCalledTimes(1);
  });
});
