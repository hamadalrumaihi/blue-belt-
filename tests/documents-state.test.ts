import { describe, expect, it } from "vitest";
import { canTransitionDocument, DOCUMENT_KIND_LABEL, DOCUMENT_STATUSES, DOCUMENT_TRANSITIONS, isAcceptableSignerName, isClosedDocumentStatus, isSignable, MERGE_FIELDS, renderTemplate, templateFields } from "@/lib/documents/state";
import { CORE_TEMPLATE_KINDS, DEFAULT_TEMPLATES, defaultTemplateFor, DRAFT_NOTICE, PLACEHOLDER_NOTICE } from "@/lib/documents/templates";
import { mergeValuesFor } from "@/lib/documents/merge";
import { bodyHash, normalizeBody } from "@/lib/documents/hash";

const NOW = new Date("2026-10-06T09:00:00.000Z");

describe("document transitions", () => {
  it("follows draft → sent → viewed → signed and closes on signed/declined/expired/void", () => {
    expect(canTransitionDocument("draft", "sent")).toBe(true);
    expect(canTransitionDocument("sent", "viewed")).toBe(true);
    expect(canTransitionDocument("sent", "signed")).toBe(true);
    expect(canTransitionDocument("viewed", "signed")).toBe(true);
    expect(canTransitionDocument("viewed", "declined")).toBe(true);
    expect(canTransitionDocument("viewed", "expired")).toBe(true);
    expect(canTransitionDocument("draft", "signed")).toBe(false);
    expect(canTransitionDocument("signed", "draft")).toBe(false);
    for (const terminal of ["signed", "declined", "expired", "void"] as const) {
      for (const to of DOCUMENT_STATUSES) expect(canTransitionDocument(terminal, to)).toBe(false);
      expect(isClosedDocumentStatus(terminal)).toBe(true);
    }
    expect(Object.keys(DOCUMENT_TRANSITIONS).sort()).toEqual([...DOCUMENT_STATUSES].sort());
  });

  it("allows void from draft, sent and viewed only", () => {
    expect(canTransitionDocument("draft", "void")).toBe(true);
    expect(canTransitionDocument("sent", "void")).toBe(true);
    expect(canTransitionDocument("viewed", "void")).toBe(true);
    expect(canTransitionDocument("signed", "void")).toBe(false);
    expect(canTransitionDocument("declined", "void")).toBe(false);
    expect(canTransitionDocument("expired", "void")).toBe(false);
    expect(isClosedDocumentStatus("sent")).toBe(false);
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
    expect(isSignable({ status: "void", expires_at: null }, NOW)).toBe(false);
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
});

describe("starter templates", () => {
  it("exist for the five core kinds with clear names, plus the legacy kinds", () => {
    expect(DEFAULT_TEMPLATES).toHaveLength(7);
    const kinds = DEFAULT_TEMPLATES.map((t) => t.kind);
    for (const kind of CORE_TEMPLATE_KINDS) expect(kinds).toContain(kind);
    expect(new Set(kinds).size).toBe(kinds.length);
    expect(defaultTemplateFor("services_agreement")?.name).toBe("Photography Services Agreement");
    expect(defaultTemplateFor("event_agreement")?.name).toBe("Combat Sport Event Photography Services Agreement");
    expect(defaultTemplateFor("session_agreement")?.name).toBe("Fighter Portrait Session Agreement");
    expect(defaultTemplateFor("print_release")?.name).toBe("Print Release");
    expect(defaultTemplateFor("guardian_release")?.name).toBe("Minor / Guardian Release");
    expect(defaultTemplateFor("model_release")).not.toBeNull();
    expect(DOCUMENT_KIND_LABEL.session_agreement).toBe("Fighter Portrait Session Agreement");
    expect(DOCUMENT_KIND_LABEL.guardian_release).toBe("Minor / Guardian Release");
  });

  it("every starter template carries the draft notice, uses only known fields, names no vendor and has no em dash", () => {
    for (const t of DEFAULT_TEMPLATES) {
      expect(t.body.startsWith(DRAFT_NOTICE)).toBe(true);
      const used = templateFields(t.body);
      expect(used.length).toBeGreaterThan(0);
      const raw = [...t.body.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)].map((m) => m[1]);
      for (const f of raw) expect(MERGE_FIELDS as readonly string[]).toContain(f);
      expect(t.body.split(/\s+/).length).toBeLessThan(1100);
      expect(t.body).toMatch(/State of Qatar/);
      expect(t.body).toMatch(/Law No\. 16 of 2010/);
      expect(t.body).toMatch(/intended to be/);
      expect(t.body).toMatch(/parent or legal guardian/);
      expect(t.body).not.toContain("—");
      expect(t.body.toLowerCase()).not.toMatch(/pic-?time|fatoorah|docusign/);
      expect(t.name).not.toContain("—");
    }
  });

  it("agreements state the 50/50 deposit policy, the cancellation tiers, consumer law and generic vendors", () => {
    for (const t of DEFAULT_TEMPLATES.filter((x) => x.kind.endsWith("_agreement"))) {
      expect(t.body).toMatch(/50% of the fee \(\{\{deposit\}\}\) is due before the booking is confirmed/);
      expect(t.body).toMatch(/confirmed only when this agreement is signed and the deposit has been received/);
      expect(t.body).toMatch(/remaining 50% \(\{\{balance\}\}\) is due after delivery/);
      expect(t.body).toMatch(/nothing is charged automatically/);
      expect(t.body).toMatch(/payment provider/);
      expect(t.body).toMatch(/gallery hosting provider/);
      expect(t.body).toMatch(/electronic signature provider/);
      expect(t.body).toMatch(/7 days or more before the date: the deposit may be moved once to a new date, subject to availability/);
      expect(t.body).toMatch(/3 to 6 days before the date: the deposit is retained/);
      expect(t.body).toMatch(/Under 72 hours before the date, or no-show: the full agreed amount is due/);
      expect(t.body).toMatch(/cancelled or postponed by the organiser: the Studio offers a new date or a credit first/);
      expect(t.body).toMatch(/Refunds are made where legally required or where agreed/);
      expect(t.body).toMatch(/mandatory consumer protection law of the State of Qatar/);
      expect(t.body).toContain(PLACEHOLDER_NOTICE);
      expect(t.body).not.toMatch(/released once the full fee/);
    }
  });

  it("the guardian release is addressed to the guardian, never signed by the athlete, and is marked as a placeholder", () => {
    const t = defaultTemplateFor("guardian_release")!;
    expect(t.body).toContain(PLACEHOLDER_NOTICE);
    expect(templateFields(t.body)).toContain("guardian_name");
    expect(templateFields(t.body)).toContain("athlete_name");
    expect(t.body).toMatch(/signed by the Guardian, not by the Athlete/);
    expect(t.body).toMatch(/Signed by the parent or legal guardian/);
    expect(t.body).toMatch(/Parent or legal guardian of: \{\{athlete_name\}\}/);
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
      booking: { athlete_name: "Yousef", customer_name: "Parent", customer_email: "p@x.com", customer_phone: "+97450000000", package_name: "Gold", amount_qr: 1200, deposit_qr: 600, balance_qr: 600, session_at: "2026-10-10T13:30:00.000Z", location: "Lusail Sports Arena", public_ref: "BB-7K3PQ2", academy: "Doha BJJ" },
      person: { full_name: "Sara Khan", email: "sara@x.com", phone: null },
      service: { name: "Tournament coverage", price_qr: 1000, deposit_qr: 300 },
      event: { name: "Doha Open", event_date: "2026-10-11", venue: "Lusail" },
      studio: { business_name: "Blue Belt Media" },
      guardian: { name: "Sara Khan" },
      now: NOW,
    });
    expect(values.client_name).toBe("Sara Khan");
    expect(values.client_email).toBe("sara@x.com");
    expect(values.client_phone).toBe("+97450000000");
    expect(values.athlete_name).toBe("Yousef");
    expect(values.guardian_name).toBe("Sara Khan");
    expect(values.organization_name).toBe("Doha BJJ");
    expect(values.service_name).toBe("Tournament coverage");
    expect(values.amount).toBe("1,200 QAR");
    // The booking's server-computed 50% split wins over the service's deposit.
    expect(values.deposit).toBe("600 QAR");
    expect(values.balance).toBe("600 QAR");
    expect(values.booking_ref).toBe("BB-7K3PQ2");
    expect(values.event_date).toBe("Sunday, 11 October 2026");
    expect(values.session_date).toBe("Saturday, 10 October 2026, 16:30");
    expect(values.today).toBe("Tuesday, 6 October 2026");
    expect(values.location).toBe("Lusail Sports Arena");
  });

  it("falls back to the service deposit when the booking has no split yet, and leaves unknown values undefined", () => {
    const values = mergeValuesFor({ now: NOW, service: { name: "S", price_qr: 1000, deposit_qr: 300 } });
    expect(values.client_name).toBeUndefined();
    expect(values.guardian_name).toBeUndefined();
    expect(values.deposit).toBe("300 QAR");
    expect(values.balance).toBeUndefined();
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
