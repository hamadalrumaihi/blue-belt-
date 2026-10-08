import { describe, expect, it } from "vitest";
import { businessIdentity, businessLegalLine, DEFAULT_BUSINESS_IDENTITY, formatPhone, phoneDigits, whatsappUrl } from "@/lib/studio/business";

describe("businessIdentity", () => {
  it("falls back to the registered defaults when the variables are unset or blank", () => {
    expect(businessIdentity({})).toEqual(DEFAULT_BUSINESS_IDENTITY);
    expect(businessIdentity({ BUSINESS_LEGAL_NAME: "  ", BUSINESS_CR_NUMBER: "" })).toEqual(DEFAULT_BUSINESS_IDENTITY);
    expect(DEFAULT_BUSINESS_IDENTITY).toEqual({ legalName: "Blue belt media photography", crNumber: "235175", location: "Doha, Qatar", email: "bluebeltmediaqatar@gmail.com", phone: null });
  });

  it("reads and trims every BUSINESS_* variable", () => {
    const id = businessIdentity({ BUSINESS_LEGAL_NAME: " Other Name ", BUSINESS_CR_NUMBER: "1", BUSINESS_PUBLIC_LOCATION: "Al Wakrah, Qatar", BUSINESS_CONTACT_EMAIL: "x@y.qa", BUSINESS_CONTACT_PHONE: "+974 1234 5678" });
    expect(id).toEqual({ legalName: "Other Name", crNumber: "1", location: "Al Wakrah, Qatar", email: "x@y.qa", phone: "+974 1234 5678" });
  });

  it("builds the public legal line without any address", () => {
    expect(businessLegalLine(DEFAULT_BUSINESS_IDENTITY)).toBe("Blue belt media photography, CR 235175, Doha, Qatar");
    expect(businessLegalLine(DEFAULT_BUSINESS_IDENTITY)).not.toMatch(/street|building|box/i);
  });

  it("has no phone number unless BUSINESS_CONTACT_PHONE is set, and never links to one", () => {
    expect(businessIdentity({}).phone).toBeNull();
    expect(businessIdentity({ BUSINESS_CONTACT_PHONE: "  " }).phone).toBeNull();
    expect(formatPhone(null)).toBeNull();
    expect(whatsappUrl(null)).toBeNull();
    expect(whatsappUrl("")).toBeNull();
    expect(phoneDigits("123")).toBeNull();
  });

  it("formats a number only when one is configured", () => {
    expect(phoneDigits("55551234")).toBe("97455551234");
    expect(phoneDigits("+974 5555 1234")).toBe("97455551234");
    expect(phoneDigits("0097455551234")).toBe("97455551234");
    expect(formatPhone("55551234")).toBe("+974 55551234");
    expect(formatPhone("+44 20 1234 5678")).toBe("+442012345678");
    expect(whatsappUrl("55551234")).toBe("https://wa.me/97455551234");
  });
});
