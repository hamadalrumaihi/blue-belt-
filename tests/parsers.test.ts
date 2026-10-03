import { describe, expect, it } from "vitest";
import { ajpAdapter, parseGeneric } from "@/lib/watchers/ajp";
import { smoothcompAdapter } from "@/lib/watchers/smoothcomp";
import {
  dedupe,
  extractMat,
  extractMatchNumber,
  extractOpponent,
  extractStatus,
  extractTime,
  filterForAthlete,
  isBotChallenge,
  load,
  looksLikeJsShell,
  mentionsAthlete,
  normalizeName,
  scheduleNotPublished,
  sortMatches,
} from "@/lib/watchers/extract";
import { fixture } from "./fixtures";
import { normalized, watchContext } from "./helpers/rows";

const AJP_URL = "https://ajptour.com/events/4471/brackets/88";
const SMOOTHCOMP_URL = "https://smoothcomp.com/en/event/18211/schedule";

describe("adapters: canHandle", () => {
  it("routes hosts to the right adapter, subdomains included", () => {
    expect(ajpAdapter.canHandle(new URL("https://ajptour.com/events"))).toBe(true);
    expect(ajpAdapter.canHandle(new URL("https://www.ajptour.com/events"))).toBe(true);
    expect(ajpAdapter.canHandle(new URL("https://smoothcomp.com/en"))).toBe(false);
    expect(smoothcompAdapter.canHandle(new URL("https://smoothcomp.com/en"))).toBe(true);
    expect(smoothcompAdapter.canHandle(new URL("https://www.smoothcomp.com/en"))).toBe(true);
    expect(smoothcompAdapter.canHandle(new URL("https://ajptour.com"))).toBe(false);
    expect(ajpAdapter.canHandle(new URL("https://evil-ajptour.com"))).toBe(false);
  });
});

describe("AJP bracket table (server-rendered)", () => {
  const html = fixture("ajp-bracket-table");

  it("finds the athlete's rows, mapping Red/Blue to athlete/opponent and the Match # column", () => {
    const result = ajpAdapter.parse(html, watchContext({ athleteName: "Hamad Al Rumaihi" }));
    expect(result.platform).toBe("AJP");
    expect(result.status).toBe("OK");
    expect(result.code).toBe("MATCHES_FOUND");
    expect(result.strategy).toBe("table");
    expect(result.athlete).toBe("Hamad Al Rumaihi");
    expect(result.sourceUrl).toBe(AJP_URL);
    expect(result.fetchedAt).toBe("2026-03-14T06:00:00.000Z");
    expect(result.message).toContain("Qatar National Pro 2026");

    // Six rows on the page (five + a repeat), three about the athlete, deduped to two.
    expect(result.matches).toHaveLength(2);
    const [first, second] = result.matches;
    expect(first).toMatchObject({
      athlete: "Hamad Al-Rumaihi",
      opponent: "João Silva",
      mat: "Mat 3",
      matchNumber: "12",
      status: "scheduled",
      externalMatchId: null,
      sourceUrl: AJP_URL,
    });
    // Athlete is in the Blue column here: the opponent is the Red competitor.
    expect(second).toMatchObject({ athlete: "Hamad Al-Rumaihi", opponent: "Marco Rossi", mat: "Mat 1", matchNumber: "27" });
    expect(first.raw.cells).toEqual(["12", "Mat 3", "10:40", "Hamad Al-Rumaihi", "João Silva", "Scheduled"]);
  });

  it("converts wall-clock times with the event date and Asia/Qatar (UTC+3)", () => {
    const result = ajpAdapter.parse(html, watchContext({ athleteName: "Hamad Al Rumaihi", timezone: "Asia/Qatar", eventDate: "2026-03-14" }));
    expect(result.matches.map((m) => m.scheduledAt)).toEqual(["2026-03-14T07:40:00.000Z", "2026-03-14T11:15:00.000Z"]);
  });

  it("falls back to today in the zone when no event date is known", () => {
    const now = new Date("2026-03-14T22:30:00.000Z"); // already 15 March 01:30 in Doha
    const result = ajpAdapter.parse(html, watchContext({ athleteName: "Hamad Al Rumaihi", eventDate: null, now }));
    expect(result.matches[0].scheduledAt).toBe("2026-03-15T07:40:00.000Z");
  });

  it("extracts the status column for other competitors (on mat, complete)", () => {
    const onMat = ajpAdapter.parse(html, watchContext({ athleteName: "Ali Hassan" }));
    expect(onMat.matches).toHaveLength(1);
    expect(onMat.matches[0]).toMatchObject({ status: "on_mat", opponent: "Pedro Costa", mat: "Mat 2", matchNumber: "11" });

    const finished = ajpAdapter.parse(html, watchContext({ athleteName: "Carlos Mendes" }));
    expect(finished.matches[0]).toMatchObject({ status: "complete", opponent: "Yusuf Al-Thani", matchNumber: "10" });
  });

  it("returns ATHLETE_NOT_FOUND when many competitors are listed and none match", () => {
    const result = ajpAdapter.parse(html, watchContext({ athleteName: "Nobody Here" }));
    expect(result.status).toBe("ATHLETE_NOT_FOUND");
    expect(result.code).toBe("ATHLETE_NOT_FOUND");
    expect(result.matches).toEqual([]);
    expect(result.strategy).toBe("table");
    expect(result.message).toContain("Nobody Here");
  });

  it("returns every row, ordered by match number, when no athlete is given", () => {
    const result = ajpAdapter.parse(html, watchContext({ athleteName: null }));
    expect(result.status).toBe("OK");
    expect(result.matches.map((m) => m.matchNumber)).toEqual(["10", "11", "12", "13", "27"]);
    expect(result.matches[0]).toMatchObject({ athlete: "Carlos Mendes", opponent: "Yusuf Al-Thani" });
  });
});

describe("AJP embedded JSON (Inertia data-page + application/json)", () => {
  const html = fixture("ajp-embedded-json");

  it("reads competitors arrays, ids, order and ETA and dedupes the repeated match by id", () => {
    const result = ajpAdapter.parse(html, watchContext({ athleteName: "Hamad Al Rumaihi" }));
    expect(result.status).toBe("OK");
    expect(result.strategy).toBe("embedded-json");
    expect(result.matches).toHaveLength(2);
    expect(result.matches[0]).toMatchObject({
      externalMatchId: "9012",
      matchNumber: "12",
      matchOrder: 2,
      mat: "Mat 3",
      scheduledAt: "2026-03-14T07:40:00.000Z",
      estimatedAt: null,
      athlete: "Hamad Al-Rumaihi",
      opponent: "João Silva",
      status: "scheduled",
    });
    expect(result.matches[1]).toMatchObject({
      externalMatchId: "9027",
      matchNumber: "27",
      matchOrder: 5,
      mat: "Mat 1",
      scheduledAt: "2026-03-14T11:15:00.000Z",
      estimatedAt: "2026-03-14T11:25:00.000Z",
      opponent: "Marco Rossi",
    });
  });

  it("maps snake_case API statuses", () => {
    const result = ajpAdapter.parse(html, watchContext({ athleteName: null }));
    const byId = new Map(result.matches.map((m) => [m.externalMatchId, m]));
    expect(byId.get("9011")?.status).toBe("on_mat");
    expect(byId.get("9010")?.status).toBe("complete");
    expect(byId.get("9013")?.status).toBe("scheduled");
    expect(result.matches.map((m) => m.matchOrder)).toEqual([1, 2, 3, 4, 5]);
  });

  it("returns ATHLETE_NOT_FOUND when the athlete is not among the competitors", () => {
    const result = ajpAdapter.parse(html, watchContext({ athleteName: "Nobody Here" }));
    expect(result.status).toBe("ATHLETE_NOT_FOUND");
    expect(result.strategy).toBe("embedded-json");
  });
});

describe("Smoothcomp schedule cards", () => {
  const html = fixture("smoothcomp-cards");
  const ctx = (athleteName: string | null) =>
    watchContext({ url: new URL(SMOOTHCOMP_URL), athleteName, timezone: "Europe/London", eventDate: "2026-07-04" });

  it("reads mat / time / opponent / status from card text and converts to the event timezone (BST)", () => {
    const result = smoothcompAdapter.parse(html, ctx("Hamad Al Rumaihi"));
    expect(result.platform).toBe("SMOOTHCOMP");
    expect(result.status).toBe("OK");
    expect(result.strategy).toBe("cards");
    expect(result.matches).toHaveLength(2);
    expect(result.matches[0]).toMatchObject({
      athlete: "Hamad Al Rumaihi",
      opponent: "João Silva",
      mat: "Mat 3",
      matchNumber: "12",
      scheduledAt: "2026-07-04T09:40:00.000Z",
      status: "scheduled",
      sourceUrl: SMOOTHCOMP_URL,
    });
    expect(result.matches[1]).toMatchObject({ opponent: "Marco Rossi", mat: "Mat 1", matchNumber: "27", scheduledAt: "2026-07-04T13:15:00.000Z" });
  });

  it("does not leak the status label into the opponent name", () => {
    const result = smoothcompAdapter.parse(html, ctx("Pedro Costa"));
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]).toMatchObject({ opponent: "Ali Hassan", status: "on_mat", mat: "Mat 2" });
  });

  it("returns ATHLETE_NOT_FOUND for an unknown athlete", () => {
    const result = smoothcompAdapter.parse(html, ctx("Nobody Here"));
    expect(result.status).toBe("ATHLETE_NOT_FOUND");
    expect(result.strategy).toBe("cards");
  });
});

describe("non-schedule pages", () => {
  it("classifies the Cloudflare challenge as REQUIRES_BROWSER_WATCHER / BROWSER_CHALLENGE", () => {
    const html = fixture("cloudflare-challenge");
    expect(isBotChallenge(html)).toBe(true);
    const result = ajpAdapter.parse(html, watchContext());
    expect(result.status).toBe("REQUIRES_BROWSER_WATCHER");
    expect(result.code).toBe("BROWSER_CHALLENGE");
    expect(result.matches).toEqual([]);
    expect(result.message).toMatch(/browser challenge/i);
  });

  it("classifies a JavaScript shell as REQUIRES_BROWSER_WATCHER / BROWSER_JS_SHELL", () => {
    const html = fixture("js-shell");
    expect(isBotChallenge(html)).toBe(false);
    expect(looksLikeJsShell(load(html))).toBe(true);
    const result = smoothcompAdapter.parse(html, watchContext({ url: new URL(SMOOTHCOMP_URL) }));
    expect(result.status).toBe("REQUIRES_BROWSER_WATCHER");
    expect(result.code).toBe("BROWSER_JS_SHELL");
  });

  it("classifies an unpublished schedule as NO_MATCHES / SCHEDULE_NOT_PUBLISHED", () => {
    const html = fixture("schedule-unpublished");
    expect(looksLikeJsShell(load(html))).toBe(false);
    expect(scheduleNotPublished(load(html))).toBe(true);
    const result = ajpAdapter.parse(html, watchContext());
    expect(result.status).toBe("NO_MATCHES");
    expect(result.code).toBe("SCHEDULE_NOT_PUBLISHED");
    expect(result.message).toBe("Schedule not published yet.");
  });

  it("classifies a plain page with no schedule as NO_MATCHES / NO_MATCH_ROWS", () => {
    const html = "<html><head><title>About</title></head><body><h1>About AJP</h1><p>The Abu Dhabi Jiu-Jitsu Pro tour organises events worldwide.</p></body></html>";
    const result = parseGeneric(html, watchContext(), "AJP");
    expect(result.status).toBe("NO_MATCHES");
    expect(result.code).toBe("NO_MATCH_ROWS");
  });

  it("never throws: a parser failure becomes PARSE_ERROR", () => {
    // A non-string body (e.g. a worker returning JSON instead of HTML) blows up inside the pipeline.
    const result = parseGeneric({ html: "<html></html>" } as unknown as string, watchContext(), "AJP");
    expect(result.status).toBe("PARSE_ERROR");
    expect(result.code).toBe("PARSE_FAILED");
    expect(result.matches).toEqual([]);
    expect(typeof result.message).toBe("string");
  });
});

describe("extract helpers", () => {
  it("extractMat / extractTime / extractMatchNumber / extractStatus", () => {
    expect(extractMat("Tatami 12 at 10:00")).toBe("Mat 12");
    expect(extractMat("mat #3")).toBe("Mat 3");
    expect(extractMat("Mat A")).toBe("Mat A");
    expect(extractMat("Matheus Souza vs X")).toBeNull();
    expect(extractTime("starts 9:05 am")).toBe("9:05 am");
    expect(extractTime("10:40")).toBe("10:40");
    expect(extractTime("no time")).toBeNull();
    expect(extractMatchNumber("Fight 27")).toBe("27");
    expect(extractMatchNumber("Match no. 3")).toBe("3");
    expect(extractMatchNumber("#12")).toBe("12");
    expect(extractMatchNumber("Mat 3")).toBeNull();
    expect(extractStatus("In progress")).toBe("on_mat");
    expect(extractStatus("in_progress")).toBe("on_mat");
    expect(extractStatus("Won by submission")).toBe("complete");
    expect(extractStatus("Running late")).toBe("delayed");
    expect(extractStatus("Scheduled")).toBe("scheduled");
  });

  it("extractOpponent picks the side that is not the athlete", () => {
    expect(extractOpponent("Mat 3 10:40 Hamad Al Rumaihi vs João Silva", "Hamad Al Rumaihi")).toEqual({ athlete: "Hamad Al Rumaihi", opponent: "João Silva" });
    expect(extractOpponent("Marco Rossi vs Hamad Al Rumaihi Scheduled", "Hamad Al Rumaihi")).toEqual({ athlete: "Hamad Al Rumaihi", opponent: "Marco Rossi" });
    expect(extractOpponent("Marco Rossi x Khalid Noor", null)).toEqual({ athlete: "Marco Rossi", opponent: "Khalid Noor" });
    expect(extractOpponent("no pairing here", "Hamad")).toEqual({ athlete: null, opponent: null });
  });

  it("normalizeName / mentionsAthlete ignore accents, punctuation and case", () => {
    expect(normalizeName("  João  Al-Rumaihi! ")).toBe("joao al rumaihi");
    expect(mentionsAthlete("12 | Mat 3 | HAMAD AL-RUMAIHI", "Hamad Al Rumaihi")).toBe(true);
    expect(mentionsAthlete("Hamad Khalid Al Rumaihi", "Hamad Al Rumaihi")).toBe(true); // all tokens present
    expect(mentionsAthlete("Hamad Noor", "Hamad Al Rumaihi")).toBe(false);
    expect(mentionsAthlete("anything", null)).toBe(false);
    expect(mentionsAthlete("anything", "")).toBe(false);
  });

  it("dedupe keys on external id, else number|mat|time|opponent", () => {
    const a = normalized({ externalMatchId: "1" });
    const b = normalized({ externalMatchId: "1", mat: "Mat 9" });
    const c = normalized({ matchNumber: "12" });
    const d = normalized({ matchNumber: "12", opponent: "JOÃO SILVA" });
    const e = normalized({ matchNumber: "13" });
    expect(dedupe([a, b, c, d, e])).toEqual([a, c, e]);
  });

  it("filterForAthlete keeps matching rows and reports whether it filtered", () => {
    const ctx = watchContext({ athleteName: "Hamad Al Rumaihi" });
    const mine = normalized({ athlete: "Hamad Al-Rumaihi", raw: {} });
    const viaText = normalized({ athlete: null, raw: { text: "27 | Mat 1 | Marco Rossi | Hamad Al-Rumaihi" } });
    const viaRaw = normalized({ athlete: null, raw: { blue: "Hamad Al-Rumaihi" } });
    const other = normalized({ athlete: "Marco Rossi", opponent: "Khalid Noor", raw: { text: "Marco Rossi vs Khalid Noor" } });
    expect(filterForAthlete([other, mine, viaText, viaRaw], ctx)).toEqual({ matches: [mine, viaText, viaRaw], filtered: true, named: true });
    expect(filterForAthlete([other], ctx)).toEqual({ matches: [other], filtered: false, named: true });
    expect(filterForAthlete([other], watchContext({ athleteName: null }))).toEqual({ matches: [other], filtered: false, named: true });
  });

  it("sortMatches orders by explicit order, then match number, then time", () => {
    const byOrder2 = normalized({ matchOrder: 2, matchNumber: "1" });
    const byOrder1 = normalized({ matchOrder: 1, matchNumber: "99" });
    const num5 = normalized({ matchNumber: "5", scheduledAt: "2026-03-14T12:00:00.000Z" });
    const num12 = normalized({ matchNumber: "12", scheduledAt: "2026-03-14T06:00:00.000Z" });
    const early = normalized({ scheduledAt: "2026-03-14T06:00:00.000Z" });
    const late = normalized({ scheduledAt: "2026-03-14T09:00:00.000Z" });
    const none = normalized({ scheduledAt: null });
    const sorted = sortMatches([none, late, num12, byOrder2, early, num5, byOrder1]);
    expect(sorted).toEqual([byOrder1, byOrder2, num5, num12, none, early, late]);
  });
});

describe("athlete identification (Phase 1-A)", () => {
  const ARABIC = "أحمد الرميحي";

  it("normalizeName unifies Latin accents, punctuation and Arabic letter variants without emptying Arabic", () => {
    expect(normalizeName("  João  Al-Rumaihi! ")).toBe("joao al rumaihi");
    // Arabic keeps a non-empty key (ASCII-only filters would collapse it to "").
    expect(normalizeName(ARABIC)).not.toBe("");
    // tatweel, harakat and alef/yeh variants normalize to the same key.
    expect(normalizeName("أحمد الرُّمَيحي")).toBe(normalizeName("احمد الرميحي"));
    expect(normalizeName("اَحمد الرميحى")).toBe(normalizeName("أحمد الرميحي"));
  });

  it("matches an Arabic athlete across diacritic/alef variants but not an unrelated Arabic name", () => {
    expect(mentionsAthlete("أحمد الرُّمَيحي", ARABIC)).toBe(true);
    expect(mentionsAthlete("احمد الرميحى", ARABIC)).toBe(true);
    expect(mentionsAthlete("خالد نور", ARABIC)).toBe(false);
  });

  it("finds the Arabic athlete's row in an Arabic bracket and reports OK", () => {
    const result = ajpAdapter.parse(fixture("ajp-arabic-bracket"), watchContext({ athleteName: ARABIC, eventDate: "2026-03-14" }));
    expect(result.status).toBe("OK");
    expect(result.code).toBe("MATCHES_FOUND");
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]).toMatchObject({ mat: "Mat 3", opponent: "جواو سيلفا" });
  });

  it("returns ATHLETE_NOT_FOUND (not another athlete's row) for an unrelated SMALL bracket", () => {
    const result = ajpAdapter.parse(fixture("ajp-unrelated-small"), watchContext({ athleteName: "Hamad Al-Rumaihi", eventDate: "2026-03-14" }));
    expect(result.status).toBe("ATHLETE_NOT_FOUND");
    expect(result.code).toBe("ATHLETE_NOT_FOUND");
    expect(result.matches).toEqual([]);
  });

  it("returns ATHLETE_NOT_FOUND when an Arabic bracket does not name the athlete", () => {
    const result = ajpAdapter.parse(fixture("ajp-arabic-bracket"), watchContext({ athleteName: "سعيد المنصوري", eventDate: "2026-03-14" }));
    expect(result.status).toBe("ATHLETE_NOT_FOUND");
  });

  it("does not confuse two athletes who share given-name tokens (ambiguous common names)", () => {
    // The page names Ali Hassan; tracking a different Ali must not match him.
    const result = ajpAdapter.parse(fixture("ajp-bracket-table"), watchContext({ athleteName: "Ali Khan" }));
    expect(result.status).toBe("ATHLETE_NOT_FOUND");
  });
});
