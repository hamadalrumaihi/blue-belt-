"use client";

import { CopyButton } from "@/components/CopyButton";
import { MailIcon, PhoneIcon } from "@/components/icons";

type Props = { payUrl: string; text: string; email: string | null; phone: string | null; subject: string };

/**
 * Hands the order's online payment link to the owner to pass on: copy it, or
 * open their own e-mail / WhatsApp with the message filled in. Nothing is
 * sent from here; the owner presses send in their own app.
 */
export function PaymentLinkShare({ payUrl, text, email, phone, subject }: Props) {
  const wa = whatsappNumber(phone);
  return (
    <div className="mt-3 rounded-lg bg-page px-3 py-2 text-xs text-muted">
      <p>Payment link: <a href={payUrl} target="_blank" rel="noopener noreferrer" className="break-all font-semibold text-primary underline">{payUrl}</a></p>
      <div className="mt-2 flex flex-wrap gap-2">
        <CopyButton value={payUrl} label="Copy link" copiedLabel="Link copied" />
        {email && (
          <a className="btn-secondary min-h-11" href={`mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`}>
            <MailIcon size={16} /> Open in email
          </a>
        )}
        {wa && (
          <a className="btn-secondary min-h-11" href={`https://wa.me/${wa}?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer">
            <PhoneIcon size={16} /> Open in WhatsApp
          </a>
        )}
      </div>
      <p className="mt-1">Share it with the buyer yourself; it is never sent automatically.</p>
    </div>
  );
}

/** wa.me wants digits only with the country code; a bare 8-digit number is treated as Qatar (+974). */
function whatsappNumber(phone: string | null): string | null {
  const digits = (phone ?? "").replace(/\D/g, "").replace(/^00/, "");
  if (digits.length === 8) return `974${digits}`;
  return digits.length >= 10 ? digits : null;
}
