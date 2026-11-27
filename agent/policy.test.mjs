// Policy engine tests — no chain, no keys.
import test from "node:test";
import assert from "node:assert/strict";
import { evaluateProposal, formatQor } from "./policy.mjs";

const policy = {
  allowlist: ["qor1vendor0000000000000000000000000000000a"],
  perTxUqor: "1000000",
  dailyUqor: "3000000",
  killSwitch: false,
};
const fresh = () => ({ spentTodayUqor: "0" });

test("approves a payment inside every limit", () => {
  const r = evaluateProposal({ to: "qor1vendor0000000000000000000000000000000a", amountUqor: "500000" }, policy, fresh());
  assert.equal(r.decision, "APPROVE");
});

test("refuses when the kill switch is on", () => {
  const r = evaluateProposal({ to: "qor1vendor0000000000000000000000000000000a", amountUqor: "100" }, { ...policy, killSwitch: true }, fresh());
  assert.equal(r.decision, "REFUSE");
  assert.match(r.reason, /kill switch/);
});

test("refuses a recipient who is not allowlisted", () => {
  const r = evaluateProposal({ to: "qor1stranger00000000000000000000000000000x", amountUqor: "100" }, policy, fresh());
  assert.equal(r.decision, "REFUSE");
  assert.match(r.reason, /not allowlisted/);
});

test("refuses an amount over the per-payment cap", () => {
  const r = evaluateProposal({ to: "qor1vendor0000000000000000000000000000000a", amountUqor: "1000001" }, policy, fresh());
  assert.equal(r.decision, "REFUSE");
  assert.match(r.reason, /per-payment cap/);
});

test("refuses an amount over the daily remainder", () => {
  const r = evaluateProposal(
    { to: "qor1vendor0000000000000000000000000000000a", amountUqor: "1000000" },
    policy,
    { spentTodayUqor: "2500000" },
  );
  assert.equal(r.decision, "REFUSE");
  assert.match(r.reason, /daily remainder/);
});

test("accepts the exact daily remainder", () => {
  const r = evaluateProposal(
    { to: "qor1vendor0000000000000000000000000000000a", amountUqor: "500000" },
    policy,
    { spentTodayUqor: "2500000" },
  );
  assert.equal(r.decision, "APPROVE");
});

test("refuses zero and negative amounts", () => {
  assert.equal(evaluateProposal({ to: "qor1vendor0000000000000000000000000000000a", amountUqor: "0" }, policy, fresh()).decision, "REFUSE");
});

test("formatQor prints whole and fractional QOR", () => {
  assert.equal(formatQor("1000000"), "1 QOR");
  assert.equal(formatQor("500000"), "0.5 QOR");
  assert.equal(formatQor("2300000"), "2.3 QOR");
});
