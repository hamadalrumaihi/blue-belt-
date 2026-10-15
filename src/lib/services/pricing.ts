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

/**
 * What a public request books at. ONE decision shared by the wizard's
 * package list and summary, `submitPublicBooking` and lead conversion, so
 * the website never shows "Quote on request" while the booking row carries a
 * price (issue #10: `price_mode` was ignored and only a null price meant a
 * quote).
 *   quoteOnly  no package, a quote-first catalog service, or a package whose
 *              public price is a quote (`price_mode = 'quote'`, or no usable
 *              price): amount 0, payment mode `quote`, booking starts as an
 *              inquiry.
 *   priced     `fixed` / `from` with a price > 0: the package price, payment
 *              link later (nothing is charged on the public form).
 */
export type BookableAmount = { quoteOnly: boolean; amountQr: number; paymentMode: "quote" | "link_later"; priceMode: PriceMode };

export function bookableAmount(service: Pick<PhotoServiceRow, "price_qr" | "price_mode"> | null | undefined, options: { quoteFirst?: boolean } = {}): BookableAmount {
  if (!service || options.quoteFirst) return { quoteOnly: true, amountQr: 0, paymentMode: "quote", priceMode: "quote" };
  const price = publicPrice(service);
  if (price.mode === "quote" || price.amount === null) return { quoteOnly: true, amountQr: 0, paymentMode: "quote", priceMode: "quote" };
  return { quoteOnly: false, amountQr: Math.round(price.amount * 100) / 100, paymentMode: "link_later", priceMode: price.mode };
}
