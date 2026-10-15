/**
 * A DRAFT owner follow-up asking the client for the details an assessment
 * is missing. Plain text the owner copies into WhatsApp or e-mail by hand;
 * nothing here sends anything. Pure.
 */
import type { PricingRequest } from "./engine/types";

const QUESTIONS: Record<string, string> = {
  service: "What kind of coverage do you have in mind (a competition, a team day, a training session, portraits, or something else)?",
  media: "Would you like photos, video, or both?",
  video_deliverables: "For video: full matches, an edited highlight film, short reels, or the raw footage?",
  hours_on_site: "Roughly how many hours should we be on site, and from what time?",
  athlete_count: "How many athletes should we cover?",
  simultaneous_mats: "How many mats run at the same time?",
  event_date: "Which date is it?",
  location_kind: "Where will it take place (a sports hall, your academy, a studio, outdoors)?",
  usage: "Is this for personal use, for the club or team, or for a brand or commercial use?",
  expected_images: "About how many edited photos would you like to receive?",
};

export function followUpDraft(req: PricingRequest, missing: string[] = [...req.criticalMissing, ...req.missingInputs]): string {
  const asks = [...new Set(missing)].map((k) => QUESTIONS[k]).filter((q): q is string => Boolean(q));
  const lines = ["Hi,", "", "Thanks for your request. To give you an accurate price, could you tell me:", ""];
  if (asks.length === 0) lines.push("- (nothing is missing; this draft is a courtesy check-in)");
  for (const q of asks) lines.push(`- ${q}`);
  lines.push("", "Once I have that I will send you a quote within a day.", "", "Best regards,", "Blue Belt Media");
  return lines.join("\n");
}
