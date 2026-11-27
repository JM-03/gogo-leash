// setup-env.mjs — write the repo .env for the throwaway testnet deployer.
// Reads the owner mnemonic from ~/.config/gogo-leash/owner.env (mode 0600)
// and writes .env (gitignored, mode 0600) with QORE_MNEMONIC + PRIVATE_KEY
// (the owner's EVM key, verified to match the owner EVM address).
// Never prints any secret value.
import { writeFileSync, chmodSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { deriveUnifiedAccount } from "@qorechain/sdk";
import { privateKeyToAccount } from "viem/accounts";
import { parseEnvFile, OWNER_ENV } from "../agent/common.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = parseEnvFile(OWNER_ENV);
const acc = await deriveUnifiedAccount(env.QORE_MNEMONIC, 0);
const pkHex = typeof acc.privateKey === "string" ? acc.privateKey : `0x${Buffer.from(acc.privateKey).toString("hex")}`;
if (!/^0x[0-9a-fA-F]{64}$/.test(pkHex)) throw new Error("unexpected privateKey shape");
const check = privateKeyToAccount(pkHex);
if (check.address.toLowerCase() !== acc.evm.toLowerCase()) {
  throw new Error(`derived EVM address ${check.address} != owner ${acc.evm}; refusing to write .env`);
}
const lines = [
  "# Gogo Leash deploy .env — QoreChain diana TESTNET only, throwaway account.",
  "# Gitignored. Never fund on mainnet, never commit.",
  `QORE_MNEMONIC="${env.QORE_MNEMONIC}"`,
  `PRIVATE_KEY=${pkHex}`,
];
const file = join(ROOT, ".env");
writeFileSync(file, lines.join("\n") + "\n", { mode: 0o600 });
chmodSync(file, 0o600);
console.log(`wrote ${file} (mode 0600)`);
console.log(`owner evm ${acc.evm}  cosmos ${acc.cosmos}`);
