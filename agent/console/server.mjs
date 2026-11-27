// console/server.mjs — tiny read-only web console for Gogo Leash.
// Serves agent/console/index.html and /api/status (policy, balances, chain
// rules, audit tail). Never serves keys. Run: pnpm console
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readAuditTail } from "../audit.mjs";
import { loadPolicy, balanceOf, getJson, OWNER_ENV, AGENT_ENV, parseEnvFile, REST } from "../common.mjs";
import { deriveUnifiedAccount } from "@qorechain/sdk";
import { fetchSpendingRules, fetchAuthenticators } from "@qorechain/sdk";
import { createPublicClient, defineChain, http, parseAbi, formatEther } from "viem";

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
  "function spentTodayAmount() view returns (uint256)",
]);

async function vaultState(address) {
  if (!address) return null;
  try {
    const pub = createPublicClient({ chain: diana, transport: http() });
    const [bal, guardian, n, perTx, daily, spent, paused] = await Promise.all([
      pub.getBalance({ address }),
      pub.readContract({ address, abi: vaultAbi, functionName: "guardian" }),
      pub.readContract({ address, abi: vaultAbi, functionName: "nonce" }),
      pub.readContract({ address, abi: vaultAbi, functionName: "perTxCap" }),
      pub.readContract({ address, abi: vaultAbi, functionName: "dailyCap" }),
      pub.readContract({ address, abi: vaultAbi, functionName: "spentTodayAmount" }),
      pub.readContract({ address, abi: vaultAbi, functionName: "paused" }),
    ]);
    return {
      address,
      balanceQor: formatEther(bal),
      guardian,
      withdrawals: n.toString(),
      perTxQor: formatEther(perTx),
      dailyQor: formatEther(daily),
      spentTodayQor: formatEther(spent),
      paused,
    };
  } catch (e) {
    return { address, error: String(e?.message ?? e) };
  }
}

const DIR = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.CONSOLE_PORT ?? 8787);

async function status() {
  const policy = loadPolicy();
  const out = { policy, owner: null, gas: null, rules: [], audit: readAuditTail(20) };
  try {
    if (existsSync(OWNER_ENV)) {
      const o = await deriveUnifiedAccount(parseEnvFile(OWNER_ENV).QORE_MNEMONIC, 0);
      out.owner = { address: o.cosmos, balanceUqor: await balanceOf(o.cosmos) };
      const rules = await fetchSpendingRules({ rest: REST, address: o.cosmos });
      out.rules = rules.rules ?? [];
      const auths = await fetchAuthenticators({ rest: REST, address: o.cosmos });
      out.authenticators = (auths ?? []).map((a) => ({ permissions: a.permissions, revoked: a.revoked, expiryUnix: a.expiryUnix }));
    }
    if (existsSync(AGENT_ENV)) {
      const g = await deriveUnifiedAccount(parseEnvFile(AGENT_ENV).GAS_MNEMONIC, 0);
      out.gas = { address: g.cosmos, balanceUqor: await balanceOf(g.cosmos) };
    }
  } catch (e) {
    out.error = String(e?.message ?? e);
  }
  out.vault = process.env.VAULT_ADDRESS || null;
  out.vaultState = await vaultState(out.vault);
  return out;
}

const server = createServer(async (req, res) => {
  if (req.url === "/api/status") {
    res.writeHead(200, { "content-type": "application/json" });
    // Spending rules carry BigInt limits — stringify them, else the
    // server crashes on the first request once a link exists.
    res.end(JSON.stringify(await status(), (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
    return;
  }
  res.writeHead(200, { "content-type": "text/html" });
  res.end(readFileSync(join(DIR, "index.html"), "utf8"));
});

server.listen(PORT, () => console.log(`gogo-leash console: http://localhost:${PORT}`));
