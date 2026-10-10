import { formatQr } from "@/lib/bookings/state";
import type { PhotoServiceRow, PriceMode } from "@/lib/supabase/database.types";

/**
 * How a package's price reads on the public site. Pure, shared by the home
 * page, the services page, the booking wizard and the structured data, so
 * the three pricing modes mean the same thing everywhere:
 *   fixed  "350 QAR"             a set price
 *   from   "from 350 QAR"        a starting price, confirmed before payment
 *   quote  "Quote on request"    no public price
 * A row whose mode needs a price but has none falls back to a quote, so a
 * half-configured package never shows "0 QAR".
 */
export type PublicPrice = { mode: PriceMode; amount: number | null; label: string; short: string };

export function publicPrice(service: Pick<PhotoServiceRow, "price_qr" | "price_mode">): PublicPrice {
  const amount = service.price_qr === null ? null : Number(service.price_qr);
  const priced = amount !== null && Number.isFinite(amount) && amount > 0;
  const mode: PriceMode = priced ? (service.price_mode === "quote" ? "quote" : service.price_mode === "fixed" ? "fixed" : "from") : "quote";
  if (mode === "quote") return { mode, amount: null, label: "Quote on request", short: "Quote" };
  const money = formatQr(amount as number);
  return mode === "fixed" ? { mode, amount, label: money, short: money } : { mode, amount, label: `from ${money}`, short: `from ${money}` };
}

/** The lowest public price among a type's packages, for the summary cards: "from 350 QAR", "350 QAR" when all fixed and equal, else a quote. */
export function priceLineFor(services: readonly PhotoServiceRow[]): string {
  const priced = services.map(publicPrice).filter((p) => p.amount !== null);
  if (!priced.length) return "Quote on request";
  const min = Math.min(...priced.map((p) => p.amount as number));
  const allFixedSame = priced.every((p) => p.mode === "fixed" && p.amount === min);
  return allFixedSame ? formatQr(min) : `from ${formatQr(min)}`;
}

export const PRICE_MODE_LABEL: Record<PriceMode, string> = { fixed: "Fixed price", from: "Starting from", quote: "Quote on request" };
export const PRICE_MODES: readonly PriceMode[] = ["from", "fixed", "quote"];
export function isPriceMode(v: unknown): v is PriceMode {
  return typeof v === "string" && (PRICE_MODES as readonly string[]).includes(v);
}
