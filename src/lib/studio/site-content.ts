import type { Json } from "@/lib/supabase/database.types";
import { isValidHttpUrl } from "@/lib/utils";
import { isPlainObject } from "@/lib/validation";

/**
 * Optional website content kept in photo_studio.settings (edited by hand or
 * by a later settings screen). Everything is validated on read, so a stray
 * value never breaks the public site and no URL is rendered unchecked.
 */
export type Testimonial = { quote: string; name: string; role: string | null };
export type PortfolioLink = { title: string; url: string; cover: string | null };

export function readTestimonials(settings: Json): Testimonial[] {
  if (!isPlainObject(settings) || !Array.isArray(settings.testimonials)) return [];
  const out: Testimonial[] = [];
  for (const t of settings.testimonials) {
    if (!isPlainObject(t) || typeof t.quote !== "string" || typeof t.name !== "string") continue;
    const quote = t.quote.trim().slice(0, 600);
    const name = t.name.trim().slice(0, 80);
    if (!quote || !name) continue;
    out.push({ quote, name, role: typeof t.role === "string" && t.role.trim() ? t.role.trim().slice(0, 80) : null });
  }
  return out.slice(0, 6);
}

export function readPortfolio(settings: Json): PortfolioLink[] {
  if (!isPlainObject(settings) || !Array.isArray(settings.portfolio)) return [];
  const out: PortfolioLink[] = [];
  for (const p of settings.portfolio) {
    if (!isPlainObject(p) || typeof p.title !== "string" || typeof p.url !== "string") continue;
    const title = p.title.trim().slice(0, 120);
    const url = p.url.trim();
    if (!title || !isValidHttpUrl(url) || !url.startsWith("https://")) continue;
    const cover = typeof p.cover === "string" && p.cover.startsWith("https://") && isValidHttpUrl(p.cover) ? p.cover : null;
    out.push({ title, url, cover });
  }
  return out.slice(0, 24);
}
