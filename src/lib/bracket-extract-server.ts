import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { jsonSchemaOutputFormat } from "@anthropic-ai/sdk/helpers/json-schema";
import { BRACKET_SCHEMA, coerceExtracted, type ExtractedBracket, type ExtractMediaType } from "./bracket-extract";
import type { DivisionRules } from "./local-divisions";

/**
 * Reads a bracket screenshot with Claude and returns the strict JSON the
 * review screen edits. Server-only: the API key never reaches the browser.
 * Off unless ANTHROPIC_API_KEY is set; the UI then says so instead of failing.
 */
export function isBracketExtractionConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export type ExtractOutcome = { ok: true; extracted: ExtractedBracket; model: string } | { ok: false; error: string };

export async function extractBracketFromImage(input: { data: string; mediaType: ExtractMediaType; eventName: string; rules: DivisionRules | null }): Promise<ExtractOutcome> {
  if (!isBracketExtractionConfigured()) return { ok: false, error: "Reading bracket photos is not set up on this server (ANTHROPIC_API_KEY)." };
  const client = new Anthropic();
  const chart = input.rules
    ? `Known age groups and weight divisions for this competition (use these spellings when the bracket's labels match):\n${input.rules.ageGroups.map((g) => `- ${g.label} (ages ${g.minAge}–${g.maxAge}): ${g.divisions.map((d) => `${d.label} up to ${d.maxKg} kg`).join(", ")}`).join("\n")}`
    : "";
  const system = [
    "You read photographs and screenshots of jiu-jitsu tournament brackets for a sports photographer who tracks which of their clients fight when and where.",
    "Transcribe only what is printed. Never invent names, times, mats or results. When something is unclear, leave it null and note it in `unreadable`.",
    "Names must be copied exactly as printed (keep diacritics and order). A bye or an empty slot is an opponent of null.",
    "A winner is only set when the bracket marks one (an advanced name, a highlighted box, a score next to the winner).",
    chart,
  ].filter(Boolean).join("\n\n");

  try {
    const response = await client.messages.parse({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      system,
      output_config: { effort: "high", format: jsonSchemaOutputFormat(BRACKET_SCHEMA) },
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: input.mediaType, data: input.data } },
            { type: "text", text: `Event: ${input.eventName}. Read this bracket and return every match slot.` },
          ],
        },
      ],
    });
    if (response.stop_reason === "refusal") return { ok: false, error: "The image could not be read." };
    if (response.stop_reason === "max_tokens") return { ok: false, error: "The bracket is too large to read in one go. Crop it and try one section at a time." };
    const extracted = coerceExtracted(response.parsed_output);
    if (!extracted.matches.length) return { ok: false, error: `No matches could be read from the image.${extracted.unreadable.length ? ` ${extracted.unreadable[0]}` : ""}` };
    return { ok: true, extracted, model: response.model };
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) return { ok: false, error: "The server's ANTHROPIC_API_KEY was rejected." };
    if (err instanceof Anthropic.RateLimitError) return { ok: false, error: "The reading service is busy. Try again in a minute." };
    if (err instanceof Anthropic.APIError) return { ok: false, error: `Reading failed (${err.status ?? "network"}). Try a clearer photo.` };
    return { ok: false, error: "Reading failed. Try again." };
  }
}
