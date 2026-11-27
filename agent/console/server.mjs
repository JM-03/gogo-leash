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
