import test from "node:test";
import assert from "node:assert/strict";
import { generatePqcKeypair, pqcSign, pqcVerify } from "@qorechain/sdk";
import { invoiceMessage, signInvoice, verifyInvoice } from "./vendor-sig.mjs";

const VAULT = "0x9C254f3bBAFa6d4C03196c8C65C0d30F2cD57B0f";
const VENDOR_EVM = "0x0d95bE136395430Af3BF55Ea702623608B3524FD";
const VENDOR_COSMOS = "qor1pk2muymrj4ps4ual2h48qf3rvz9n2f8aulgluv";
const AMOUNT = 800000000000000000n; // 0.8 QOR

test("invoice message is deterministic and binds every field", () => {
  const hex = (m) => Buffer.from(m).toString("hex");
  const a = invoiceMessage({ vault: VAULT, vendorEvm: VENDOR_EVM, amountWei: AMOUNT, invoiceId: "INV-001" });
  const b = invoiceMessage({ vault: VAULT, vendorEvm: VENDOR_EVM, amountWei: AMOUNT, invoiceId: "INV-001" });
  assert.equal(hex(a), hex(b));
  assert.notEqual(hex(a), hex(invoiceMessage({ vault: VAULT, vendorEvm: VENDOR_EVM, amountWei: AMOUNT, invoiceId: "INV-002" })));
  assert.notEqual(hex(a), hex(invoiceMessage({ vault: VAULT, vendorEvm: VENDOR_EVM, amountWei: AMOUNT + 1n, invoiceId: "INV-001" })));
  assert.notEqual(hex(a), hex(invoiceMessage({ vault: "0x1111111111111111111111111111111111111111", vendorEvm: VENDOR_EVM, amountWei: AMOUNT, invoiceId: "INV-001" })));
});

test("sign + local verify round-trips with a real ML-DSA-87 keypair", () => {
  const kp = generatePqcKeypair();
  const message = invoiceMessage({ vault: VAULT, vendorEvm: VENDOR_EVM, amountWei: AMOUNT, invoiceId: "INV-001" });
  const sig = signInvoice(kp.secretKey, message);
  assert.equal(pqcVerify(kp.publicKey, message, Buffer.from(sig.slice(2), "hex")), true);
  // Same signature, different invoice: dead.
  const other = invoiceMessage({ vault: VAULT, vendorEvm: VENDOR_EVM, amountWei: AMOUNT, invoiceId: "INV-002" });
  assert.equal(pqcVerify(kp.publicKey, other, Buffer.from(sig.slice(2), "hex")), false);
  // Same message, different key: dead.
  const kp2 = generatePqcKeypair();
  assert.equal(pqcVerify(kp2.publicKey, message, Buffer.from(sig.slice(2), "hex")), false);
  // Signing with the SDK directly matches signInvoice.
  assert.equal(sig, `0x${Buffer.from(pqcSign(kp.secretKey, message)).toString("hex")}`);
});

const stubInput = (sig) => ({
  vendorCosmos: VENDOR_COSMOS, vendorEvm: VENDOR_EVM, vault: VAULT,
  amountWei: AMOUNT, invoiceId: "INV-001", signature: sig,
});
const stubDeps = (over = {}) => ({
  fetchStatus: async () => ({ registered: true }),
  pubkey: new Uint8Array(2592).fill(7),
  verifyLocal: () => true,
  verifyOnChain: async () => true,
  ...over,
});

test("verifyInvoice is valid only when local AND on-chain both pass", async () => {
  const sig = "0x" + "ab".repeat(4627);
  assert.equal((await verifyInvoice(stubInput(sig), stubDeps())).valid, true);
  assert.equal((await verifyInvoice(stubInput(sig), stubDeps({ verifyLocal: () => false }))).valid, false);
  assert.equal((await verifyInvoice(stubInput(sig), stubDeps({ verifyOnChain: async () => false }))).valid, false);
});

test("verifyInvoice refuses an unregistered vendor key", async () => {
  const sig = "0x" + "ab".repeat(4627);
  const res = await verifyInvoice(stubInput(sig), stubDeps({
    fetchStatus: async () => ({ registered: false }),
    pubkey: undefined,
  }));
  assert.equal(res.valid, false);
  assert.match(res.reason, /not registered/);
});
