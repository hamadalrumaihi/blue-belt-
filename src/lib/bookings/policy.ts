/**
 * Deposit and balance policy (round 3): 50% before the booking is confirmed,
 * 50% after delivery. Read from the environment with fail-safe defaults: a
 * missing or malformed setting never turns the deposit OFF.
 *
 *   BOOKINGS_DEPOSIT_REQUIRED   "1" (default) | "0"
 *   BOOKINGS_DEPOSIT_PERCENT    1..100, default 50
 *   BOOKINGS_BALANCE_TIMING     "after_delivery" (default, the only supported value)
 *
 * Pure: safe to import from client components and tests.
 */
export type DepositPolicy = {
  depositRequired: boolean;
  depositPercent: number;
  balanceTiming: "after_delivery";
  /** True when a setting was present but unusable and the safe default was used. */
  warnings: string[];
};

export const DEFAULT_DEPOSIT_PERCENT = 50;

export function readDepositPolicy(env: Record<string, string | undefined> = process.env): DepositPolicy {
  const warnings: string[] = [];
  const requiredRaw = env.BOOKINGS_DEPOSIT_REQUIRED;
  let depositRequired = true;
  if (requiredRaw === "0") depositRequired = false;
  else if (requiredRaw !== undefined && requiredRaw !== "1") warnings.push(`BOOKINGS_DEPOSIT_REQUIRED="${requiredRaw}" is not 0 or 1; deposit stays required.`);

  let depositPercent = DEFAULT_DEPOSIT_PERCENT;
  const percentRaw = env.BOOKINGS_DEPOSIT_PERCENT;
  if (percentRaw !== undefined) {
    const n = Number(percentRaw);
    if (Number.isFinite(n) && n >= 1 && n <= 100) depositPercent = n;
    else warnings.push(`BOOKINGS_DEPOSIT_PERCENT="${percentRaw}" is not between 1 and 100; using ${DEFAULT_DEPOSIT_PERCENT}.`);
  }

  const timingRaw = env.BOOKINGS_BALANCE_TIMING;
  if (timingRaw !== undefined && timingRaw !== "after_delivery") warnings.push(`BOOKINGS_BALANCE_TIMING="${timingRaw}" is not supported; using after_delivery.`);

  return { depositRequired, depositPercent, balanceTiming: "after_delivery", warnings };
}

/** Money is split on the server: deposit rounded to fils, balance takes the remainder. */
export function splitAmounts(amountQr: number, depositPercent: number = DEFAULT_DEPOSIT_PERCENT): { depositQr: number; balanceQr: number } {
  const total = Math.max(0, Math.round(Number(amountQr) * 100) / 100);
  if (total === 0) return { depositQr: 0, balanceQr: 0 };
  const pct = Math.min(100, Math.max(0, depositPercent));
  const depositQr = Math.round((total * pct) / 100 * 100) / 100;
  const balanceQr = Math.round((total - depositQr) * 100) / 100;
  return { depositQr, balanceQr };
}

/** Columns to set when a booking's total is set or changed before the deposit is paid. */
export function depositColumnsFor(amountQr: number, policy: DepositPolicy = readDepositPolicy()): { deposit_percent: number; deposit_qr: number; balance_qr: number; deposit_state: "not_required" | "pending" } {
  const { depositQr, balanceQr } = splitAmounts(amountQr, policy.depositRequired ? policy.depositPercent : 0);
  if (!policy.depositRequired || amountQr <= 0) {
    return { deposit_percent: policy.depositRequired ? policy.depositPercent : 0, deposit_qr: 0, balance_qr: Math.round(Math.max(0, amountQr) * 100) / 100, deposit_state: "not_required" };
  }
  return { deposit_percent: policy.depositPercent, deposit_qr: depositQr, balance_qr: balanceQr, deposit_state: "pending" };
}
