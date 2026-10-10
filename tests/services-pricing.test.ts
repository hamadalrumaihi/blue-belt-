import { describe, expect, it } from "vitest";
import { priceLineFor, publicPrice } from "@/lib/services/pricing";
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
