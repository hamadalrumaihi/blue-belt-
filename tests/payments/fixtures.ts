import type { PhotoBookingRow } from "@/lib/supabase/database.types";

export const SECRET = "whsec_test_secret_do_not_use";
export const OWNER = "11111111-1111-4111-8111-111111111111";
export const BOOKING_ID = "22222222-2222-4222-8222-222222222222";
export const INVOICE_ID = "6409988";
export const PAYMENT_ID = "07076409988323998875";

export function booking(overrides: Partial<PhotoBookingRow> = {}): PhotoBookingRow {
  return {
    id: BOOKING_ID,
    owner_id: OWNER,
    event_id: null,
    athlete_name: "Test Athlete",
    customer_name: "Test Customer",
    customer_email: "customer@example.com",
    customer_phone: "+97400000000",
    academy: null,
    division: null,
    package_name: "Standard",
    amount_qr: 350,
    currency: "QAR",
    status: "pending",
    provider: "MYFATOORAH",
    provider_invoice_id: INVOICE_ID,
    payment_url: "https://demo.myfatoorah.com/ie/0106230003434",
    paid_at: null,
    refunded_at: null,
    disputed_at: null,
    payment_status_updated_at: null,
    watcher_athlete_id: null,
    notes: null,
    metadata: {},
    booking_type: "tournament_athlete",
    booking_status: "awaiting_payment",
    client_id: null,
    organization_id: null,
    service_id: null,
    lead_id: null,
    session_at: null,
    session_end_at: null,
    location: null,
    payment_mode: "link_later",
    payment_method: null,
    amount_paid_qr: 0,
    manual_paid_at: null,
    details: {},
    contract_document_id: null,
    gallery_id: null,
    assigned_photographer_id: null,
    assigned_videographer_id: null,
    quoted_at: null,
    confirmed_at: null,
    coverage_done_at: null,
    delivered_at: null,
    completed_at: null,
    cancelled_at: null,
    cancel_reason: null,
    public_ref: null,
    created_at: "2026-10-01T00:00:00.000Z",
    updated_at: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

/** Sample from https://docs.myfatoorah.com/docs/webhook-v2-payment-status-data-model (trimmed). */
export function paymentEvent(overrides: { reference?: string; transactionStatus?: string; invoiceStatus?: string; invoiceId?: string; paymentId?: string } = {}) {
  return {
    Event: { Code: 1, Name: "PAYMENT_STATUS_CHANGED", CountryIsoCode: "QAT", CreationDate: "2026-01-04T08:15:00.9500000Z", Reference: overrides.reference ?? "WH-626519" },
    Data: {
      Invoice: {
        Id: overrides.invoiceId ?? INVOICE_ID,
        Status: overrides.invoiceStatus ?? "PAID",
        Reference: "2026000073",
        CreationDate: "2026-01-04T08:14:49.897Z",
        ExpirationDate: "2026-01-04T10:08:36Z",
        UserDefinedField: "",
        ExternalIdentifier: "asdqwd-f13sdf-fasjkz",
        MetaData: { UDF1: "dsa" },
      },
      Transaction: {
        Id: "86781",
        Status: overrides.transactionStatus ?? "SUCCESS",
        PaymentMethod: "VISA/MASTER",
        PaymentId: overrides.paymentId ?? PAYMENT_ID,
        ReferenceId: "600408086781",
        TrackId: "04-01-2026_3239988",
        AuthorizationId: "086781",
        TransactionDate: "2026-01-04T08:15:00.8834074Z",
        ECI: "02",
        Error: { Code: "", Message: "" },
        Card: { Number: "512345xxxxxx0008", Brand: "Mastercard" },
      },
      Customer: { Name: "Anonymous", Mobile: "+974", Email: "" },
      Amount: { BaseCurrency: "QAR", ValueInBaseCurrency: "350", DisplayCurrency: "QAR", ValueInDisplayCurrency: "350", PayCurrency: "QAR", ValueInPayCurrency: "350" },
    },
  };
}

/** Sample from https://docs.myfatoorah.com/docs/webhook-v2-refund-data-model (trimmed). */
export function refundEvent(overrides: { reference?: string; status?: string; invoiceId?: string } = {}) {
  return {
    Event: { Code: 2, Name: "REFUND_STATUS_CHANGED", CountryIsoCode: "QAT", CreationDate: "2025-05-13T06:06:20.4000000Z", Reference: overrides.reference ?? "WH-128044" },
    Data: {
      Refund: { Id: "111147", Reference: "2025000058", Status: overrides.status ?? "REFUNDED", InvoiceId: overrides.invoiceId ?? INVOICE_ID, CreationDate: "2025-05-13T06:06:19.247Z", RefundDate: "2025-05-13T06:06:20.2019805Z", RRN: "513306098825", Comment: "", VendorComment: "" },
      Amount: { BaseCurrency: "QAR", ValueInBaseCurrency: "350", Distribution: { Vendor: "350", Suppliers: [] } },
      ReferencedInvoice: { Id: overrides.invoiceId ?? INVOICE_ID, Reference: "2025042457", PaymentMethod: "VISA/MASTER", BaseCurrency: "QAR", ValueInBaseCurrency: "350", RemainingValueInBaseCurrency: "0" },
    },
  };
}

/** Sample from https://docs.myfatoorah.com/docs/webhook-v2-dispute-data-model (trimmed). */
export function disputeEvent(overrides: { reference?: string; status?: string } = {}) {
  return {
    Event: { Code: 6, Name: "DISPUTE_STATUS_CHANGED", CountryIsoCode: "QAT", CreationDate: "2025-07-08T11:48:50.4330000Z", Reference: overrides.reference ?? "WH-290725" },
    Data: {
      Dispute: { Type: "CHARGEBACK", Status: overrides.status ?? "PENDING", CreatedDate: "2025-07-08T11:48:50.4005403Z", ChargeBackType: "General", Reason: "CreditNotProcessed", DisputeTransactionId: 112, InvoiceTransactionId: 2825348 },
      Invoice: { Id: INVOICE_ID, Status: "PAID", Reference: "2025059298", CreationDate: "2025-07-08T11:46:12.12Z", ExternalIdentifier: "1hGonC7bf2vNuJWuTgCGURYzi6Yu" },
      Transaction: { Id: "203009", Status: "SUCCESS", PaymentMethod: "VISA/MASTER", PaymentId: PAYMENT_ID, ReferenceId: "518911203009", TrackId: "08-07-2025_2825348", AuthorizationId: "993730", TransactionDate: "2025-07-08T11:46:29.853Z", ECI: "02" },
      Customer: { Name: "R", Mobile: "+974", Email: "" },
      Amount: { BaseCurrency: "QAR", ValueInBaseCurrency: "350" },
    },
  };
}
