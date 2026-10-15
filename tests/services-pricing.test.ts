import { describe, expect, it } from "vitest";
import { bookableAmount, priceLineFor, publicPrice } from "@/lib/services/pricing";
import type { PhotoServiceRow } from "@/lib/supabase/database.types";

const svc = (over: Partial<PhotoServiceRow>): PhotoServiceRow => ({ id: "s", owner_id: "o", code: "c", name: "n", booking_type: "tournament_athlete", description: null, price_qr: null, price_mode: "quote", deposit_qr: null, currency: "QAR", duration_minutes: null, includes_photo: true, includes_video: false, active: true, public: true, sort_order: 0, created_at: "", updated_at: "", ...over });

describe("publicPrice", () => {
  it("reads fixed, from and quote, and never shows a price of zero or a price for a quote", () => {
    expect(publicPrice(svc({ price_mode: "fixed", price_qr: 350 }))).toMatchObject({ mode: "fixed", amount: 350, label: "350 QAR" });
    expect(publicPrice(svc({ price_mode: "from", price_qr: 350 }))).toMatchObject({ mode: "from", amount: 350, label: "from 350 QAR" });
    expect(publicPrice(svc({ price_mode: "quote", price_qr: 350 }))).toMatchObject({ mode: "quote", amount: null, label: "Quote on request" });
    expect(publicPrice(svc({ price_mode: "fixed", price_qr: 0 })).mode).toBe("quote");
    expect(publicPrice(svc({ price_mode: "from", price_qr: null })).mode).toBe("quote");
  });

  it("summarises a type: the lowest price as 'from', a single fixed price as is, otherwise a quote", () => {
    expect(priceLineFor([svc({ price_mode: "from", price_qr: 450 }), svc({ price_mode: "fixed", price_qr: 350 })])).toBe("from 350 QAR");
    expect(priceLineFor([svc({ price_mode: "fixed", price_qr: 350 })])).toBe("350 QAR");
    expect(priceLineFor([svc({ price_mode: "quote", price_qr: 900 })])).toBe("Quote on request");
    expect(priceLineFor([])).toBe("Quote on request");
  });
});

describe("bookableAmount (issue #10)", () => {
  it("quote mode books as a quote even when the row carries a price", () => {
    expect(bookableAmount(svc({ price_mode: "quote", price_qr: 350 }))).toEqual({ quoteOnly: true, amountQr: 0, paymentMode: "quote", priceMode: "quote" });
    expect(publicPrice(svc({ price_mode: "quote", price_qr: 350 })).label).toBe("Quote on request");
  });
  it("'from' and 'fixed' book at the price with a payment link later; a missing or zero price is a quote", () => {
    expect(bookableAmount(svc({ price_mode: "from", price_qr: 350 }))).toEqual({ quoteOnly: false, amountQr: 350, paymentMode: "link_later", priceMode: "from" });
    expect(bookableAmount(svc({ price_mode: "fixed", price_qr: 600 }))).toEqual({ quoteOnly: false, amountQr: 600, paymentMode: "link_later", priceMode: "fixed" });
    expect(bookableAmount(svc({ price_mode: "from", price_qr: null })).quoteOnly).toBe(true);
    expect(bookableAmount(svc({ price_mode: "fixed", price_qr: 0 })).quoteOnly).toBe(true);
  });
  it("no package, or a quote-first catalog service, is always a quote", () => {
    expect(bookableAmount(null)).toMatchObject({ quoteOnly: true, amountQr: 0, paymentMode: "quote" });
    expect(bookableAmount(undefined)).toMatchObject({ quoteOnly: true });
    expect(bookableAmount(svc({ price_mode: "fixed", price_qr: 1200 }), { quoteFirst: true })).toEqual({ quoteOnly: true, amountQr: 0, paymentMode: "quote", priceMode: "quote" });
    expect(bookableAmount(svc({ price_mode: "fixed", price_qr: 1200 }), { quoteFirst: false }).amountQr).toBe(1200);
  });
});
