import { describe, expect, it } from "vitest";
import { DEFAULT_SERVICES } from "@/lib/services/form";
import { isPlaceholderDescription, isPlaceholderSentence, publicServiceDescription } from "@/lib/services/public";

describe("publicServiceDescription", () => {
  it("strips seed instructions and leaves the offer", () => {
    expect(publicServiceDescription("All of one athlete's matches photographed, from warm-up to podium. Set your price.")).toBe("All of one athlete's matches photographed, from warm-up to podium.");
    expect(publicServiceDescription("Seminars, gradings, promotions and anything else. Quoted individually.")).toBe("Seminars, gradings, promotions and anything else.");
    expect(publicServiceDescription("A photographer and/or videographer for the whole team at an event. Quoted per day.")).toBe("A photographer and/or videographer for the whole team at an event.");
    expect(publicServiceDescription("Set your price.\nPhotos plus full-match video of every bout.")).toBe("Photos plus full-match video of every bout.");
    expect(publicServiceDescription("Set your price")).toBeNull();
    expect(publicServiceDescription("  ")).toBeNull();
    expect(publicServiceDescription(null)).toBeNull();
    expect(publicServiceDescription(undefined)).toBeNull();
  });
  it("keeps real copy that merely mentions prices", () => {
    expect(publicServiceDescription("Prints can be ordered from the gallery. Travel outside Doha is priced separately.")).toBe("Prints can be ordered from the gallery. Travel outside Doha is priced separately.");
    expect(isPlaceholderSentence("Travel outside Doha is priced separately.")).toBe(false);
  });
});

describe("isPlaceholderDescription", () => {
  it("flags descriptions the owner still has to replace", () => {
    expect(isPlaceholderDescription("One hour at your academy. Set your price.")).toBe(true);
    expect(isPlaceholderDescription("TBD")).toBe(true);
    expect(isPlaceholderDescription("Lorem ipsum dolor sit amet.")).toBe(true);
    expect(isPlaceholderDescription("One hour at your academy during class or open mat.")).toBe(false);
    expect(isPlaceholderDescription(null)).toBe(false);
  });
  it("the seeded packages ship without placeholders", () => {
    for (const s of DEFAULT_SERVICES) {
      expect(isPlaceholderDescription(s.description)).toBe(false);
      expect(publicServiceDescription(s.description)).toBe(s.description);
    }
  });
});
