import { describe, expect, it } from "vitest";
import { nameCollisions, normaliseName, parseClientForm } from "@/lib/client-form";

const EVENT = "33333333-3333-4333-8333-333333333333";
const AJP = "https://ajptour.com/en/event/1411/bracket/130617";

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe("parseClientForm", () => {
  it("requires name, event, platform and URL but NOT phone/email/academy", () => {
    const { fieldErrors } = parseClientForm(fd({ name: "Hamad", event_id: EVENT, platform: "AJP", source_url: AJP }));
    expect(fieldErrors).toEqual({});
  });

  it("lets a Quick Add client (no phone/email/academy) be saved from the full form", () => {
    const { fieldErrors, values } = parseClientForm(fd({ name: "Quick Client", event_id: EVENT, platform: "AJP", source_url: AJP, notes: "ring 2" }));
    expect(fieldErrors).toEqual({});
    expect(values.phone).toBeNull();
    expect(values.email).toBeNull();
    expect(values.academy).toBeNull();
    expect(values.notes).toBe("ring 2");
  });

  it("still validates email format when one is provided", () => {
    expect(parseClientForm(fd({ name: "A", event_id: EVENT, platform: "AJP", source_url: AJP, email: "nope" })).fieldErrors.email).toBeTruthy();
    expect(parseClientForm(fd({ name: "A", event_id: EVENT, platform: "AJP", source_url: AJP, email: "a@b.com" })).fieldErrors.email).toBeUndefined();
  });

  it("reports missing required fields", () => {
    const { fieldErrors } = parseClientForm(fd({ name: "", platform: "AJP" }));
    expect(fieldErrors.name).toBeTruthy();
    expect(fieldErrors.event_id).toBeTruthy();
    expect(fieldErrors.source_url).toBeTruthy();
  });

  it("defaults active=true when no active control was rendered (create form)", () => {
    expect(parseClientForm(fd({ name: "A", event_id: EVENT, platform: "AJP", source_url: AJP })).values.active).toBe(true);
  });

  it("honours the active checkbox when the control is present (edit form)", () => {
    const checked = parseClientForm(fd({ name: "A", event_id: EVENT, platform: "AJP", source_url: AJP, active_present: "1", active: "on" }));
    expect(checked.values.active).toBe(true);
    // Unchecked checkbox submits the sentinel but no `active` value → paused.
    const unchecked = parseClientForm(fd({ name: "A", event_id: EVENT, platform: "AJP", source_url: AJP, active_present: "1" }));
    expect(unchecked.values.active).toBe(false);
  });
});

describe("nameCollisions (duplicate = same person, shared URL allowed)", () => {
  const rows = [
    { id: "a", name: "Hamad Al-Rumaihi" },
    { id: "b", name: "Marco Rossi" },
  ];

  it("flags the same normalised name", () => {
    expect(nameCollisions(rows, "  hamad   al-rumaihi ").map((r) => r.id)).toEqual(["a"]);
  });

  it("does not flag a different athlete even when they share a bracket URL (no URL keying)", () => {
    // nameCollisions never looks at URLs, so two distinct names never collide.
    expect(nameCollisions(rows, "Khalid Noor")).toEqual([]);
  });

  it("excludes the row being edited", () => {
    expect(nameCollisions(rows, "Hamad Al-Rumaihi", "a")).toEqual([]);
  });

  it("normaliseName matches the DB name_key rule", () => {
    expect(normaliseName("  Hamad   AL-Rumaihi ")).toBe("hamad al-rumaihi");
  });
});
