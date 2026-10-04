import { describe, expect, it } from "vitest";

import { defaultOverrideUntil, effectiveMatch, overrideActive, overrideOf, overrideSuperseded } from "@/lib/manual-correction";
import { matchRow } from "./helpers/rows";

const NOW = new Date("2026-03-14T06:00:00.000Z");
const corrected = () => matchRow({ mat: "Mat 3", scheduled_at: "2026-03-14T07:40:00.000Z", estimated_at: "2026-03-14T07:50:00.000Z", override_mat: "Mat 5", override_scheduled_at: "2026-03-14T08:00:00.000Z", override_by: "owner", override_at: "2026-03-14T05:00:00.000Z", override_reason: "Announcer moved it", override_until: "2026-03-14T23:59:59.000Z" });

describe("manual corrections", () => {
  it("effectiveMatch applies an active correction and labels it; the source values stay stored", () => {
    const m = corrected();
    const eff = effectiveMatch(m, NOW);
    expect(eff.mat).toBe("Mat 5");
    expect(eff.scheduled_at).toBe("2026-03-14T08:00:00.000Z");
    expect(eff.estimated_at).toBeNull(); // a manual time wins over the source estimate
    expect(eff.manual).toEqual({ mat: true, time: true });
    expect(m.mat).toBe("Mat 3");
    expect(overrideOf(m)).toMatchObject({ mat: "Mat 5", by: "owner", reason: "Announcer moved it" });
    expect(overrideOf(matchRow())).toBeNull();
  });

  it("an expired correction no longer applies", () => {
    const m = corrected();
    expect(overrideActive(m, NOW)).toBe(true);
    expect(overrideActive(m, new Date("2026-03-15T00:00:00.000Z"))).toBe(false);
    const eff = effectiveMatch(m, new Date("2026-03-15T00:00:00.000Z"));
    expect(eff.mat).toBe("Mat 3");
    expect(eff.manual).toEqual({ mat: false, time: false });
    expect(effectiveMatch(matchRow({ override_mat: "Mat 9", override_until: null }), NOW).mat).toBe("Mat 9"); // no lifetime = until cleared
  });

  it("a correction is superseded only when the SOURCE changes the corrected field", () => {
    const m = corrected();
    expect(overrideSuperseded(m, { mat: "Mat 3", scheduledAt: "2026-03-14T07:40:00.000Z" })).toEqual({ mat: false, time: false }); // source unchanged → correction stands
    expect(overrideSuperseded(m, { mat: "mat 3 ", scheduledAt: "2026-03-14T07:40:00+00:00" })).toEqual({ mat: false, time: false });
    expect(overrideSuperseded(m, { mat: "Mat 4", scheduledAt: "2026-03-14T07:40:00.000Z" })).toEqual({ mat: true, time: false });
    expect(overrideSuperseded(m, { mat: null, scheduledAt: "2026-03-14T09:00:00.000Z" })).toEqual({ mat: false, time: true }); // a missing mat is a parse gap, not a change
    expect(overrideSuperseded(matchRow({ mat: "Mat 1" }), { mat: "Mat 2", scheduledAt: null })).toEqual({ mat: false, time: false }); // nothing corrected
  });

  it("defaultOverrideUntil is the end of the event day in its timezone, or 12 h when later / unknown", () => {
    expect(defaultOverrideUntil(NOW, "2026-03-14", "Asia/Qatar")).toBe("2026-03-14T20:59:59.000Z"); // 23:59:59 +03:00
    expect(defaultOverrideUntil(NOW, null, "Asia/Qatar")).toBe("2026-03-14T18:00:00.000Z");
    expect(defaultOverrideUntil(new Date("2026-03-14T20:00:00.000Z"), "2026-03-14", "Asia/Qatar")).toBe("2026-03-15T08:00:00.000Z"); // 12 h is later than end of day
  });
});
