import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { hostAllowed, validateTargetUrl } from "../src/url-policy.mjs";

const HOSTS = ["ajptour.com", "smoothcomp.com"];

describe("hostAllowed", () => {
  test("accepts the registrable domains and their subdomains, case-insensitively", () => {
    assert.equal(hostAllowed("ajptour.com", HOSTS), true);
    assert.equal(hostAllowed("www.ajptour.com", HOSTS), true);
    assert.equal(hostAllowed("events.smoothcomp.com", HOSTS), true);
    assert.equal(hostAllowed("AJPTOUR.COM", HOSTS), true);
    assert.equal(hostAllowed("ajptour.com.", HOSTS), true); // trailing dot
  });

  test("rejects look-alikes, IP literals and empty hosts", () => {
    assert.equal(hostAllowed("evil-ajptour.com", HOSTS), false);
    assert.equal(hostAllowed("ajptour.com.evil.example", HOSTS), false);
    assert.equal(hostAllowed("ajptour.co", HOSTS), false);
    assert.equal(hostAllowed("127.0.0.1", HOSTS), false);
    assert.equal(hostAllowed("169.254.169.254", HOSTS), false);
    assert.equal(hostAllowed("[::1]", HOSTS), false);
    assert.equal(hostAllowed("", HOSTS), false);
    assert.equal(hostAllowed(undefined, HOSTS), false);
    assert.equal(hostAllowed("ajptour.com", []), false);
  });
});

describe("validateTargetUrl", () => {
  test("accepts an https URL on an allow-listed host and strips the fragment", () => {
    const r = validateTargetUrl("  https://www.ajptour.com/events/4471/brackets/88?tab=matches#top ", HOSTS);
    assert.equal(r.ok, true);
    assert.equal(r.url.toString(), "https://www.ajptour.com/events/4471/brackets/88?tab=matches");
    assert.equal(r.url.hash, "");
  });

  test("rejects non-string, empty, overlong and unparsable input", () => {
    for (const raw of [undefined, null, 42, "", "   ", "not a url", `https://ajptour.com/${"a".repeat(2100)}`]) {
      const r = validateTargetUrl(raw, HOSTS);
      assert.equal(r.ok, false, String(raw).slice(0, 20));
      assert.equal(r.code, "INVALID_URL");
    }
  });

  test("rejects http, credentials, custom ports and IP literals", () => {
    assert.deepEqual(validateTargetUrl("http://ajptour.com/x", HOSTS), { ok: false, code: "INVALID_URL", message: "Only https URLs are allowed." });
    assert.deepEqual(validateTargetUrl("https://user:pass@ajptour.com/x", HOSTS), { ok: false, code: "INVALID_URL", message: "Credentials in URLs are not allowed." });
    assert.deepEqual(validateTargetUrl("https://ajptour.com:8443/x", HOSTS), { ok: false, code: "INVALID_URL", message: "Custom ports are not allowed." });
    assert.equal(validateTargetUrl("https://ajptour.com:443/x", HOSTS).ok, true);
    assert.equal(validateTargetUrl("https://10.0.0.1/x", HOSTS).code, "UNSUPPORTED_HOST");
    assert.equal(validateTargetUrl("https://[::1]/x", HOSTS).code, "UNSUPPORTED_HOST");
  });

  test("rejects hosts outside the allow-list with UNSUPPORTED_HOST", () => {
    const r = validateTargetUrl("https://example.com/x", HOSTS);
    assert.equal(r.ok, false);
    assert.equal(r.code, "UNSUPPORTED_HOST");
    assert.match(r.message, /example\.com/);
  });
});
