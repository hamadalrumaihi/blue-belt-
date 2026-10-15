import { describe, expect, it } from "vitest";
import { DEFAULT_LOCALE, dirFor, htmlLangScript, isLocale, langSwitchHref, LOCALE_COOKIE, LOCALE_LABEL, LOCALE_QUERY, LOCALES, localized, otherLocale, pick, resolveLocale } from "@/lib/i18n/locale";
import { fill, tr, UI } from "@/lib/i18n/ui";

describe("locale", () => {
  it("knows two languages, English by default, with a cookie and a query parameter", () => {
    expect(LOCALES).toEqual(["en", "ar"]);
    expect(DEFAULT_LOCALE).toBe("en");
    expect(LOCALE_COOKIE).toBe("bbm_lang");
    expect(LOCALE_QUERY).toBe("lang");
    expect(isLocale("ar")).toBe(true);
    expect(isLocale("fr")).toBe(false);
    expect(isLocale(null)).toBe(false);
  });

  it("lets the query win over the cookie and falls back to English for anything unknown", () => {
    expect(resolveLocale("ar", "en")).toBe("ar");
    expect(resolveLocale(null, "ar")).toBe("ar");
    expect(resolveLocale("xx", "ar")).toBe("ar");
    expect(resolveLocale("xx", "yy")).toBe("en");
    expect(resolveLocale(undefined, undefined)).toBe("en");
  });

  it("maps direction and the other language", () => {
    expect(dirFor("en")).toBe("ltr");
    expect(dirFor("ar")).toBe("rtl");
    expect(otherLocale("en")).toBe("ar");
    expect(otherLocale("ar")).toBe("en");
    expect(LOCALE_LABEL.ar).toBe("العربية");
  });

  it("localises with an English fallback so a missing translation never blanks a page", () => {
    expect(localized({ en: "Work", ar: "أعمالنا" }, "ar")).toBe("أعمالنا");
    expect(localized({ en: "Work" }, "ar")).toBe("Work");
    expect(pick("en", { en: ["a"], ar: ["b"] })).toEqual(["a"]);
    const t = tr("ar");
    expect(t(UI.nav.work)).toBe("أعمالنا");
    expect(tr("en")(UI.nav.work)).toBe("Work");
  });

  it("builds a switch link that keeps the path and other parameters and sets lang", () => {
    expect(langSwitchHref("/services", "", "ar")).toBe("/services?lang=ar");
    expect(langSwitchHref("/book", "service=tournament_athlete&media=photo", "ar")).toBe("/book?service=tournament_athlete&media=photo&lang=ar");
    expect(langSwitchHref("/work", "lang=ar", "en")).toBe("/work?lang=en");
    expect(langSwitchHref("", null, "ar")).toBe("/?lang=ar");
  });

  it("emits a safe inline script for <html lang dir>", () => {
    expect(htmlLangScript("ar")).toContain('d.lang="ar"');
    expect(htmlLangScript("ar")).toContain('d.dir="rtl"');
    expect(htmlLangScript("en")).toContain('d.dir="ltr"');
    expect(htmlLangScript("en")).not.toContain("<");
  });

  it("fills placeholders", () => {
    expect(fill("Image {n} of {total}", { n: 2, total: 9 })).toBe("Image 2 of 9");
    expect(fill("{missing}", {})).toBe("{missing}");
  });
});
