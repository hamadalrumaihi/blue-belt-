import { describe, expect, it, vi } from "vitest";
import { createMyFatoorahClient } from "@/lib/payments/myfatoorah/client";

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("createMyFatoorahClient", () => {
  it("createInvoice posts to /v2/SendPayment with a Bearer key and maps the response", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ IsSuccess: true, Message: "Invoice Created Successfully!", ValidationErrors: null, Data: { InvoiceId: 300034, InvoiceURL: "https://demo.myfatoorah.com/ie/0106230003434", CustomerReference: "bk-1", UserDefinedField: null } }));
    const client = createMyFatoorahClient({ apiKey: "sk_test", baseUrl: "https://apitest.myfatoorah.com/", fetch: fetchMock as unknown as typeof fetch });
    const res = await client.createInvoice({ amount: 350, customerName: "A", customerReference: "bk-1", displayCurrencyIso: "QAR", callbackUrl: "https://x/ok", errorUrl: "https://x/err" });
    expect(res).toEqual({ ok: true, data: { invoiceId: "300034", paymentUrl: "https://demo.myfatoorah.com/ie/0106230003434", customerReference: "bk-1", raw: expect.any(Object) } });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://apitest.myfatoorah.com/v2/SendPayment");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer sk_test");
    expect(JSON.parse(init.body as string)).toMatchObject({ InvoiceValue: 350, CustomerName: "A", CustomerReference: "bk-1", NotificationOption: "LNK", DisplayCurrencyIso: "QAR", CallBackUrl: "https://x/ok", ErrorUrl: "https://x/err" });
  });

  it("getPaymentStatus posts to /v2/GetPaymentStatus and normalises transactions", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        IsSuccess: true,
        Message: "",
        ValidationErrors: null,
        Data: { InvoiceId: 5822968, InvoiceStatus: "Paid", InvoiceReference: "2025051959", CustomerReference: "bk-1", InvoiceValue: 0.51, InvoiceTransactions: [{ TransactionDate: "2025-06-11T11:39:20", PaymentId: "0707", TransactionId: "128633", TransactionStatus: "Succss", TransationValue: "0.510", Currency: "KD", Error: null, ErrorCode: "" }] },
      }),
    );
    const client = createMyFatoorahClient({ apiKey: "sk_test", baseUrl: "https://apitest.myfatoorah.com", fetch: fetchMock as unknown as typeof fetch });
    const res = await client.getPaymentStatus({ key: "5822968", keyType: "InvoiceId" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data).toMatchObject({ invoiceId: "5822968", invoiceStatus: "Paid", customerReference: "bk-1", invoiceValue: 0.51 });
    expect(res.data.transactions[0]).toMatchObject({ paymentId: "0707", transactionId: "128633", status: "Succss", value: 0.51, currency: "KD" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://apitest.myfatoorah.com/v2/GetPaymentStatus");
    expect(JSON.parse(init.body as string)).toEqual({ Key: "5822968", KeyType: "InvoiceId" });
  });

  it("returns typed errors instead of throwing: provider validation, HTTP, non-JSON, network, timeout, no key", async () => {
    const mk = (f: () => Promise<Response>) => createMyFatoorahClient({ apiKey: "sk", baseUrl: "https://apitest.myfatoorah.com", fetch: f as unknown as typeof fetch, timeoutMs: 50 });
    const input = { key: "1", keyType: "InvoiceId" as const };

    expect(await mk(async () => jsonResponse({ IsSuccess: false, Message: "Invalid data", ValidationErrors: [{ Name: "Key", Error: "required" }], Data: null })).getPaymentStatus(input)).toEqual({ ok: false, error: { code: "provider", message: "Invalid data", httpStatus: 200, validationErrors: ["Key: required"] } });
    expect(await mk(async () => jsonResponse({ Message: "Unauthorized" }, 401)).getPaymentStatus(input)).toMatchObject({ ok: false, error: { code: "http", httpStatus: 401 } });
    expect(await mk(async () => new Response("<html>", { status: 502 })).getPaymentStatus(input)).toMatchObject({ ok: false, error: { code: "invalid_response", httpStatus: 502 } });
    expect(await mk(async () => { throw new TypeError("fetch failed"); }).getPaymentStatus(input)).toMatchObject({ ok: false, error: { code: "network" } });
    expect(await mk(() => new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), 10))).getPaymentStatus(input)).toMatchObject({ ok: false, error: { code: "timeout" } });
    expect(await createMyFatoorahClient({ apiKey: "", baseUrl: "https://apitest.myfatoorah.com" }).getPaymentStatus(input)).toMatchObject({ ok: false, error: { code: "not_configured" } });
  });

  it("flags a success envelope that lacks the fields we rely on", async () => {
    const client = createMyFatoorahClient({ apiKey: "sk", baseUrl: "https://apitest.myfatoorah.com", fetch: (async () => jsonResponse({ IsSuccess: true, Data: { InvoiceId: 1 } })) as unknown as typeof fetch });
    expect(await client.createInvoice({ amount: 1, customerName: "A", customerReference: "r" })).toMatchObject({ ok: false, error: { code: "invalid_response" } });
  });
});
