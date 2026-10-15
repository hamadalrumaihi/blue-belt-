/**
 * What of a package's text may reach a prospect. Seeded packages carried
 * setup instructions in their description ("Set your price.") and the live
 * site published them. Pure, shared by the public pages, the wizard and
 * the owner's Packages page (which warns instead of hiding).
 */

/** Sentences that are instructions to the owner or stand-ins for real copy, never an offer. */
const PLACEHOLDER_SENTENCE = [
  /^set (your|a|the) (own )?price\b/i,
  /^add (your|a|the) price\b/i,
  /^quoted individually\b/i,
  /^quoted per (day|event|session)\b/i,
  /^price (tbd|tbc|to be (set|confirmed|decided))\b/i,
  /^(tbd|tbc|todo|placeholder|lorem ipsum)\b/i,
  /\b(lorem ipsum|placeholder text)\b/i,
];

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isPlaceholderSentence(sentence: string): boolean {
  const s = sentence.trim();
  return PLACEHOLDER_SENTENCE.some((re) => re.test(s));
}

/** True when the description still contains a seed instruction the owner should replace (owner UI warning). */
export function isPlaceholderDescription(description: string | null | undefined): boolean {
  if (!description) return false;
  return sentences(description).some(isPlaceholderSentence);
}

/** The description with placeholder sentences removed; null when nothing publishable is left. */
export function publicServiceDescription(description: string | null | undefined): string | null {
  if (!description) return null;
  const kept = sentences(description).filter((s) => !isPlaceholderSentence(s));
  const text = kept.join(" ").trim();
  return text || null;
}
