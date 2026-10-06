import { formatQr, type EffectivePayment } from "@/lib/bookings/state";
import { cn } from "@/lib/utils";

type Props = { payment: EffectivePayment; amountQr: number; size?: "sm" | "md"; className?: string; detailed?: boolean };

/** "Is this booking paid?" at a glance: provider-verified wins, manual records fill in, partial shows what is still due. */
export function PaymentBadge({ payment, amountQr, size = "md", className, detailed = false }: Props) {
  const amount = Number(amountQr) || 0;
  let label: string;
  let tone: string;
  if (amount <= 0 && payment.state === "unpaid") {
    label = "No charge";
    tone = "bg-page text-muted border border-line";
  } else if (payment.state === "paid") {
    label = detailed ? `Paid · ${payment.source === "provider" ? "MyFatoorah" : "recorded by hand"}` : "Paid";
    tone = "bg-success-soft text-success border border-success/30";
  } else if (payment.state === "partial") {
    label = detailed ? `Partly paid · ${formatQr(payment.dueQr)} due` : "Partly paid";
    tone = "bg-warning-soft text-warning border border-warning/30";
  } else if (payment.state === "refunded") {
    label = "Refunded";
    tone = "bg-page text-muted border border-line";
  } else {
    label = detailed ? `Unpaid · ${formatQr(payment.dueQr)} due` : "Unpaid";
    tone = "bg-warning-soft text-warning border border-warning/30";
  }
  return <span className={cn("inline-flex items-center whitespace-nowrap rounded-full font-bold uppercase tracking-wide", size === "sm" ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-[11px]", tone, className)}>{label}</span>;
}
