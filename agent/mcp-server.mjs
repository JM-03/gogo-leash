// mcp-server.mjs — Gogo Leash as an MCP server (stdio, JSON-RPC 2.0).
//
// Any MCP client (Claude Desktop, Cursor, an agent harness) can ask the
// vault what it allows before an agent spends anything:
//
//   vault_status       balance, caps, spent in the rolling 24h window, kill switch
//   list_proposals     the agent's pending payments, scored + policy-checked
//   evaluate_proposal  would the leash approve this payment? (no chain write)
//   drill_attack       simulate a forged-signature withdrawal (must come back BLOCKED)
//   tripwire_status    threshold, window, trips so far, is it paused?
//
// READ-ONLY BY DESIGN. This server never moves money: it holds no key and
// exposes no withdraw/pay tool. Spending stays in vault.mjs / leash.mjs
// behind the guardian key. An MCP client can inspect and challenge the
// leash, never bypass it.
//
// Protocol: newline-delimited JSON-RPC 2.0 on stdio (the MCP stdio
// transport), no extra dependencies — the tools are plain functions, so
// they are unit-tested without a transport. Run it with:
//   node agent/mcp-server.mjs
// and point the MCP client at that command (see README, "MCP server").
import { createInterface } from "node:readline";
import { readFileSync, existsSync } from "node:fs";
import { createPublicClient, defineChain, http, parseAbi, parseEther, formatEther, toHex } from "viem";
import { generatePqcKeypair, pqcSign } from "@qorechain/sdk";
import { evaluateProposal } from "./policy.mjs";
import { scoreSeries } from "./signal.mjs";
import { loadDotEnv, loadPolicy, toUqor, fmtQor } from "./common.mjs";
import { pathToFileURL } from "node:url";
import { join } from "node:path";

loadDotEnv();

export const SERVER_NAME = "gogo-leash";
export const SERVER_VERSION = "0.2.0";
export const PROTOCOL_VERSION = "2024-11-05";

const diana = defineChain({
  id: 9800,
  name: "QoreChain Testnet",
  nativeCurrency: { name: "QOR", symbol: "QOR", decimals: 18 },
  rpcUrls: { default: { http: ["https://evm-testnet.qore.host"] } },
});

const vaultAbi = parseAbi([
  "function guardian() view returns (address)",
  "function nonce() view returns (uint256)",
  "function perTxCap() view returns (uint256)",
  "function dailyCap() view returns (uint256)",
  "function paused() view returns (bool)",
  "function spentInWindowAmount() view returns (uint256)",
  "function tripwirePaused() view returns (bool)",
  "function tripwireTrips() view returns (uint256)",
  "function tripwireThreshold() view returns (uint256)",
  "function tripwireWindow() view returns (uint256)",
  "function withdrawalMessage(address to, uint256 amount, uint256 nonce) view returns (bytes)",
  "function withdraw(address to, uint256 amount, bytes mldsaSignature)",
]);

export const TOOL_DEFS = [
  { name: "vault_status", description: "Live vault state: balance, per-payment and rolling-24h caps, spent in the window, kill switch, tripwire.", inputSchema: { type: "object", properties: {}, required: [] } },
  { name: "list_proposals", description: "The agent's pending payment proposals, each scored (signal) and checked against the leash policy, with a READY/SKIP verdict. No chain writes.", inputSchema: { type: "object", properties: {}, required: [] } },
  { name: "evaluate_proposal", description: "Would the leash approve this one payment? Checks allowlist, per-payment cap and daily remainder. No chain writes.", inputSchema: { type: "object", properties: { to: { type: "string", description: "Recipient Cosmos address (qor1...)" }, qor: { type: "number", description: "Amount in QOR" } }, required: ["to", "qor"] } },
  { name: "drill_attack", description: "Simulate a forged ML-DSA-87 signature withdrawal against the live vault. Must come back BLOCKED (BadPqcSignature). Costs nothing; simulation only.", inputSchema: { type: "object", properties: { to: { type: "string", description: "Recipient EVM address (0x...)" }, qor: { type: "number", description: "Amount in QOR" } }, required: ["to", "qor"] } },
  { name: "tripwire_status", description: "Tripwire config and state: how many rejected attempts inside how many seconds trips it, trips so far, is the vault paused by it.", inputSchema: { type: "object", properties: {}, required: [] } },
];

function resolveVaultAddress() {
  const fromEnv = (process.env.VAULT_ADDRESS ?? "").trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(fromEnv)) return fromEnv;
  const f = "broadcast/DeployGogoLeashV2.s.sol/9800/run-latest.json";
  if (!existsSync(f)) return "";
  const run = JSON.parse(readFileSync(f, "utf8"));
  return run.transactions?.find((t) => t.contractName === "GogoLeashVaultV2")?.contractAddress ?? "";
}

/// The chain-facing half, kept behind a small interface so tests can inject
/// a stub instead of hitting the testnet.
export function defaultVault() {
  const address = resolveVaultAddress();
  if (!address) throw new Error("No vault yet: run the forge deploy first (or set VAULT_ADDRESS in .env)");
  const pub = createPublicClient({ chain: diana, transport: http() });
  const read = (fn, args = []) => pub.readContract({ address, abi: vaultAbi, functionName: fn, args });
  return {
    address,
    balance: () => pub.getBalance({ address }),
    read,
    async simulateForgedWithdraw(to, amount) {
      const n = await read("nonce");
      const message = await read("withdrawalMessage", [to, amount, n]);
      const forged = pqcSign(generatePqcKeypair().secretKey, Uint8Array.from(Buffer.from(message.slice(2), "hex")));
      await pub.simulateContract({
        account: "0x0000000000000000000000000000000000000000",
        address, abi: vaultAbi, functionName: "withdraw",
        args: [to, amount, toHex(forged)], gas: 1_000_000n,
      });
    },
  };
}

const fmt = (wei) => `${formatEther(wei)} QOR`;

/// Build the tool implementations. `deps` overrides the defaults (used by tests).
export function createTools(deps = {}) {
  const vault = deps.vault ?? defaultVault();
  const proposalsFile = deps.proposalsFile ?? join(import.meta.dirname, "proposals.json");
  const loadProposals = () => JSON.parse(readFileSync(proposalsFile, "utf8"));

  return {
    async vault_status() {
      const [bal, guardian, n, perTx, daily, spent, paused, tripped, trips, threshold, windowSeconds] = await Promise.all([
        vault.balance(),
        vault.read("guardian"),
        vault.read("nonce"),
        vault.read("perTxCap"),
        vault.read("dailyCap"),
        vault.read("spentInWindowAmount"),
        vault.read("paused"),
        vault.read("tripwirePaused"),
        vault.read("tripwireTrips"),
        vault.read("tripwireThreshold"),
        vault.read("tripwireWindow"),
      ]);
      return {
        vault: vault.address, balance: fmt(bal), guardian,
        withdrawalsSoFar: n.toString(),
        perPaymentCap: fmt(perTx), rolling24hCap: fmt(daily), spentInWindow: fmt(spent),
        killSwitch: paused ? "PAUSED" : "off",
        tripwirePaused: tripped, tripwireTrips: trips.toString(),
        tripwire: `${threshold} rejected attempts inside ${windowSeconds}s trips it`,
      };
    },

    async list_proposals() {
      const policy = loadPolicy();
      let spent = 0n;
      return loadProposals().map((p) => {
        const score = scoreSeries(p.closes ?? [], p.side ?? "long");
        const check = evaluateProposal({ to: p.to, amountUqor: toUqor(p.qor) }, policy, { spentTodayUqor: spent.toString() });
        const ready = score.score >= 60 && check.decision === "APPROVE";
        if (ready) spent += BigInt(toUqor(p.qor));
        return { name: p.name, to: p.to, qor: p.qor, score: score.score, trend: score.trend, verdict: ready ? "READY" : "SKIP", leash: `${check.decision} — ${check.reason}` };
      });
    },

    async evaluate_proposal({ to, qor }) {
      if (typeof to !== "string" || typeof qor !== "number" || !(qor > 0)) {
        throw new Error("evaluate_proposal needs { to: string, qor: number > 0 }");
      }
      const policy = loadPolicy();
      const check = evaluateProposal({ to, amountUqor: toUqor(qor) }, policy, { spentTodayUqor: "0" });
      return { to, qor, decision: check.decision, reason: check.reason, policy: { perTxQor: fmtQor(policy.perTxUqor), dailyQor: fmtQor(policy.dailyUqor), allowlist: policy.allowlist } };
    },

    async drill_attack({ to, qor }) {
      if (typeof to !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(to) || typeof qor !== "number" || !(qor > 0)) {
        throw new Error("drill_attack needs { to: 0x address, qor: number > 0 }");
      }
      try {
        await vault.simulateForgedWithdraw(to, parseEther(String(qor)));
        return { result: "UNEXPECTED-PASS", to, qor, note: "the simulation passed — the vault did not block the attack" };
      } catch (e) {
        const reason = e?.data?.errorName ?? e?.reason ?? e?.shortMessage ?? String(e);
        return { result: "BLOCKED", to, qor, reason };
      }
    },

    async tripwire_status() {
      const [paused, tripped, trips, threshold, windowSeconds] = await Promise.all([
        vault.read("paused"),
        vault.read("tripwirePaused"),
        vault.read("tripwireTrips"),
        vault.read("tripwireThreshold"),
        vault.read("tripwireWindow"),
      ]);
      return { paused, tripwirePaused: tripped, tripsSoFar: trips.toString(), threshold: threshold.toString(), windowSeconds: windowSeconds.toString() };
    },
  };
}

function textResult(value) {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function rpcError(id, code, message) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

/// One JSON-RPC message in, one response out (or null for notifications).
/// Pure enough to test without a transport.
export async function handleMessage(msg, tools) {
  if (msg?.jsonrpc !== "2.0" || typeof msg?.method !== "string") {
    return rpcError(msg?.id, -32600, "Invalid Request: expected JSON-RPC 2.0 with a method");
  }
  const isNotification = msg.id === undefined || msg.id === null;
  try {
    switch (msg.method) {
      case "initialize":
        return isNotification ? null : { jsonrpc: "2.0", id: msg.id, result: { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: { name: SERVER_NAME, version: SERVER_VERSION } } };
      case "ping":
        return isNotification ? null : { jsonrpc: "2.0", id: msg.id, result: {} };
      case "tools/list":
        return isNotification ? null : { jsonrpc: "2.0", id: msg.id, result: { tools: TOOL_DEFS } };
      case "tools/call": {
        const name = msg.params?.name;
        const fn = tools[name];
        if (typeof fn !== "function") {
          return isNotification ? null : rpcError(msg.id, -32602, `Unknown tool: ${String(name)}`);
        }
        const result = await fn(msg.params?.arguments ?? {});
        return isNotification ? null : { jsonrpc: "2.0", id: msg.id, result: textResult(result) };
      }
      default:
        if (msg.method.startsWith("notifications/")) return null;
        return isNotification ? null : rpcError(msg.id, -32601, `Method not found: ${msg.method}`);
    }
  } catch (e) {
    return isNotification ? null : rpcError(msg.id, -32603, String(e?.message ?? e));
  }
}

// stdio transport: one JSON object per line in, one per line out.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const tools = createTools();
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on("line", async (line) => {
    if (!line.trim()) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      process.stdout.write(`${JSON.stringify(rpcError(null, -32700, "Parse error"))}\n`);
      return;
    }
    const res = await handleMessage(msg, tools);
    if (res) process.stdout.write(`${JSON.stringify(res)}\n`);
  });
}
