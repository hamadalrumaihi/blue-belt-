import { escapeHtml } from "@/lib/notifications/telegram/core";
import type { ClientNotificationKind } from "./kinds";

/**
 * Plain, mobile-friendly transactional e-mails. Every dynamic value is
 * escaped; links are rendered from a URL we built, never from client text.
 * Text and HTML are generated from the same content so both stay in step.
 */
export type EmailContent = {
  kind: ClientNotificationKind;
  subject: string;
  greeting: string;
  paragraphs: string[];
  cta?: { label: string; url: string } | null;
  /** Key/value facts shown as a small table (booking reference, date, amount…). */
  facts?: Array<[string, string]>;
  footer?: string;
  businessName: string;
};

export function renderEmailText(c: EmailContent): string {
  const lines = [c.greeting, "", ...c.paragraphs.flatMap((p) => [p, ""])];
  if (c.facts?.length) {
    for (const [k, v] of c.facts) lines.push(`${k}: ${v}`);
    lines.push("");
  }
  if (c.cta) lines.push(`${c.cta.label}: ${c.cta.url}`, "");
  lines.push(c.footer ?? `${c.businessName}`);
  return lines.join("\n");
}

export function renderEmailHtml(c: EmailContent): string {
  const facts = c.facts?.length
    ? `<table role="presentation" style="border-collapse:collapse;margin:16px 0;width:100%">${c.facts
        .map(([k, v]) => `<tr><td style="padding:6px 8px 6px 0;color:#68758a;font-size:14px;white-space:nowrap;vertical-align:top">${escapeHtml(k)}</td><td style="padding:6px 0;color:#14213d;font-size:14px;font-weight:600">${escapeHtml(v)}</td></tr>`)
        .join("")}</table>`
    : "";
  const cta = c.cta
    ? `<p style="margin:24px 0"><a href="${escapeAttr(c.cta.url)}" style="display:inline-block;background:#1769e0;color:#fff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:12px;font-size:15px">${escapeHtml(c.cta.label)}</a></p><p style="font-size:12px;color:#68758a;word-break:break-all">If the button does not open, copy this link: ${escapeHtml(c.cta.url)}</p>`
    : "";
  return `<!doctype html><html><body style="margin:0;background:#f6f8fc;font-family:Inter,-apple-system,Segoe UI,Roboto,sans-serif;color:#14213d">
<div style="max-width:560px;margin:0 auto;padding:24px 16px">
  <p style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#68758a;font-weight:700;margin:0 0 16px">${escapeHtml(c.businessName)}</p>
  <div style="background:#fff;border:1px solid #e3e9f2;border-radius:16px;padding:24px">
    <p style="font-size:16px;margin:0 0 16px">${escapeHtml(c.greeting)}</p>
    ${c.paragraphs.map((p) => `<p style="font-size:15px;line-height:1.55;margin:0 0 14px">${escapeHtml(p)}</p>`).join("")}
    ${facts}
    ${cta}
  </div>
  <p style="font-size:12px;color:#68758a;margin:16px 0 0">${escapeHtml(c.footer ?? `${c.businessName} · This message was sent about your booking.`)}</p>
</div></body></html>`;
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, "&quot;");
}

export type EmailDraft = { to: string; subject: string; html: string; text: string };

export function buildEmail(to: string, c: EmailContent): EmailDraft {
  return { to, subject: c.subject, html: renderEmailHtml(c), text: renderEmailText(c) };
}
