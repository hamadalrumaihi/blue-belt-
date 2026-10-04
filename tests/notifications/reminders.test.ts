import { describe, expect, it } from "vitest";

import { planReminders, reminderLeads } from "@/lib/notifications/reminders";
import { matchRow } from "../helpers/rows";

const NOW = new Date("2026-03-14T06:00:00.000Z");
const athlete = { id: "a1", name: "Jane <Doe>", owner_id: "owner-1", event_id: "e1" };
const at = (min: number) => new Date(NOW.getTime() + min * 60_000).toISOString();
const cand = (m: Partial<Parameters<typeof matchRow>[0]>) => ({ match: matchRow({ id: "m1", mat: "Mat 3", scheduled_at: at(15), ...m }), athlete, timezone: "Asia/Qatar" });

describe("reminderLeads", () => {
  it("parses the env list, dedupes, sorts descending and falls back to 15,5", () => {
    expect(reminderLeads(undefined)).toEqual([15, 5]);
    expect(reminderLeads("5, 20,5")).toEqual([20, 5]);
    expect(reminderLeads("abc")).toEqual([15, 5]);
  });
});

describe("planReminders", () => {
  it("plans a 15-minute reminder once per 5-minute bucket of the target, with the match prefix text", () => {
    const [r] = planReminders([cand({})], NOW);
    expect(r).toMatchObject({ ownerId: "owner-1", matchId: "m1", lead: 15, kind: "REMIND_15", alertKey: "remind:15:m1:2026-03-14T06:15:00.000Z" });
    expect(r.text).toContain("<b>Jane &lt;Doe&gt; in 15 min</b>");
    expect(r.text).toContain("Mat 3 · 09:15");
    // 30 s later: still inside the window, same key (dedupe by the unique index).
    expect(planReminders([cand({})], new Date(NOW.getTime() + 30_000))[0].alertKey).toBe(r.alertKey);
    // A 1-minute shuffle keeps the same bucket; a real move (to 06:25, seen 15 min before it) changes it.
    expect(planReminders([cand({ scheduled_at: at(14) })], NOW)[0].alertKey).toBe(r.alertKey);
    expect(planReminders([cand({ scheduled_at: at(25) })], new Date(NOW.getTime() + 10 * 60_000))[0].alertKey).toBe("remind:15:m1:2026-03-14T06:25:00.000Z");
  });

  it("uses the 5-minute lead near the match, skips matches outside both windows and finished / on-mat ones", () => {
    expect(planReminders([cand({ scheduled_at: at(5) })], NOW)[0]).toMatchObject({ lead: 5, kind: "REMIND_5" });
    expect(planReminders([cand({ scheduled_at: at(10) })], NOW)).toEqual([]);
    expect(planReminders([cand({ scheduled_at: at(40) })], NOW)).toEqual([]);
    expect(planReminders([cand({ scheduled_at: at(1) })], NOW)).toEqual([]); // GO TO MAT territory, not a reminder
    expect(planReminders([cand({ status: "complete" })], NOW)).toEqual([]);
    expect(planReminders([cand({ status: "on_mat" })], NOW)).toEqual([]);
    expect(planReminders([cand({ scheduled_at: null })], NOW)).toEqual([]);
  });

  it("uses the estimate when present and the owner's manual correction when active", () => {
    expect(planReminders([cand({ scheduled_at: at(40), estimated_at: at(5) })], NOW)[0]).toMatchObject({ lead: 5 });
    const manual = planReminders([cand({ scheduled_at: at(40), override_scheduled_at: at(15), override_mat: "Mat 9", override_until: at(600) })], NOW)[0];
    expect(manual).toMatchObject({ lead: 15 });
    expect(manual.text).toContain("Mat 9");
    expect(manual.text).toContain("manual correction in effect");
  });
});
