import { describe, expect, it } from "vitest";
import { businessIdentity, businessLegalLine, DEFAULT_BUSINESS_IDENTITY, formatPhone, phoneDigits, whatsappUrl } from "@/lib/studio/business";

describe("businessIdentity", () => {
  it("falls back to the registered defaults when the variables are unset or blank", () => {
    expect(businessIdentity({})).toEqual(DEFAULT_BUSINESS_IDENTITY);
    expect(businessIdentity({ BUSINESS_LEGAL_NAME: "  ", BUSINESS_CR_NUMBER: "" })).toEqual(DEFAULT_BUSINESS_IDENTITY);
    expect(DEFAULT_BUSINESS_IDENTITY).toEqual({ legalName: "Blue belt media photography", crNumber: "235175", location: "Doha, Qatar", email: "bluebeltmediaqatar@gmail.com", phone: "30200312" });
  });

  it("reads and trims every BUSINESS_* variable", () => {
    const id = businessIdentity({ BUSINESS_LEGAL_NAME: " Other Name ", BUSINESS_CR_NUMBER: "1", BUSINESS_PUBLIC_LOCATION: "Al Wakrah, Qatar", BUSINESS_CONTACT_EMAIL: "x@y.qa", BUSINESS_CONTACT_PHONE: "+974 1234 5678" });
    expect(id).toEqual({ legalName: "Other Name", crNumber: "1", location: "Al Wakrah, Qatar", email: "x@y.qa", phone: "+974 1234 5678" });
  });

  it("builds the public legal line without any address", () => {
    expect(businessLegalLine(DEFAULT_BUSINESS_IDENTITY)).toBe("Blue belt media photography, CR 235175, Doha, Qatar");
    expect(businessLegalLine(DEFAULT_BUSINESS_IDENTITY)).not.toMatch(/street|building|box/i);
  });

  it("formats phone numbers for links and display", () => {
    expect(phoneDigits("30200312")).toBe("97430200312");
    expect(phoneDigits("+974 3020 0312")).toBe("97430200312");
    expect(phoneDigits("0097430200312")).toBe("97430200312");
    expect(formatPhone("30200312")).toBe("+974 30200312");
    expect(formatPhone("+44 20 1234 5678")).toBe("+442012345678");
    expect(whatsappUrl("30200312")).toBe("https://wa.me/97430200312");
  });
});
