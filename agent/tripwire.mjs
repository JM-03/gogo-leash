// tripwire.mjs — the automatic half of the vault v2 tripwire.
//
// The vault cannot count its own rejections: a reverted withdraw() rolls
// back any failure counter written in the same call. So the tripwire is
// split in two, honestly:
//   - on chain: vault.trip(uint256) pauses the vault and records that the
//     tripwire (not a human) fired, plus tripwireThreshold / tripwireWindow.
//   - off chain: this watcher scans recent blocks for withdraw transactions
//     to the vault that REVERTED, and when `threshold` of them land inside
//     `window` seconds it submits trip() itself — no human in the loop.
// The watcher key is the guardian's EVM key (PRIVATE_KEY in .env), the same
// key the vault CLI uses; trip() is guardian-only, so a stolen watcher key
// can at worst pause the vault (fail-closed), never drain it.
//
//   node agent/tripwire.mjs watch [--once]   scan recent blocks, trip if needed
//   node agent/tripwire.mjs status           show the tripwire config + state
//
// --once does one scan and exits (for cron / CI). Without it the watcher
// loops every 60 s. Needs a live EVM window only when it actually trips.
import { createPublicClient, createWalletClient, defineChain, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { existsSync, readFileSync } from "node:fs";
import { audit } from "./audit.mjs";
import { loadDotEnv, EXPLORER } from "./common.mjs";

loadDotEnv();

const diana = defineChain({
  id: 9800,
  name: "QoreChain Testnet",
  nativeCurrency: { name: "QOR", symbol: "QOR", decimals: 18 },
  rpcUrls: { default: { http: ["https://evm-testnet.qore.host"] } },
});

/// First 4 bytes of withdraw(address,uint256,bytes).
export const WITHDRAW_SELECTOR = "0x31f09265";
export const SCAN_BLOCKS = 200;
export const POLL_SECONDS = 60;

const abi = parseAbi([
  "function paused() view returns (bool)",
  "function tripwirePaused() view returns (bool)",
  "function tripwireTrips() view returns (uint256)",
  "function tripwireThreshold() view returns (uint256)",
  "function tripwireWindow() view returns (uint256)",
  "function trip(uint256 failures)",
]);

/// Vault address from .env, else the latest forge deploy. Empty when unknown;
/// commands throw then, but importing this module (e.g. for its pure rule in
/// tests) never throws.
export function resolveVault() {
  const fromEnv = (process.env.VAULT_ADDRESS ?? "").trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(fromEnv)) return fromEnv;
  const f = "broadcast/DeployGogoLeash.s.sol/9800/run-latest.json";
  if (!existsSync(f)) return "";
  const run = JSON.parse(readFileSync(f, "utf8"));
  return run.transactions?.find((t) => t.contractName === "GogoLeashVaultV2")?.contractAddress
    ?? run.transactions?.find((t) => t.contractName === "GogoLeashVault")?.contractAddress ?? "";
}

function requireVault() {
  const v = resolveVault();
  if (!v) throw new Error("No vault yet: run the forge deploy first (or set VAULT_ADDRESS in .env)");
  return v;
}

const pub = createPublicClient({ chain: diana, transport: http() });

/// Pure rule, unit-tested: given observed rejection timestamps (unix seconds,
/// ascending), does the tripwire fire right now?
export function evaluateTripwire(failures, now, threshold, windowSeconds) {
  const cutoff = now - windowSeconds;
  const inWindow = failures.filter((t) => t > cutoff);
  return { fire: inWindow.length >= threshold, count: inWindow.length, windowStart: inWindow.length ? inWindow[0] : null };
}

/// Is this transaction a withdraw() call to the given vault?
export function isWithdrawCall(tx, vaultAddress) {
  return typeof tx?.to === "string"
    && tx.to.toLowerCase() === vaultAddress.toLowerCase()
    && typeof tx.input === "string"
    && tx.input.toLowerCase().startsWith(WITHDRAW_SELECTOR);
}

/// Scan the last SCAN_BLOCKS blocks for reverted withdraw() calls to the
/// vault. Returns their block timestamps (unix seconds, ascending).
export async function scanFailures(client, vaultAddress) {
  const latest = await client.getBlockNumber();
  const from = latest > BigInt(SCAN_BLOCKS) ? latest - BigInt(SCAN_BLOCKS) : 0n;
  const failures = [];
  for (let n = from; n <= latest; n++) {
    const block = await client.getBlock({ blockNumber: n, includeTransactions: true });
    for (const tx of block.transactions) {
      if (!isWithdrawCall(tx, vaultAddress)) continue;
      const receipt = await client.getTransactionReceipt({ hash: tx.hash });
      if (receipt.status === "reverted") failures.push(Number(block.timestamp));
    }
  }
  return failures.sort((a, b) => a - b);
}

async function trip(vaultAddress, failures) {
  const key = process.env.PRIVATE_KEY?.trim();
  if (!key) throw new Error("Set PRIVATE_KEY in .env (guardian EVM key)");
  const wallet = createWalletClient({ account: privateKeyToAccount(key), chain: diana, transport: http() });
  const hash = await wallet.writeContract({ address: vaultAddress, abi, functionName: "trip", args: [BigInt(failures)], gas: 500_000n });
  const r = await pub.waitForTransactionReceipt({ hash });
  console.log(`  TRIPPED  tx ${hash}  ${EXPLORER}${hash}`);
  audit("vault.tripwire", { failures, tx: hash, status: r.status });
  return hash;
}

const commands = {
  async status() {
    const vault = requireVault();
    const [paused, tripped, trips, threshold, windowSeconds] = await Promise.all([
      pub.readContract({ address: vault, abi, functionName: "paused" }),
      pub.readContract({ address: vault, abi, functionName: "tripwirePaused" }),
      pub.readContract({ address: vault, abi, functionName: "tripwireTrips" }),
      pub.readContract({ address: vault, abi, functionName: "tripwireThreshold" }),
      pub.readContract({ address: vault, abi, functionName: "tripwireWindow" }),
    ]);
    console.log(`vault     ${vault}`);
    console.log(`paused    ${paused ? "yes" : "no"}${tripped ? " (by tripwire)" : ""}`);
    console.log(`trips     ${trips} so far`);
    console.log(`tripwire  ${threshold} rejected attempts inside ${windowSeconds}s trips it`);
  },

  async watch(once = false) {
    const vault = requireVault();
    for (;;) {
      const [threshold, windowSeconds, paused] = await Promise.all([
        pub.readContract({ address: vault, abi, functionName: "tripwireThreshold" }),
        pub.readContract({ address: vault, abi, functionName: "tripwireWindow" }),
        pub.readContract({ address: vault, abi, functionName: "paused" }),
      ]);
      if (paused) {
        console.log("vault is paused — watcher stands down (unpause to resume)");
        return;
      }
      const failures = await scanFailures(pub, vault);
      const now = Math.floor(Date.now() / 1000);
      const verdict = evaluateTripwire(failures, now, Number(threshold), Number(windowSeconds));
      console.log(`${new Date().toISOString()}  rejected withdraws in window: ${verdict.count}/${threshold}`);
      if (verdict.fire) {
        console.log(`  TRIPWIRE: ${verdict.count} rejections inside ${windowSeconds}s — pausing the vault`);
        await trip(vault, verdict.count);
        return;
      }
      if (once) return;
      await new Promise((r) => setTimeout(r, POLL_SECONDS * 1000));
    }
  },
};

import { pathToFileURL } from "node:url";

const [cmd = "status", ...args] = process.argv.slice(2);
const run = commands[cmd];
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!run) {
    console.error("Use: status | watch [--once]");
    process.exit(1);
  }
  run(cmd === "watch" && args.includes("--once")).catch((e) => {
    console.error(String(e?.shortMessage ?? e));
    process.exitCode = 1;
  });
}
