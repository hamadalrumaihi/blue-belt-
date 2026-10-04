import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createSpool } from "../src/spool.mjs";

const dir = mkdtempSync(path.join(tmpdir(), "bbm-spool-"));
after(() => rmSync(dir, { recursive: true, force: true }));

describe("spool", () => {
  test("persists captures before upload, lists them oldest first, updates attempts and removes on verdict", () => {
    const spool = createSpool(dir);
    spool.put({ captureId: "cap-2", url: "u", capturedAt: "2026-03-14T06:01:00.000Z", html: "<b>", attempts: 0 });
    spool.put({ captureId: "cap-1", url: "u", capturedAt: "2026-03-14T06:00:00.000Z", html: "<a>", attempts: 0 });
    assert.equal(spool.count(), 2);
    assert.deepEqual(spool.list().map((c) => c.captureId), ["cap-1", "cap-2"]);
    assert.equal(readdirSync(dir).some((n) => n.endsWith(".tmp")), false);
    spool.update("cap-1", { attempts: 2, lastError: "HTTP_503" });
    assert.equal(spool.list()[0].attempts, 2);
    spool.remove("cap-1");
    assert.deepEqual(spool.list().map((c) => c.captureId), ["cap-2"]);
    spool.remove("cap-missing"); // no throw
  });

  test("drops unreadable files and keeps only the newest maxFiles", () => {
    const spool = createSpool(dir, { maxFiles: 3 });
    writeFileSync(path.join(dir, "junk.json"), "{not json", "utf8");
    writeFileSync(path.join(dir, "shape.json"), JSON.stringify({ nope: true }), "utf8");
    for (let i = 3; i <= 7; i += 1) spool.put({ captureId: `cap-${i}`, url: "u", capturedAt: `2026-03-14T06:0${i}:00.000Z`, html: "<p>", attempts: 0 });
    assert.equal(spool.list().length <= 3, true);
    assert.equal(readdirSync(dir).includes("junk.json"), false);
  });

  test("sanitises capture ids used as file names", () => {
    const spool = createSpool(dir);
    const file = spool.put({ captureId: "../../etc/passwd", url: "u", capturedAt: "t", html: "<p>", attempts: 0 });
    assert.equal(path.dirname(file), dir);
    assert.equal(path.basename(file), ".._.._etc_passwd.json");
    spool.remove("../../etc/passwd");
  });
});
