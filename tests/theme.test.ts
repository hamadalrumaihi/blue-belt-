import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { DARK_MEDIA_QUERY, nextThemePreference, readStoredTheme, resolveTheme, THEME_INIT_SCRIPT, THEME_PREFERENCES, THEME_STORAGE_KEY } from "@/lib/theme";

describe("resolveTheme", () => {
  it("honours an explicit choice regardless of the device", () => {
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(resolveTheme("dark", true)).toBe("dark");
    expect(resolveTheme("light", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
  });

  it("follows the device for system", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });
});

describe("readStoredTheme", () => {
  it("accepts only light and dark", () => {
    expect(readStoredTheme("light")).toBe("light");
    expect(readStoredTheme("dark")).toBe("dark");
  });

  it("maps anything else to system", () => {
    for (const junk of [null, undefined, "", "system", "DARK", "auto", 0, 1, true, {}, [], "dark ", "\"dark\""]) {
      expect(readStoredTheme(junk)).toBe("system");
    }
  });
});

describe("nextThemePreference", () => {
  it("cycles System -> Light -> Dark -> System", () => {
    expect(nextThemePreference("system")).toBe("light");
    expect(nextThemePreference("light")).toBe("dark");
    expect(nextThemePreference("dark")).toBe("system");
    expect(THEME_PREFERENCES).toEqual(["system", "light", "dark"]);
  });
});

/** Runs the pre-paint script in a sandbox with a fake window, localStorage and matchMedia. */
function runInitScript(opts: { stored?: unknown; systemDark?: boolean; storageThrows?: boolean; noMatchMedia?: boolean }) {
  const html = { dataset: {} as Record<string, string>, style: {} as Record<string, string> };
  const localStorage = {
    getItem(key: string) {
      if (opts.storageThrows) throw new Error("SecurityError");
      return key === THEME_STORAGE_KEY ? (opts.stored as string | null) ?? null : null;
    },
  };
  const matchMedia = opts.noMatchMedia ? undefined : (q: string) => ({ matches: q === DARK_MEDIA_QUERY ? Boolean(opts.systemDark) : false });
  const window: Record<string, unknown> = { localStorage, matchMedia };
  const sandbox = { window, document: { documentElement: html }, localStorage, matchMedia };
  vm.runInNewContext(THEME_INIT_SCRIPT, sandbox);
  return html;
}

describe("THEME_INIT_SCRIPT", () => {
  it("is a self-contained script that references the storage key and the media query", () => {
    expect(THEME_INIT_SCRIPT).toContain(THEME_STORAGE_KEY);
    expect(THEME_INIT_SCRIPT).toContain(DARK_MEDIA_QUERY);
    expect(THEME_INIT_SCRIPT).toContain("dataset.theme");
    expect(THEME_INIT_SCRIPT).toContain("colorScheme");
    expect(THEME_INIT_SCRIPT).not.toContain("import");
    expect(THEME_INIT_SCRIPT).not.toContain("</script");
  });

  it("applies a stored dark preference even on a light device", () => {
    const html = runInitScript({ stored: "dark", systemDark: false });
    expect(html.dataset.theme).toBe("dark");
    expect(html.style.colorScheme).toBe("dark");
  });

  it("applies a stored light preference even on a dark device", () => {
    const html = runInitScript({ stored: "light", systemDark: true });
    expect(html.dataset.theme).toBe("light");
    expect(html.style.colorScheme).toBe("light");
  });

  it("falls back to the device for junk or missing values", () => {
    expect(runInitScript({ stored: "banana", systemDark: true }).dataset.theme).toBe("dark");
    expect(runInitScript({ stored: "banana", systemDark: false }).dataset.theme).toBe("light");
    expect(runInitScript({ stored: "system", systemDark: true }).dataset.theme).toBe("dark");
    expect(runInitScript({ stored: null, systemDark: false }).dataset.theme).toBe("light");
  });

  it("never throws: blocked storage or no matchMedia still yields a theme", () => {
    expect(runInitScript({ storageThrows: true, systemDark: true }).dataset.theme).toBe("dark");
    expect(runInitScript({ storageThrows: true, systemDark: false }).dataset.theme).toBe("light");
    expect(runInitScript({ stored: "banana", noMatchMedia: true }).dataset.theme).toBe("light");
    // Even a broken document must not surface an error before paint.
    expect(() => vm.runInNewContext(THEME_INIT_SCRIPT, { window: {}, document: {} })).not.toThrow();
    expect(() => vm.runInNewContext(THEME_INIT_SCRIPT, {})).not.toThrow();
  });
});
