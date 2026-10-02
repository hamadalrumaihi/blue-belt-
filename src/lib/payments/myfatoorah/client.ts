/**
 * Thin MyFatoorah v2 adapter. No SDK, no caller besides tests and the
 * reconciliation helper yet. Everything returns a typed result; nothing here
 * throws on network or provider failures.
 *
 * Endpoints (https://docs.myfatoorah.com/docs/api-key for base URLs + auth):
 *   POST {base}/v2/SendPayment       https://docs.myfatoorah.com/reference/send-payment
 *   POST {base}/v2/GetPaymentStatus  https://docs.myfatoorah.com/reference/get-payment-status
 * Auth: `Authorization: Bearer <API key>` (portal → Integration Settings → API Key).
 */
import type { Json } from "@/lib/supabase/database.types";

export const MYFATOORAH_PROVIDER = "MYFATOORAH" as const;

export type ProviderErrorCode = "not_configured" | "network" | "timeout" | "http" | "invalid_response" | "provider";
export type ProviderError = { code: ProviderErrorCode; message: string; httpStatus?: number; validationErrors?: string[] };
export type ProviderResult<T> = { ok: true; data: T } | { ok: false; error: ProviderError };

export type CreateInvoiceInput = {
  /** Amount in the account's base currency (QAR for the Qatar account). */
  amount: number;
  customerName: string;
  /** Your id for the booking; comes back as CustomerReference / Invoice.ExternalIdentifier. */
  customerReference: string;
  customerEmail?: string;
  customerMobile?: string;
  /** e.g. "+974" */
  mobileCountryCode?: string;
  displayCurrencyIso?: string;
  callbackUrl?: string;
  errorUrl?: string;
  language?: "EN" | "AR";
  userDefinedField?: string;
  /** "yyyy-MM-ddTHH:mm:ss" per the docs. */
  expiryDate?: string;
};

export type CreateInvoiceOutput = {
  invoiceId: string;
  paymentUrl: string;
  customerReference: string | null;
  raw: Json;
};

export type PaymentStatusKeyType = "InvoiceId" | "PaymentId" | "CustomerReference";
export type GetPaymentStatusInput = { key: string; keyType: PaymentStatusKeyType };

/** Documented values: "InProgress" | "Succss" (sic) | "Failed" | "Canceled" | "Authorize". */
export type ProviderTransactionStatus = string;

export type ProviderTransaction = {
  paymentId: string | null;
  transactionId: string | null;
  status: ProviderTransactionStatus;
  value: number | null;
  currency: string | null;
  transactionDate: string | null;
  errorCode: string | null;
  error: string | null;
  raw: Json;
};

export type PaymentStatusOutput = {
  invoiceId: string;
  /** Documented values: "Pending" | "Paid" | "Canceled". */
  invoiceStatus: string;
  invoiceReference: string | null;
  customerReference: string | null;
  invoiceValue: number | null;
  transactions: ProviderTransaction[];
  raw: Json;
};

export type RefundInput = { invoiceId: string; amount: number; comment?: string };
export type RefundOutput = { refundId: string; raw: Json };

/** Adapter boundary: the rest of the app only talks to this interface. */
export interface PaymentProvider {
  readonly name: typeof MYFATOORAH_PROVIDER;
  createInvoice(input: CreateInvoiceInput): Promise<ProviderResult<CreateInvoiceOutput>>;
  getPaymentStatus(input: GetPaymentStatusInput): Promise<ProviderResult<PaymentStatusOutput>>;
  /** Not implemented yet (MakeRefund); kept optional so callers can feature-detect. */
  refund?(input: RefundInput): Promise<ProviderResult<RefundOutput>>;
}

export type MyFatoorahClientOptions = {
  apiKey: string;
  baseUrl: string;
  /** Injectable for tests; defaults to global fetch. */
  fetch?: typeof fetch;
  timeoutMs?: number;
};

type Envelope = { IsSuccess?: unknown; Message?: unknown; ValidationErrors?: unknown; Data?: unknown };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return typeof v === "string" ? v : String(v);
}
function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function createMyFatoorahClient(opts: MyFatoorahClientOptions): PaymentProvider {
  const baseUrl = opts.baseUrl.replace(/\/+$/, "");
  const doFetch = opts.fetch ?? globalThis.fetch;
  const timeoutMs = opts.timeoutMs ?? 15_000;

  async function post(path: string, body: unknown): Promise<ProviderResult<unknown>> {
    if (!opts.apiKey) return { ok: false, error: { code: "not_configured", message: "MYFATOORAH_API_KEY is not set." } };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await doFetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: { authorization: `Bearer ${opts.apiKey}`, "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
        cache: "no-store",
      });
    } catch (err) {
      const aborted = err instanceof Error && err.name === "AbortError";
      return { ok: false, error: { code: aborted ? "timeout" : "network", message: aborted ? `Timed out after ${timeoutMs}ms.` : "Network error reaching MyFatoorah." } };
    } finally {
      clearTimeout(timer);
    }
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      return { ok: false, error: { code: "invalid_response", message: "MyFatoorah returned a non-JSON body.", httpStatus: res.status } };
    }
    const env = isRecord(json) ? (json as Envelope) : null;
    if (!res.ok || !env || env.IsSuccess !== true) {
      const validationErrors = Array.isArray(env?.ValidationErrors)
        ? env!.ValidationErrors.map((e) => (isRecord(e) ? `${str(e.Name) ?? ""}: ${str(e.Error) ?? ""}` : String(e)))
        : undefined;
      return {
        ok: false,
        error: { code: res.ok ? "provider" : "http", message: str(env?.Message) || `MyFatoorah request failed (${res.status}).`, httpStatus: res.status, validationErrors },
      };
    }
    return { ok: true, data: env.Data };
  }

  return {
    name: MYFATOORAH_PROVIDER,

    async createInvoice(input) {
      const payload: Record<string, unknown> = {
        InvoiceValue: input.amount,
        CustomerName: input.customerName,
        CustomerReference: input.customerReference,
        NotificationOption: "LNK",
        Language: input.language ?? "EN",
      };
      if (input.customerEmail) payload.CustomerEmail = input.customerEmail;
      if (input.customerMobile) payload.CustomerMobile = input.customerMobile;
      if (input.mobileCountryCode) payload.MobileCountryCode = input.mobileCountryCode;
      if (input.displayCurrencyIso) payload.DisplayCurrencyIso = input.displayCurrencyIso;
      if (input.callbackUrl) payload.CallBackUrl = input.callbackUrl;
      if (input.errorUrl) payload.ErrorUrl = input.errorUrl;
      if (input.userDefinedField) payload.UserDefinedField = input.userDefinedField;
      if (input.expiryDate) payload.ExpiryDate = input.expiryDate;

      const res = await post("/v2/SendPayment", payload);
      if (!res.ok) return res;
      const data = isRecord(res.data) ? res.data : null;
      const invoiceId = data ? str(data.InvoiceId) : null;
      const paymentUrl = data ? str(data.InvoiceURL) : null;
      if (!invoiceId || !paymentUrl) return { ok: false, error: { code: "invalid_response", message: "SendPayment response is missing InvoiceId or InvoiceURL." } };
      return { ok: true, data: { invoiceId, paymentUrl, customerReference: data ? str(data.CustomerReference) : null, raw: (res.data ?? null) as Json } };
    },

    async getPaymentStatus(input) {
      const res = await post("/v2/GetPaymentStatus", { Key: input.key, KeyType: input.keyType });
      if (!res.ok) return res;
      const data = isRecord(res.data) ? res.data : null;
      const invoiceId = data ? str(data.InvoiceId) : null;
      const invoiceStatus = data ? str(data.InvoiceStatus) : null;
      if (!data || !invoiceId || !invoiceStatus) return { ok: false, error: { code: "invalid_response", message: "GetPaymentStatus response is missing InvoiceId or InvoiceStatus." } };
      const transactions: ProviderTransaction[] = (Array.isArray(data.InvoiceTransactions) ? data.InvoiceTransactions : []).filter(isRecord).map((t) => ({
        paymentId: str(t.PaymentId),
        transactionId: str(t.TransactionId),
        status: str(t.TransactionStatus) ?? "",
        value: num(t.TransationValue ?? t.TransactionValue),
        currency: str(t.Currency ?? t.PaidCurrency),
        transactionDate: str(t.TransactionDate),
        errorCode: str(t.ErrorCode),
        error: str(t.Error),
        raw: t as Json,
      }));
      return {
        ok: true,
        data: {
          invoiceId,
          invoiceStatus,
          invoiceReference: str(data.InvoiceReference),
          customerReference: str(data.CustomerReference),
          invoiceValue: num(data.InvoiceValue),
          transactions,
          raw: data as Json,
        },
      };
    },
  };
}
