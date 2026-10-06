import { describe, expect, it } from "vitest";
import { canTransitionDocument, DOCUMENT_STATUSES, DOCUMENT_TRANSITIONS, isAcceptableSignerName, isSignable, MERGE_FIELDS, renderTemplate, templateFields } from "@/lib/documents/state";
import { DEFAULT_TEMPLATES, DRAFT_NOTICE } from "@/lib/documents/templates";
import { mergeValuesFor } from "@/lib/documents/merge";
import { bodyHash, normalizeBody } from "@/lib/documents/hash";

const NOW = new Date("2026-10-06T09:00:00.000Z");

describe("document transitions", () => {
  it("follows draft → sent → viewed → signed and closes on signed/declined/expired", () => {
    expect(canTransitionDocument("draft", "sent")).toBe(true);
    expect(canTransitionDocument("sent", "viewed")).toBe(true);
    expect(canTransitionDocument("sent", "signed")).toBe(true);
    expect(canTransitionDocument("viewed", "signed")).toBe(true);
    expect(canTransitionDocument("viewed", "declined")).toBe(true);
    expect(canTransitionDocument("viewed", "expired")).toBe(true);
    expect(canTransitionDocument("draft", "signed")).toBe(false);
    expect(canTransitionDocument("signed", "draft")).toBe(false);
    for (const terminal of ["signed", "declined", "expired"] as const) {
      for (const to of DOCUMENT_STATUSES) expect(canTransitionDocument(terminal, to)).toBe(false);
    }
    expect(Object.keys(DOCUMENT_TRANSITIONS).sort()).toEqual([...DOCUMENT_STATUSES].sort());
  });
});

describe("isSignable", () => {
  it("allows sent/viewed before expiry only", () => {
    expect(isSignable({ status: "sent", expires_at: "2026-10-07T00:00:00.000Z" }, NOW)).toBe(true);
    expect(isSignable({ status: "viewed", expires_at: null }, NOW)).toBe(true);
    expect(isSignable({ status: "sent", expires_at: "2026-10-06T09:00:00.000Z" }, NOW)).toBe(false);
    expect(isSignable({ status: "sent", expires_at: "2026-10-01T00:00:00.000Z" }, NOW)).toBe(false);
    expect(isSignable({ status: "draft", expires_at: null }, NOW)).toBe(false);
    expect(isSignable({ status: "signed", expires_at: null }, NOW)).toBe(false);
    expect(isSignable({ status: "declined", expires_at: null }, NOW)).toBe(false);
    expect(isSignable({ status: "expired", expires_at: null }, NOW)).toBe(false);
  });
});

describe("renderTemplate / templateFields", () => {
  it("fills known fields, blanks empty or unknown ones, tolerates spaces inside braces", () => {
    const body = "Dear {{client_name}}, fee {{ amount }} for {{event_name}} ({{nope}}).";
    expect(renderTemplate(body, { client_name: "Sara", amount: "500 QAR", event_name: "  " })).toBe("Dear Sara, fee 500 QAR for ________ (________).");
  });

  it("lists each referenced merge field once and ignores unknown names", () => {
    expect(templateFields("{{client_name}} {{client_name}} {{amount}} {{bogus}}")).toEqual(["client_name", "amount"]);
    expect(templateFields("no fields")).toEqual([]);
  });

  it("every starter template carries the draft notice, uses only known fields and stays under ~700 words", () => {
    expect(DEFAULT_TEMPLATES).toHaveLength(6);
    for (const t of DEFAULT_TEMPLATES) {
      expect(t.body.startsWith(DRAFT_NOTICE)).toBe(true);
      const used = templateFields(t.body);
      expect(used.length).toBeGreaterThan(0);
      const raw = [...t.body.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)].map((m) => m[1]);
      for (const f of raw) expect(MERGE_FIELDS as readonly string[]).toContain(f);
      expect(t.body.split(/\s+/).length).toBeLessThan(760);
      expect(t.body).toMatch(/State of Qatar/);
      expect(t.body).toMatch(/Law No\. 16 of 2010/);
      expect(t.body).toMatch(/intended to be/);
      expect(t.body).toMatch(/parent or legal guardian/);
      if (t.kind.endsWith("_agreement")) expect(t.body).toMatch(/Pic-Time/);
    }
  });
});

describe("isAcceptableSignerName", () => {
  it("needs at least three characters including a letter, not just symbols", () => {
    expect(isAcceptableSignerName("Ahmed Al-Thani")).toBe(true);
    expect(isAcceptableSignerName("  محمد  ")).toBe(true);
    expect(isAcceptableSignerName("Li")).toBe(false);
    expect(isAcceptableSignerName("___")).toBe(false);
    expect(isAcceptableSignerName("123")).toBe(false);
    expect(isAcceptableSignerName("x".repeat(121))).toBe(false);
  });
});

describe("mergeValuesFor", () => {
  it("prefers the CRM person over booking contact fields, formats dates in Qatar time and money in QAR", () => {
    const values = mergeValuesFor({
      booking: { athlete_name: "Yousef", customer_name: "Parent", customer_email: "p@x.com", customer_phone: "+97450000000", package_name: "Gold", amount_qr: 1200, session_at: "2026-10-10T13:30:00.000Z", location: "Lusail Sports Arena", public_ref: "BB-7K3PQ2", academy: "Doha BJJ" },
      person: { full_name: "Sara Khan", email: "sara@x.com", phone: null },
      service: { name: "Tournament coverage", price_qr: 1000, deposit_qr: 300 },
      event: { name: "Doha Open", event_date: "2026-10-11", venue: "Lusail" },
      studio: { business_name: "Blue Belt Media" },
      now: NOW,
    });
    expect(values.client_name).toBe("Sara Khan");
    expect(values.client_email).toBe("sara@x.com");
    expect(values.client_phone).toBe("+97450000000");
    expect(values.athlete_name).toBe("Yousef");
    expect(values.organization_name).toBe("Doha BJJ");
    expect(values.service_name).toBe("Tournament coverage");
    expect(values.amount).toBe("1,200 QAR");
    expect(values.deposit).toBe("300 QAR");
    expect(values.booking_ref).toBe("BB-7K3PQ2");
    expect(values.event_date).toBe("Sunday, 11 October 2026");
    expect(values.session_date).toBe("Saturday, 10 October 2026, 16:30");
    expect(values.today).toBe("Tuesday, 6 October 2026");
    expect(values.location).toBe("Lusail Sports Arena");
  });

  it("leaves unknown values undefined so the document shows a blank", () => {
    const values = mergeValuesFor({ now: NOW });
    expect(values.client_name).toBeUndefined();
    expect(values.amount).toBeUndefined();
    expect(values.business_name).toBe("Blue Belt Media");
    expect(renderTemplate("{{client_name}}|{{today}}", values)).toBe("________|Tuesday, 6 October 2026");
  });
});

describe("bodyHash", () => {
  it("is stable across CRLF and trailing whitespace but sensitive to content", () => {
    expect(normalizeBody("a\r\nb  \n\n")).toBe("a\nb");
    expect(bodyHash("a\r\nb\n")).toBe(bodyHash("a\nb"));
    expect(bodyHash("a\nb")).toMatch(/^[0-9a-f]{64}$/);
    expect(bodyHash("a\nb")).not.toBe(bodyHash("a\nc"));
  });
});
