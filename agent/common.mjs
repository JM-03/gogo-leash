// common.mjs — shared helpers for the Gogo Leash CLIs. Key files live in
// ~/.config/gogo-leash/ (mode 0600), never in the repo. Only public testnet
// addresses and amounts are ever printed or logged.
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { EthNativeSigner } from "@qorechain/sdk";

export const CHAIN_ID = "qorechain-diana";
export const REST = process.env.QORE_REST_URL?.trim() || "https://api-testnet.qore.host";
export const RPC = process.env.QORE_RPC_URL?.trim() || "https://rpc-testnet.qore.host";
export const EVM_RPC = "https://evm-testnet.qore.host";
export const EXPLORER = "https://explore.qore.network/tx/";
export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const DIR = process.env.GOGO_DIR ?? join(homedir(), ".config", "gogo-leash");
export const OWNER_ENV = join(DIR, "owner.env");
export const AGENT_ENV = join(DIR, "agent.env");

export const toUqor = (qor) => {
  if (!/^\d+(\.\d{1,6})?$/.test(String(qor))) throw new Error(`amount in QOR, e.g. 1 or 0.5 (got "${qor}")`);
  const [i, f = ""] = String(qor).split(".");
  return (BigInt(i) * 1000000n + BigInt((f + "000000").slice(0, 6))).toString();
};
export const fmtQor = (uqorAmount) => `${(Number(uqorAmount) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 6 })} QOR`;
export const hex = (b) => Buffer.from(b).toString("hex");

// Minimal .env parser (KEY=value, quotes stripped). Never logs values.
export function parseEnvFile(file) {
  if (!existsSync(file)) return {};
  return Object.fromEntries(
    readFileSync(file, "utf8")
      .split("\n")
      .filter((l) => /^[A-Z0-9_]+=/.test(l))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"(.*)"$/, "$1")]),
  );
}

export function loadDotEnv() {
  const env = parseEnvFile(join(REPO_ROOT, ".env"));
  for (const [k, v] of Object.entries(env)) if (!(k in process.env)) process.env[k] = v;
  return env;
}

export function loadPolicy() {
  const raw = JSON.parse(readFileSync(join(REPO_ROOT, "agent", "policy.json"), "utf8"));
  return {
    allowlist: raw.allowlist ?? [],
    perTxUqor: toUqor(raw.perTxQor ?? 1),
    dailyUqor: toUqor(raw.dailyQor ?? 3),
    killSwitch: Boolean(raw.killSwitch),
  };
}

export function writeSecret(file, lines) {
  mkdirSync(DIR, { recursive: true, mode: 0o700 });
  if (existsSync(file)) throw new Error(`${file} already exists; not overwriting`);
  writeFileSync(file, lines.join("\n") + "\n", { mode: 0o600 });
  chmodSync(file, 0o600);
}

export async function getJson(path) {
  const r = await fetch(`${REST}${path}`);
  return r.status === 200 ? await r.json() : null;
}

export async function balanceOf(addr) {
  const b = await getJson(`/cosmos/bank/v1beta1/balances/${addr}`);
  return b?.balances?.find((x) => x.denom === "uqor")?.amount ?? "0";
}

// Sign with the account's keys and broadcast. mode "hybrid" (normal) or
// "classical" (only for the one-time ML-DSA key registration).
//
// Broadcast goes through the Cosmos REST endpoint (POST
// /cosmos/tx/v1beta1/txs), NOT the CometBFT RPC: the public RPC
// (rpc-testnet.qore.host) closes CosmJS connections from this VM
// ("fetch failed, other side closed") while plain REST + curl work fine.
// The signer builds the TxRaw locally; REST only submits the bytes.
async function broadcastTxRest(txRawBytes) {
  const r = await fetch(`${REST}/cosmos/tx/v1beta1/txs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tx_bytes: Buffer.from(txRawBytes).toString("base64"), mode: "BROADCAST_MODE_SYNC" }),
  });
  const j = await r.json();
  if (!r.ok || j.tx_response?.txhash === undefined) {
    throw new Error(`REST broadcast failed: HTTP ${r.status} ${JSON.stringify(j).slice(0, 300)}`);
  }
  return j.tx_response;
}

export async function broadcast(acc, messages, memo, mode = "hybrid") {
  const a = await getJson(`/cosmos/auth/v1beta1/accounts/${acc.cosmos}`);
  const base = a?.account?.base_account ?? a?.account ?? {};
  const signer = new EthNativeSigner(acc, { signMode: mode, rest: REST });
  // No simulation (that needed the broken RPC transport): use the generous
  // default gas the old code fell back to anyway.
  const gasLimit = 800000;
  const fee = { amount: [{ denom: "uqor", amount: String(Math.ceil(gasLimit * 0.15)) }], gas: String(gasLimit) };
  const signBytesVersion = await signer.resolveSignBytesVersion(CHAIN_ID);
  const { txRawBytes } = signer.sign({
    chainId: CHAIN_ID,
    accountNumber: BigInt(base.account_number ?? 0),
    sequence: BigInt(base.sequence ?? 0),
    memo,
    messages,
    fee,
    signBytesVersion,
  });
  const submitted = await broadcastTxRest(txRawBytes);
  const hash = submitted.txhash;
  // Poll until the tx lands in a block (same endpoint onChain uses).
  for (let i = 0; i < 20; i++) {
    const t = await getJson(`/cosmos/tx/v1beta1/txs/${hash}`);
    if (t?.tx_response) {
      const tr = t.tx_response;
      return {
        transactionHash: hash,
        code: Number(tr.code),
        height: Number(tr.height),
        gasUsed: BigInt(tr.gas_used ?? 0),
        gasWanted: BigInt(tr.gas_wanted ?? 0),
        rawLog: tr.raw_log ?? "",
      };
    }
    await new Promise((s) => setTimeout(s, 3000));
  }
  return { transactionHash: hash, code: Number(submitted.code ?? 0), rawLog: submitted.raw_log ?? "" };
}

// The chain's own record of a transaction: code + hybrid PQ check.
export async function onChain(hash) {
  for (let i = 0; i < 20; i++) {
    const t = await getJson(`/cosmos/tx/v1beta1/txs/${hash}`);
    if (t) {
      const ev = t.tx_response.events
        .filter((e) => e.type === "pqc_hybrid_verify")
        .map((e) => Object.fromEntries(e.attributes.map((x) => [x.key, x.value])));
      return { code: t.tx_response.code, events: t.tx_response.events, hybrid: ev.some((e) => e.status === "verified") };
    }
    await new Promise((s) => setTimeout(s, 3000));
  }
  return null;
}
