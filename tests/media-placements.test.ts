import { describe, expect, it } from "vitest";
import { ALL_PLACEMENTS, groupPlacements, orderedIds, parsePlacement, placementLimit, placementRows, serviceSlotOf } from "@/lib/media/placements";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

describe("placement vocabulary", () => {
  it("accepts the fixed placements and the manifest service slots", () => {
    expect(parsePlacement("hero")).toBe("hero");
    expect(parsePlacement("featured")).toBe("featured");
    expect(parsePlacement("work")).toBe("work");
    expect(parsePlacement("service:club")).toBe("service:club");
    expect(parsePlacement("service:tournament_photo_video")).toBe("service:tournament_photo_video");
    expect(ALL_PLACEMENTS).toContain("service:private_session");
  });

  it("maps the catalog's service keys onto the slots the pages use", () => {
    expect(parsePlacement("service:team_tournament")).toBe("service:club");
    expect(parsePlacement("service:training_content")).toBe("service:training_session");
    expect(parsePlacement("service:athlete_portrait")).toBe("service:private_session");
    expect(parsePlacement("service:organizer_custom")).toBe("service:custom");
    expect(serviceSlotOf("service:club")).toBe("club");
    expect(serviceSlotOf("hero")).toBeNull();
  });

  it("rejects unknown and malformed placements", () => {
    expect(parsePlacement("service:")).toBeNull();
    expect(parsePlacement("service:../x")).toBeNull();
    expect(parsePlacement("HERO")).toBeNull();
    expect(parsePlacement(12)).toBeNull();
    expect(parsePlacement("banner")).toBeNull();
  });
});

describe("ordering", () => {
  const rows = [
    { asset_id: B, placement: "featured", position: 2 },
    { asset_id: A, placement: "featured", position: 0 },
    { asset_id: C, placement: "featured", position: 1 },
    { asset_id: C, placement: "hero", position: 0 },
    { asset_id: A, placement: "service:team_tournament", position: 0 },
    { asset_id: B, placement: "banner", position: 0 },
  ];

  it("orders by position, ignores unknown placements and merges catalog aliases", () => {
    expect(orderedIds(rows, "featured")).toEqual([A, C, B]);
    expect(orderedIds(rows, "hero")).toEqual([C]);
    expect(orderedIds(rows, "service:club")).toEqual([A]);
    expect(orderedIds(rows, "service:team_tournament")).toEqual([A]);
    expect(orderedIds(rows, "work")).toEqual([]);
    const grouped = groupPlacements(rows);
    expect(grouped.featured).toEqual([A, C, B]);
    expect(Object.keys(grouped)).not.toContain("banner");
  });

  it("drops duplicate ids and keeps the first occurrence", () => {
    expect(orderedIds([{ asset_id: A, placement: "work", position: 5 }, { asset_id: A, placement: "work", position: 1 }, { asset_id: B, placement: "work", position: 3 }], "work")).toEqual([A, B]);
  });

  it("writes rows with sequential positions, one hero at most, capped at the placement limit", () => {
    expect(placementRows("featured", [B, A, B, C])).toEqual([
      { placement: "featured", asset_id: B, position: 0 },
      { placement: "featured", asset_id: A, position: 1 },
      { placement: "featured", asset_id: C, position: 2 },
    ]);
    expect(placementRows("hero", [A, B])).toEqual([{ placement: "hero", asset_id: A, position: 0 }]);
    expect(placementLimit("hero")).toBe(1);
    const many = Array.from({ length: 20 }, (_, i) => `${i.toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`);
    expect(placementRows("featured", many)).toHaveLength(placementLimit("featured"));
    expect(placementRows("service:club", many)).toHaveLength(placementLimit("service:club"));
    expect(placementRows("banner" as never, [A])).toEqual([]);
  });
});
