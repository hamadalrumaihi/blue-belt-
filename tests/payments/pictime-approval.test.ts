import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { approvalCommand, runPictimeApprovals } from "@/lib/payments/pictime-approval";
import { orderRow } from "../helpers/order-row";
import { FakeSupabase } from "./fake-supabase";
vi.mock("server-only", () => ({}));
beforeEach(() => vi.stubEnv("MYFATOORAH_BASE_URL", "https://api-qa.myfatoorah.com"));
afterEach(() => vi.unstubAllEnvs());

const paid = () => orderRow({ external_ref: "1484532733", pictime_order_id: "1484532733", amount_qr: 60, currency: "QAR", payment_state: "paid", provider: "MYFATOORAH", provider_invoice_id: "123", metadata: {payment_confirmed_source:"MYFATOORAH", payment_verified:{invoice_id:"123",payment_id:"pay-1",amount:60,currency:"QAR"}} });
const provider = {getPaymentStatus:async()=>({ok:true as const,data:{invoiceId:"123",invoiceStatus:"Paid",invoiceReference:null,customerReference:paid().id,invoiceValue:60,transactions:[{paymentId:"pay-1",transactionId:null,status:"Succss",value:60,currency:"QAR",transactionDate:null,errorCode:null,error:null,raw:{}}],raw:{}}})};
it("only current provider-verified payments yield approval commands", () => {
  expect(approvalCommand(paid())).toEqual({orderRef:"1484532733",amountMinor:6000,currency:"QAR"});
  for (const row of [ {...paid(),payment_state:"pending"}, {...paid(),metadata:{}}, {...paid(),amount_qr:61}, {...paid(),provider_invoice_id:"other"}, {...paid(),external_ref:"different"}, {...paid(),currency:"USD"}, {...paid(),fulfilled_at:"2026-10-12"} ]) expect(approvalCommand(row)).toBeNull();
});
it("dry run leaves fulfillment pending; only confirmed delivery persists it", async () => {
  const db = new FakeSupabase(); db.seed("photo_orders", [paid()] as unknown as Record<string,unknown>[]);
  const config = {enabled:true,url:"https://worker.example",token:"worker-token",orderRefs:["1484532733"]};
  let clock = "2026-10-12T10:00:00Z";
  const run = (state: string) => runPictimeApprovals({supabase:db.asClient(),provider,now:()=>new Date(clock),config,fetcher: async () => new Response(JSON.stringify({ok:true,state,orderRef:"1484532733"}))});
  expect(await run("dry_run")).toMatchObject({dryRun:1,shipped:0});
  expect(db.tables.photo_orders[0].fulfilled_at).toBeNull();
  clock = "2026-10-12T10:05:00Z";
  expect(await run("shipped")).toMatchObject({shipped:1});
  expect(db.tables.photo_orders[0].approved_in_pictime_at).toBe("2026-10-12T10:05:00.000Z");
  expect(db.tables.photo_notification_deliveries.length).toBe(2);
});
it("failed or mismatched worker responses never mark delivery complete", async () => {
  for (const body of [{ok:false,code:"SESSION_REQUIRED"}, {ok:true,state:"shipped",orderRef:"wrong"}]) {
    const db = new FakeSupabase(); db.seed("photo_orders", [paid()] as unknown as Record<string,unknown>[]);
    const out = await runPictimeApprovals({supabase:db.asClient(),provider,config:{enabled:true,url:"https://worker.example",token:"worker-token",orderRefs:["1484532733"]},fetcher:async()=>new Response(JSON.stringify(body))});
    expect(out.failed).toBe(1); expect(db.tables.photo_orders[0].fulfilled_at).toBeNull();
  }
});
it("concurrent cron ticks claim an order once", async () => {
  const db = new FakeSupabase(); db.seed("photo_orders", [paid()] as unknown as Record<string,unknown>[]);
  let release!: () => void;
  let started!: () => void;
  const entered = new Promise<void>(r => { started = r; });
  const gate = new Promise<void>(r => { release = r; });
  let calls = 0;
  const deps = {supabase:db.asClient(),provider,config:{enabled:true,url:"https://worker.example",token:"worker-token",orderRefs:["1484532733"]},fetcher:async()=>{calls++; started(); await gate; return new Response(JSON.stringify({ok:true,state:"dry_run",orderRef:"1484532733"}));}};
  const first = runPictimeApprovals(deps); await entered;
  await runPictimeApprovals(deps); release(); await first;
  expect(calls).toBe(1);
});
it("sandbox payments cannot approve a live gallery order", async () => {
  vi.stubEnv("MYFATOORAH_BASE_URL", "https://apitest.myfatoorah.com");
  const db = new FakeSupabase(); db.seed("photo_orders", [paid()] as unknown as Record<string,unknown>[]);
  await expect(runPictimeApprovals({supabase:db.asClient(),provider,config:{enabled:true,url:"https://worker.example",token:"worker-token",orderRefs:["1484532733"]}})).rejects.toThrow("Sandbox payments");
});

it("a production inquiry with a mismatched buyer cannot reach the browser", async () => {
  const db = new FakeSupabase(); db.seed("photo_orders", [paid()] as unknown as Record<string,unknown>[]);
  let dispatched = false;
  const wrongProvider = {getPaymentStatus: async () => { const r = await provider.getPaymentStatus(); return {...r,data:{...r.data,customerReference:"other"}}; }};
  const out = await runPictimeApprovals({supabase:db.asClient(),provider:wrongProvider,config:{enabled:true,url:"https://worker.example",token:"worker-token",orderRefs:["1484532733"]},fetcher:async()=>{dispatched=true;return new Response("{}");}});
  expect(out.failed).toBe(1); expect(dispatched).toBe(false); expect(db.tables.photo_orders[0].fulfilled_at).toBeNull();
});
