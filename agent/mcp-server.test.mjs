import test from "node:test";
import assert from "node:assert/strict";
import { handleMessage, createTools, TOOL_DEFS, SERVER_NAME, SERVER_VERSION } from "./mcp-server.mjs";

const ETHER = 10n ** 18n;
const stubVault = {
  address: "0x9C254f3bBAFa6d4C03196c8C65C0d30F2cD57B0f",
  balance: async () => 700000000000000000n,
  read: async (fn) => ({
    guardian: "0x7976B342501928c2b5E8f9cd70f596bfF19555f9",
    nonce: 3n,
    perTxCap: 1n * ETHER,
    dailyCap: 3n * ETHER,
    spentInWindowAmount: 2300000000000000000n,
    paused: false,
    tripwirePaused: false,
    tripwireTrips: 0n,
    tripwireThreshold: 3n,
    tripwireWindow: 3600n,
  }[fn]),
  simulateForgedWithdraw: async () => {
    const e = new Error("execution reverted");
    e.data = { errorName: "BadPqcSignature" };
    throw e;
  },
};

const tools = createTools({ vault: stubVault });
const GAS_COSMOS = "qor1pk2muymrj4ps4ual2h48qf3rvz9n2f8aulgluv";
const STRANGER_COSMOS = "qor1wynhculpr7aphl2l90j53lkvu54p5yurgp4qru";

const call = (method, params, id = 1) => handleMessage({ jsonrpc: "2.0", id, method, params }, tools);
const toolResult = (res) => JSON.parse(res.result.content[0].text);

test("initialize returns the server identity", async () => {
  const res = await call("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "0" } });
  assert.equal(res.result.serverInfo.name, SERVER_NAME);
  assert.equal(res.result.serverInfo.version, SERVER_VERSION);
  assert.ok(res.result.capabilities.tools);
});

test("tools/list returns all five tools", async () => {
  const res = await call("tools/list", {});
  assert.deepEqual(res.result.tools.map((t) => t.name), TOOL_DEFS.map((t) => t.name));
  assert.equal(res.result.tools.length, 5);
});

test("list_proposals scores the real proposals file", async () => {
  const rows = toolResult(await call("tools/call", { name: "list_proposals", arguments: {} }));
  assert.equal(rows.length, 5);
  assert.equal(rows[0].name, "Server hosting — November");
  assert.equal(rows[0].verdict, "READY");
  assert.equal(rows[2].verdict, "SKIP"); // unknown sender, 5 QOR
  assert.equal(rows[4].verdict, "SKIP"); // 0.9 QOR over the daily remainder
});

test("evaluate_proposal approves the vendor and refuses the stranger", async () => {
  const ok = toolResult(await call("tools/call", { name: "evaluate_proposal", arguments: { to: GAS_COSMOS, qor: 0.5 } }));
  assert.equal(ok.decision, "APPROVE");
  const no = toolResult(await call("tools/call", { name: "evaluate_proposal", arguments: { to: STRANGER_COSMOS, qor: 0.5 } }));
  assert.notEqual(no.decision, "APPROVE");
});

test("vault_status reports the stub vault", async () => {
  const st = toolResult(await call("tools/call", { name: "vault_status", arguments: {} }));
  assert.equal(st.balance, "0.7 QOR");
  assert.equal(st.spentInWindow, "2.3 QOR");
  assert.equal(st.withdrawalsSoFar, "3");
  assert.equal(st.killSwitch, "off");
});

test("drill_attack comes back BLOCKED with the right reason", async () => {
  const d = toolResult(await call("tools/call", { name: "drill_attack", arguments: { to: "0x0d95bE136395430Af3BF55Ea702623608B3524FD", qor: 0.5 } }));
  assert.equal(d.result, "BLOCKED");
  assert.equal(d.reason, "BadPqcSignature");
});

test("tripwire_status reports the stub config", async () => {
  const t = toolResult(await call("tools/call", { name: "tripwire_status", arguments: {} }));
  assert.equal(t.threshold, "3");
  assert.equal(t.windowSeconds, "3600");
  assert.equal(t.tripsSoFar, "0");
});

test("unknown tool is a -32602 error", async () => {
  const res = await call("tools/call", { name: "withdraw", arguments: {} });
  assert.equal(res.error.code, -32602);
});

test("unknown method is a -32601 error, notifications get no reply", async () => {
  const res = await call("resources/list", {});
  assert.equal(res.error.code, -32601);
  const note = await handleMessage({ jsonrpc: "2.0", method: "notifications/initialized" }, tools);
  assert.equal(note, null);
});

test("a message without jsonrpc 2.0 is a -32600 error", async () => {
  const res = await handleMessage({ id: 1, method: "ping" }, tools);
  assert.equal(res.error.code, -32600);
});
