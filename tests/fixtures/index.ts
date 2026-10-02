import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export type FixtureName =
  | "ajp-bracket-table"
  | "ajp-embedded-json"
  | "smoothcomp-cards"
  | "cloudflare-challenge"
  | "js-shell"
  | "schedule-unpublished";

/** Reads a synthetic HTML fixture from tests/fixtures. */
export function fixture(name: FixtureName): string {
  return readFileSync(fileURLToPath(new URL(`./${name}.html`, import.meta.url)), "utf8");
}
