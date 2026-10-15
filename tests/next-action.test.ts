import { describe, expect, it } from "vitest";
import { followUpDraft, nextActionFor, sortByDue } from "@/lib/studio/next-action";
import { booking } from "./payments/fixtures";

const NOW = new Date("2026-10-10T08:00:00.000Z");

describe("nextActionFor", () => {
  it("returns nothing for a completed booking and a muted note for a cancelled one", () => {
    expect(nextActionFor(booking({ booking_status: "completed" }), { now: NOW })).toBeNull();
    expect(nextActionFor(booking({ booking_status: "cancelled" }), { now: NOW })).toMatchObject({ code: "cancelled", tone: "muted", draft: null });
  });

  it("inquiry → review request / assess price, due a day after it came in, pointing at pricing when unpriced", () => {
    const a = nextActionFor(booking({ booking_status: "inquiry", amount_qr: 0, created_at: "2026-10-09T10:00:00.000Z" }), { now: NOW })!;
    expect(a).toMatchObject({ code: "review_request", label: "Review request / assess price", href: `/pricing/quote?booking=${booking().id}`, due: "2026-10-10T10:00:00.000Z", overdue: false, tone: "warning", draft: null });
    const priced = nextActionFor(booking({ booking_status: "inquiry", amount_qr: 500 }), { now: NOW })!;
    expect(priced.href).toBe(`/bookings/${booking().id}`);
    expect(priced.overdue).toBe(true);
    expect(priced.tone).toBe("danger");
  });

  it("quoted → follow up quote three days after quoting, with a copyable draft", () => {
    const a = nextActionFor(booking({ booking_status: "quoted", quoted_at: "2026-10-09T00:00:00.000Z" }), { now: NOW })!;
    expect(a).toMatchObject({ code: "follow_up_quote", label: "Follow up quote", due: "2026-10-12T00:00:00.000Z", overdue: false, tone: "warning" });
    expect(a.draft?.body).toContain("350 QAR");
    expect(a.draft?.body).toContain("Hi Test");
    expect(a.draft?.body).toMatch(/only becomes a booking once/);
    expect(nextActionFor(booking({ booking_status: "quoted", quoted_at: null }), { now: NOW })!.due).toBeUndefined();
  });

  it("awaiting_contract → send, then chase three days after sending", () => {
    const send = nextActionFor(booking({ booking_status: "awaiting_contract", contract_state: "required" }), { now: NOW })!;
    expect(send).toMatchObject({ code: "send_agreement", draft: null, href: `/bookings/${booking().id}#contract` });
    const chase = nextActionFor(booking({ booking_status: "awaiting_contract", contract_state: "sent" }), { now: NOW, documents: [{ status: "sent", sent_at: "2026-10-05T00:00:00.000Z", required_for_confirmation: true }] })!;
    expect(chase).toMatchObject({ code: "chase_agreement", label: "Chase agreement signature", due: "2026-10-08T00:00:00.000Z", overdue: true, tone: "danger" });
    expect(chase.draft?.subject).toContain("Agreement");
  });

  it("awaiting_payment → chase the deposit (request link first when none is pending)", () => {
    const none = nextActionFor(booking({ booking_status: "awaiting_payment" }), { now: NOW })!;
    expect(none).toMatchObject({ code: "request_deposit", tone: "warning" });
    expect(none.draft?.body).toContain("175 QAR");
    const pending = nextActionFor(booking({ booking_status: "awaiting_payment" }), { now: NOW, paymentRequests: [{ stage: "deposit", status: "pending", created_at: "2026-10-09T00:00:00.000Z" }] })!;
    expect(pending).toMatchObject({ code: "chase_deposit", label: "Chase deposit", due: "2026-10-12T00:00:00.000Z" });
    expect(pending.draft?.body).toMatch(/date is not reserved/);
  });

  it("confirmed → prepare the brief two days before the session; after the date, mark the shoot complete", () => {
    const a = nextActionFor(booking({ booking_status: "confirmed", session_at: "2026-10-20T07:00:00.000Z" }), { now: NOW })!;
    expect(a).toMatchObject({ code: "prepare_brief", label: "Prepare shoot brief", href: `/bookings/${booking().id}/brief`, due: "2026-10-18T07:00:00.000Z", draft: null, tone: "info" });
    const late = nextActionFor(booking({ booking_status: "confirmed", session_at: "2026-10-01T07:00:00.000Z" }), { now: NOW })!;
    expect(late).toMatchObject({ code: "mark_shoot_complete", overdue: true });
    expect(nextActionFor(booking({ booking_status: "confirmed", session_at: null }), { now: NOW })!.due).toBeUndefined();
  });

  it("in_progress → culling / editing on the production board, or deliver once the gallery is ready", () => {
    expect(nextActionFor(booking({ booking_status: "in_progress" }), { now: NOW })).toMatchObject({ code: "culling_editing", label: "Culling / editing", href: "/production", draft: null });
    expect(nextActionFor(booking({ booking_status: "in_progress" }), { now: NOW, gallery: { status: "ready", pictime_url: "https://x.pic-time.com/g" } })).toMatchObject({ code: "deliver_gallery", tone: "success" });
    expect(nextActionFor(booking({ booking_status: "in_progress" }), { now: NOW, gallery: { status: "ready", pictime_url: null } })).toMatchObject({ code: "culling_editing" });
  });

  it("delivered → chase the balance while due, else ask for a review; both a week after delivery", () => {
    const due = nextActionFor(booking({ booking_status: "delivered", balance_state: "due", balance_qr: 175, gallery_delivered_at: "2026-10-08T00:00:00.000Z" }), { now: NOW })!;
    expect(due).toMatchObject({ code: "chase_balance", label: "Request the final balance", due: "2026-10-15T00:00:00.000Z" });
    expect(due.draft?.body).toContain("175 QAR");
    const pending = nextActionFor(booking({ booking_status: "delivered", balance_state: "due", balance_qr: 175 }), { now: NOW, paymentRequests: [{ stage: "balance", status: "pending" }] })!;
    expect(pending.label).toBe("Chase final balance");
    const paid = nextActionFor(booking({ booking_status: "delivered", balance_state: "paid", delivered_at: "2026-10-01T00:00:00.000Z" }), { now: NOW })!;
    expect(paid).toMatchObject({ code: "request_review", due: "2026-10-08T00:00:00.000Z", overdue: true });
    expect(paid.draft?.body).toMatch(/permission/);
  });

  it("drafts are plain English with no vendor names and never claim anything was sent", () => {
    for (const kind of ["follow_up_quote", "chase_agreement", "chase_deposit", "chase_balance", "request_review"] as const) {
      const d = followUpDraft(booking({ public_ref: "BB-TEST01" }), kind);
      expect(d.body).toContain("BB-TEST01");
      expect(d.body).not.toMatch(/myfatoorah|pic-?time|docusign/i);
      expect(d.body.length).toBeLessThan(600);
    }
  });

  it("sortByDue puts the soonest first and undated last", () => {
    const rows = [
      { id: "c", action: null },
      { id: "b", action: nextActionFor(booking({ booking_status: "quoted", quoted_at: "2026-10-09T00:00:00.000Z" }), { now: NOW }) },
      { id: "a", action: nextActionFor(booking({ booking_status: "awaiting_contract", contract_state: "sent" }), { now: NOW, documents: [{ status: "sent", sent_at: "2026-10-01T00:00:00.000Z", required_for_confirmation: true }] }) },
    ];
    expect(sortByDue(rows).map((r) => r.id)).toEqual(["a", "b", "c"]);
  });
});
