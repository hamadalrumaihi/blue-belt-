import { test } from "node:test";
import assert from "node:assert/strict";
import { approvalDecision, parseSale, validateApprovalInput } from "../src/pictime.mjs";

const input = { orderRef: "1484532733", amountMinor: 6000, currency: "QAR" };
const pending = { orderRef: input.orderRef, amountMinor: 6000, currency: "QAR", digital: true, pending: true, shipped: false, approveVisible: true };
test("only an exact paid-order match can reach the approval click", () => {
  assert.equal(approvalDecision(input, pending).action, "approve");
  for (const change of [{orderRef:"1484521766"}, {amountMinor:5999}, {currency:"USD"}, {digital:false}, {pending:false}, {approveVisible:false}]) {
    assert.equal(approvalDecision(input, {...pending,...change}).action, "reject");
  }
});
test("a shipped order is idempotent; missing approve does not imply success", () => {
  assert.equal(approvalDecision(input, {...pending,pending:false,shipped:true,approveVisible:false}).action, "already_shipped");
  assert.equal(approvalDecision(input, {...pending,pending:false,approveVisible:false}).action, "reject");
});
test("invalid or zero-value commands are rejected", () => {
  assert.equal(validateApprovalInput(input).ok,true);
  for (const change of [{orderRef:"../x"},{orderRef:"PT-7"},{amountMinor:0},{amountMinor:NaN},{amountMinor:60.5},{currency:"qar"}]) {
    assert.equal(validateApprovalInput({...input,...change}).ok,false);
  }
});
test("sale parsing preserves exact cents and rejects ambiguous prices", () => {
  assert.equal(parseSale("60.00"),6000);
  assert.equal(parseSale("1,260.50"),126050);
  for (const raw of ["QR 60.00","60,00","1,26.00","60.000",""]) assert.equal(parseSale(raw),null);
});
