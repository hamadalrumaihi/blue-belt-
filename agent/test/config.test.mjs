import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { loadEnvFile, validateConfig } from "../src/config.mjs";

describe("config", () => {
  test("validateConfig names each problem", () => {
    const base = { appUrl: "https://app.example", token: "bbmc_abcdefgh_" + "y".repeat(40), browserChannel: "chrome" };
    assert.deepEqual(validateConfig(base), []);
    assert.equal(validateConfig({ ...base, appUrl: "http://app.example" }).length, 1);
    assert.equal(validateConfig({ ...base, appUrl: "https://app.example/path" }).length, 1);
    assert.match(validateConfig({ ...base, token: "service-role-key" })[0], /CAPTURE_TOKEN/);
    assert.equal(validateConfig({ ...base, browserChannel: "firefox" }).length, 1);
  });

  test("loadEnvFile reads KEY=value lines without overriding the real environment", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "bbm-env-"));
    try {
      const file = path.join(dir, "agent.env");
      writeFileSync(file, "# comment\nBBM_TEST_A=hello world\nBBM_TEST_B=\"quoted\"\nBBM_TEST_C=keep\n", "utf8");
      process.env.BBM_TEST_C = "env wins";
      loadEnvFile(file);
      assert.equal(process.env.BBM_TEST_A, "hello world");
      assert.equal(process.env.BBM_TEST_B, "quoted");
      assert.equal(process.env.BBM_TEST_C, "env wins");
      loadEnvFile(path.join(dir, "missing.env")); // no throw
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
