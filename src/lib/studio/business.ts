/**
 * The public business identity: what customers may see in the footer, on the
 * contact page, in the legal pages, in structured data and in e-mails. Read
 * from BUSINESS_* with the registered defaults, so a deployment without the
 * variables still shows the correct legal line. Never the physical office
 * address, QID, bank details or any secret.
 *
 * Pure: safe to import from client components, e-mail templates and tests.
 */
export type BusinessIdentity = {
  /** Registered trading name, e.g. "Blue belt media photography". */
  legalName: string;
  /** Commercial registration number. */
  crNumber: string;
  /** City and country only. */
  location: string;
  email: string;
  /**
   * Optional. The owner asked for no phone number on the website, so there is
   * no default: it is shown only when BUSINESS_CONTACT_PHONE is set.
   */
  phone: string | null;
};

export const DEFAULT_BUSINESS_IDENTITY: BusinessIdentity = {
  legalName: "Blue belt media photography",
  crNumber: "235175",
  location: "Doha, Qatar",
  email: "bluebeltmediaqatar@gmail.com",
  phone: null,
};

function read(env: Record<string, string | undefined>, key: string, fallback: string): string {
  const v = env[key]?.trim();
  return v ? v : fallback;
}

export function businessIdentity(env: Record<string, string | undefined> = process.env): BusinessIdentity {
  return {
    legalName: read(env, "BUSINESS_LEGAL_NAME", DEFAULT_BUSINESS_IDENTITY.legalName),
    crNumber: read(env, "BUSINESS_CR_NUMBER", DEFAULT_BUSINESS_IDENTITY.crNumber),
    location: read(env, "BUSINESS_PUBLIC_LOCATION", DEFAULT_BUSINESS_IDENTITY.location),
    email: read(env, "BUSINESS_CONTACT_EMAIL", DEFAULT_BUSINESS_IDENTITY.email),
    phone: env.BUSINESS_CONTACT_PHONE?.trim() || null,
  };
}

/** "Blue belt media photography, CR 235175, Doha, Qatar" for footers and legal pages. */
export function businessLegalLine(id: BusinessIdentity = businessIdentity()): string {
  return `${id.legalName}, CR ${id.crNumber}, ${id.location}`;
}

/** Digits only, with Qatar's country code added to a local 8-digit number. Null when there is no number. */
export function phoneDigits(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "").replace(/^00/, "");
  if (digits.length < 8) return null;
  return digits.length === 8 ? `974${digits}` : digits;
}

/** International display form: "+974 5555 1234" style. Null when there is no number. */
export function formatPhone(phone: string | null | undefined): string | null {
  const digits = phoneDigits(phone);
  if (!digits) return null;
  return digits.startsWith("974") && digits.length === 11 ? `+974 ${digits.slice(3)}` : `+${digits}`;
}

/** WhatsApp deep link, or null when there is no number to link to. */
export function whatsappUrl(phone: string | null | undefined): string | null {
  const digits = phoneDigits(phone);
  return digits ? `https://wa.me/${digits}` : null;
}
