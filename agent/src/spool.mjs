import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Durable spool: every capture is written to disk BEFORE any upload is
 * attempted and deleted only after the server returned a terminal verdict
 * for that exact capture id. A crash or a dead network between the two
 * leaves the file in place; the next start replays it, and the server's
 * capture-id replay makes a double upload harmless.
 *
 * Files: <spoolDir>/<captureId>.json  { captureId, url, finalUrl, capturedAt, completeness, html, attempts, lastError }
 * Writes go to a .tmp file first and are renamed into place (atomic on NTFS and POSIX).
 */
export function createSpool(dir, { maxFiles = 200 } = {}) {
  mkdirSync(dir, { recursive: true });
  const fileFor = (id) => path.join(dir, `${sanitize(id)}.json`);

  return {
    dir,
    put(capture) {
      const file = fileFor(capture.captureId);
      const tmp = `${file}.tmp`;
      writeFileSync(tmp, JSON.stringify(capture), "utf8");
      renameSync(tmp, file);
      this.prune();
      return file;
    },
    update(captureId, patch) {
      const file = fileFor(captureId);
      let current;
      try {
        current = JSON.parse(readFileSync(file, "utf8"));
      } catch {
        return null;
      }
      const next = { ...current, ...patch };
      const tmp = `${file}.tmp`;
      writeFileSync(tmp, JSON.stringify(next), "utf8");
      renameSync(tmp, file);
      return next;
    },
    remove(captureId) {
      rmSync(fileFor(captureId), { force: true });
    },
    /** Pending captures, oldest first (by capturedAt). Unreadable files are dropped. */
    list() {
      const out = [];
      for (const name of readdirSync(dir)) {
        if (!name.endsWith(".json")) continue;
        const file = path.join(dir, name);
        try {
          const parsed = JSON.parse(readFileSync(file, "utf8"));
          if (parsed && typeof parsed.captureId === "string" && typeof parsed.html === "string") out.push(parsed);
          else rmSync(file, { force: true });
        } catch {
          rmSync(file, { force: true });
        }
      }
      return out.sort((a, b) => String(a.capturedAt).localeCompare(String(b.capturedAt)));
    },
    count() {
      return readdirSync(dir).filter((n) => n.endsWith(".json")).length;
    },
    /** Keeps the newest `maxFiles` captures; an event laptop offline for hours must not fill the disk. */
    prune() {
      const files = readdirSync(dir)
        .filter((n) => n.endsWith(".json"))
        .map((n) => ({ n, t: statSync(path.join(dir, n)).mtimeMs }))
        .sort((a, b) => b.t - a.t);
      for (const f of files.slice(maxFiles)) rmSync(path.join(dir, f.n), { force: true });
    },
  };
}

function sanitize(id) {
  return String(id).replace(/[^A-Za-z0-9._:-]/g, "_").slice(0, 128);
}
