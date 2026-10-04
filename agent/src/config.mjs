import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Agent configuration. Values come from the environment; `agent.env` next to
 * the package (KEY=value lines) is loaded first so a Windows user edits one
 * file and double-clicks start-agent.cmd. Nothing here is logged in full.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

export function loadEnvFile(file = path.join(root, "agent.env")) {
  if (!existsSync(file)) return;
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function int(name, fallback) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? Math.round(v) : fallback;
}

function defaultDataDir() {
  if (process.platform === "win32") return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "BlueBeltAgent");
  return path.join(os.homedir(), ".bluebelt-agent");
}

export function readConfig() {
  loadEnvFile();
  const dataDir = process.env.AGENT_DATA_DIR || defaultDataDir();
  return {
    appUrl: (process.env.APP_URL || "").replace(/\/$/, ""),
    token: (process.env.CAPTURE_TOKEN || "").trim(),
    /** Dedicated Chrome/Chromium profile OUTSIDE the user's normal browser profile. */
    profileDir: process.env.PROFILE_DIR || path.join(dataDir, "profile"),
    spoolDir: process.env.SPOOL_DIR || path.join(dataDir, "spool"),
    /** "chrome" uses the installed Google Chrome (recommended on the event laptop); "chromium" uses Playwright's build. */
    browserChannel: (process.env.BROWSER_CHANNEL || "chrome").toLowerCase(),
    headless: process.env.HEADLESS === "1",
    intervalSeconds: int("INTERVAL_SECONDS", 60),
    jobsRefreshSeconds: int("JOBS_REFRESH_SECONDS", 300),
    heartbeatSeconds: int("HEARTBEAT_SECONDS", 60),
    /** Bounded readiness wait per capture (same meaning as the worker's READY_WAIT_MS). */
    readyWaitMs: int("READY_WAIT_MS", 15_000),
    navTimeoutMs: int("NAV_TIMEOUT_MS", 45_000),
    maxHtmlBytes: int("MAX_HTML_BYTES", 3 * 1024 * 1024),
    maxSpoolFiles: int("MAX_SPOOL_FILES", 200),
    once: process.argv.includes("--once"),
    version: "1.0.0",
  };
}

export function validateConfig(config) {
  const problems = [];
  if (!/^https:\/\/[^/]+$/.test(config.appUrl)) problems.push("APP_URL must be the app origin, e.g. https://tournament-watcher.vercel.app");
  if (!/^bbmc_[A-Za-z0-9]{8}_[A-Za-z0-9]{40}$/.test(config.token)) problems.push("CAPTURE_TOKEN must be a capture credential created in Settings → Capture agent (starts with bbmc_)");
  if (!["chrome", "chromium", "msedge"].includes(config.browserChannel)) problems.push("BROWSER_CHANNEL must be chrome, msedge or chromium");
  return problems;
}
