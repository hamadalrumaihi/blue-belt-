// Vision analysis of one photograph with Claude. The result is cached by
// content hash under photos/cache so a re-run never pays twice for the same
// bytes, and the selection stays stable between runs.
import Anthropic from "@anthropic-ai/sdk";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const CATEGORIES = ["tournament_action", "athlete_portrait", "training_session", "team_club", "coaching_moment", "victory_podium", "behind_the_scenes", "brand_general"];
export const PLACEMENTS = ["hero", "tournament_athlete", "club", "training_session", "private_session", "custom", "showcase"];

export const DEFAULT_MODEL = "claude-opus-5-5";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["category", "sport", "description", "scores", "people_count", "minors_likely", "sensitive", "visible_third_party_branding", "hero_suitable", "text_space", "focal_point", "issues", "placements", "intentional_motion_blur"],
  properties: {
    category: { type: "string", enum: CATEGORIES },
    sport: { type: ["string", "null"], description: "The combat sport shown if clear (e.g. BJJ gi, no-gi grappling, judo, MMA), else null." },
    description: { type: "string", description: "One neutral sentence describing what is visible, usable as alt text. No names, no claimed events or results." },
    scores: {
      type: "object",
      additionalProperties: false,
      required: ["technical", "composition", "peak_action", "emotion", "subject_clarity", "brand_fit"],
      properties: {
        technical: { type: "integer", minimum: 0, maximum: 10 },
        composition: { type: "integer", minimum: 0, maximum: 10 },
        peak_action: { type: "integer", minimum: 0, maximum: 10 },
        emotion: { type: "integer", minimum: 0, maximum: 10 },
        subject_clarity: { type: "integer", minimum: 0, maximum: 10 },
        brand_fit: { type: "integer", minimum: 0, maximum: 10 },
      },
    },
    people_count: { type: "integer", minimum: 0 },
    minors_likely: { type: "boolean" },
    sensitive: { type: "boolean", description: "Injury, blood, distress, undress, or anything unsuitable for a public business website." },
    visible_third_party_branding: { type: "boolean" },
    hero_suitable: { type: "boolean", description: "Strong single focal subject, clean background, works large behind a headline." },
    text_space: { type: "string", enum: ["left", "right", "top", "bottom", "none"] },
    focal_point: {
      type: "object",
      additionalProperties: false,
      required: ["x", "y"],
      properties: { x: { type: "number", minimum: 0, maximum: 1 }, y: { type: "number", minimum: 0, maximum: 1 } },
    },
    intentional_motion_blur: { type: "boolean" },
    issues: { type: "array", items: { type: "string" } },
    placements: { type: "array", items: { type: "string", enum: PLACEMENTS } },
  },
};

const SYSTEM = `You are a photo editor for Blue Belt Media, a combat-sports photography and video studio in Doha, Qatar. You judge photographs for a premium business website: dark navy design, white type, photography as the main visual element.

Score honestly on a 0-10 scale. A technically sharp frame is not automatically the best photograph; a frame with slight motion blur can be the stronger picture when the moment is right. Reward peak action (takedowns, throws, submission attempts, scrambles, visible technique), real expressions, clear storytelling, strong subject separation and competition atmosphere. Penalise near-misses: poorly timed action, unclear subjects, unflattering expressions, distracting backgrounds, awkward crops that cut heads or limbs, heavy noise, clipped exposure, processing artefacts.

Categories: tournament_action (competition matches), athlete_portrait (controlled portrait or posed athlete), training_session (class, drill, sparring at an academy), team_club (groups, teams, academies), coaching_moment (coach with athlete), victory_podium (medals, podiums, celebrations), behind_the_scenes, brand_general (anything else that still says combat sports media).

Placements you may suggest: hero (home page, large, needs a clean area for a headline), tournament_athlete, club, training_session, private_session (portraits and controlled athlete images), custom (seminars, events, podiums, promotions), showcase (a strong standalone image).

Flag minors_likely when any subject appears under 18, sensitive for anything unsuitable for public use, and visible_third_party_branding for prominent logos, sponsor boards or organiser branding. Never guess names, events, results or ages beyond what is visible. The description must be a plain, neutral sentence suitable as alt text.`;

export function createVisionClient() {
  return new Anthropic();
}

/** Analyses one image (JPEG bytes). Throws on API errors so the caller can decide whether to retry. */
export async function analyseImage(client, jpeg, { model = DEFAULT_MODEL } = {}) {
  const response = await client.beta.messages.create({
    model,
    max_tokens: 2048,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: jpeg.toString("base64") } },
          { type: "text", text: "Assess this photograph for the website." },
        ],
      },
    ],
  });
  if (response.stop_reason === "refusal") {
    return { refused: true, category: response.stop_details?.category ?? null };
  }
  const text = response.content.find((b) => b.type === "text")?.text ?? "";
  const parsed = JSON.parse(text);
  return { refused: false, model: response.model, ...parsed };
}

export class VisionCache {
  constructor(dir) {
    this.dir = dir;
  }
  file(sha) {
    return path.join(this.dir, `${sha}.json`);
  }
  async get(sha) {
    try {
      return JSON.parse(await readFile(this.file(sha), "utf8"));
    } catch {
      return null;
    }
  }
  async set(sha, value) {
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.file(sha), JSON.stringify(value, null, 2));
  }
}

/** Runs `fn` over `items` with at most `limit` in flight. */
export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
