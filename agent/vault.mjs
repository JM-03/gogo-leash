// vault.mjs — use a deployed GogoLeashVault on the qorechain-diana testnet.
//
//   node agent/vault.mjs status
//   node agent/vault.mjs withdraw <to> <QOR>   guardian signs with ML-DSA-87
//   node agent/vault.mjs attack <to> <QOR>     attacker with only the classical
//                                              key tries (simulated: nothing spent)
//   node agent/vault.mjs allowlist <addr> [true|false]
//   node agent/vault.mjs caps <perTxQOR> <dailyQOR>
//   node agent/vault.mjs pause | unpause
//
// The vault is VAULT_ADDRESS from .env (or the latest forge deploy). The
// guardian is the account in .env (QORE_MNEMONIC, or PRIVATE_KEY +
// QORE_PQC_RECOVERY_CODE). EVM transactions need a live EVM window:
// node scripts/window.mjs open (then wait ~10 s).
import { createPublicClient, createWalletClient, defineChain, http, parseAbi, parseEther, formatEther, toHex, BaseError, ContractFunctionRevertedError } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { existsSync, readFileSync } from "node:fs";
import { deriveUnifiedAccount, unifiedAccountFromSeed, generatePqcKeypair, pqcSign, fetchPqcStatus } from "@qorechain/sdk";
import { audit } from "./audit.mjs";
import { loadDotEnv, REST, EXPLORER } from "./common.mjs";

loadDotEnv();

const diana = defineChain({
  id: 9800,
  name: "QoreChain Testnet",
  nativeCurrency: { name: "QOR", symbol: "QOR", decimals: 18 },
  rpcUrls: { default: { http: ["https://evm-testnet.qore.host"] } },
});

const abi = parseAbi([
  "function guardian() view returns (address)",
  "function nonce() view returns (uint256)",
  "function perTxCap() view returns (uint256)",
  "function dailyCap() view returns (uint256)",
  "function paused() view returns (bool)",
  "function allowlisted(address) view returns (bool)",
  "function spentTodayAmount() view returns (uint256)",
  "function withdrawalMessage(address to, uint256 amount, uint256 nonce) view returns (bytes)",
  "function withdraw(address to, uint256 amount, bytes mldsaSignature)",
  "function setAllowlisted(address account, bool allowed)",
  "function setCaps(uint256 perTxCap, uint256 dailyCap)",
  "function pause()",
  "function unpause()",
  "error NotGuardian()",
  "error PausedVault()",
  "error NotAllowlisted(address to)",
  "error OverPerTxCap(uint256 amount, uint256 cap)",
  "error OverDailyCap(uint256 amount, uint256 remaining)",
  "error GuardianKeyNotRegistered()",
  "error GuardianKeyNotProven()",
  "error BadPqcSignature()",
  "error TransferFailed()",
]);

function latestDeploy() {
  const f = "broadcast/DeployGogoLeash.s.sol/9800/run-latest.json";
  if (!existsSync(f)) return "";
  const run = JSON.parse(readFileSync(f, "utf8"));
  return run.transactions?.find((t) => t.contractName === "GogoLeashVault")?.contractAddress ?? "";
}

const vault = ((process.env.VAULT_ADDRESS ?? "").trim() || latestDeploy());
if (!/^0x[0-9a-fA-F]{40}$/.test(vault)) {
  throw new Error("No vault yet: run the forge deploy first (or set VAULT_ADDRESS in .env)");
}
const pub = createPublicClient({ chain: diana, transport: http() });

function why(e) {
  if (e instanceof BaseError) {
    const r = e.walk((x) => x instanceof ContractFunctionRevertedError);
    if (r instanceof ContractFunctionRevertedError) return r.data?.errorName ?? r.reason ?? r.shortMessage;
    return e.shortMessage;
  }
  return String(e);
}

const sender = () => {
  const k = process.env.PRIVATE_KEY?.trim();
  if (!k) throw new Error("Set PRIVATE_KEY in .env");
  return privateKeyToAccount(k);
};

async function guardianAccount() {
  const mnemonic = process.env.QORE_MNEMONIC?.trim();
  if (mnemonic) return deriveUnifiedAccount(mnemonic, 0);
  const key = process.env.PRIVATE_KEY?.trim();
  const recoveryCode = process.env.QORE_PQC_RECOVERY_CODE?.trim();
  if (!key || !recoveryCode) throw new Error("Set QORE_MNEMONIC, or PRIVATE_KEY and QORE_PQC_RECOVERY_CODE, in .env");
  return unifiedAccountFromSeed(Uint8Array.from(Buffer.from(key.slice(2), "hex")), { recoveryCode });
}

async function prepare(to, qor) {
  const amount = parseEther(qor);
  const n = await pub.readContract({ address: vault, abi, functionName: "nonce" });
  const message = await pub.readContract({ address: vault, abi, functionName: "withdrawalMessage", args: [to, amount, n] });
  return { amount, n, message: Uint8Array.from(Buffer.from(message.slice(2), "hex")) };
}

const commands = {
  async status() {
    const [bal, guardian, n, perTx, daily, spent, paused] = await Promise.all([
      pub.getBalance({ address: vault }),
      pub.readContract({ address: vault, abi, functionName: "guardian" }),
      pub.readContract({ address: vault, abi, functionName: "nonce" }),
      pub.readContract({ address: vault, abi, functionName: "perTxCap" }),
      pub.readContract({ address: vault, abi, functionName: "dailyCap" }),
      pub.readContract({ address: vault, abi, functionName: "spentTodayAmount" }),
      pub.readContract({ address: vault, abi, functionName: "paused" }),
    ]);
    console.log(`vault     ${vault}  ${formatEther(bal)} QOR`);
    console.log(`guardian  ${guardian}`);
    console.log(`nonce     ${n} withdrawals so far`);
    console.log(`caps      ${formatEther(perTx)} QOR per payment, ${formatEther(daily)} QOR per day (spent today ${formatEther(spent)})`);
    console.log(`kill switch: ${paused ? "PAUSED" : "off"}`);
  },

  async withdraw(to, qor) {
    const g = await guardianAccount();
    const st = await fetchPqcStatus({ rest: REST, address: g.cosmos });
    if (!st.registered) throw new Error(`guardian ${g.cosmos} has no ML-DSA-87 key on chain: node scripts/window.mjs register`);
    const { amount, n, message } = await prepare(to, qor);
    const signature = pqcSign(g.pqc.secretKey, message);
    console.log(`guardian signs withdrawal #${n}: ${qor} QOR to ${to}`);
    console.log(`  message ${message.length} bytes, ML-DSA-87 signature ${signature.length} bytes`);
    const wallet = createWalletClient({ account: sender(), chain: diana, transport: http() });
    try {
      const hash = await wallet.writeContract({ address: vault, abi, functionName: "withdraw", args: [to, amount, toHex(signature)], gas: 1_000_000n });
      const r = await pub.waitForTransactionReceipt({ hash });
      console.log(`  ${r.status === "success" ? "WITHDRAWN" : "REVERTED"}  tx ${hash}  gas ${r.gasUsed}`);
      console.log(`  ${EXPLORER}${hash}`);
      audit("vault.withdraw", { to, qor: String(qor), nonce: n.toString(), tx: hash, status: r.status });
    } catch (e) {
      console.log(`  REFUSED: ${why(e)}`);
      if (/window|authori[sz]|invalid parameters/i.test(why(e))) {
        console.log("  (no live EVM window: check with node scripts/window.mjs status, open one with node scripts/window.mjs open, wait ~10 s)");
      }
      audit("vault.withdraw-refused", { to, qor: String(qor), reason: why(e) });
      process.exitCode = 1;
    }
  },

  async attack(to, qor) {
    // The attacker stole the secp256k1 key, so they can send transactions —
    // but they do not have the guardian's ML-DSA-87 key. They sign with a key
    // of their own. The vault must refuse, and the simulation costs nothing.
    const { amount, n, message } = await prepare(to, qor);
    const forged = pqcSign(generatePqcKeypair().secretKey, message);
    console.log(`attacker tries withdrawal #${n}: ${qor} QOR to ${to}, with a forged ML-DSA-87 signature`);
    try {
      await pub.simulateContract({ account: sender(), address: vault, abi, functionName: "withdraw", args: [to, amount, toHex(forged)], gas: 1_000_000n });
      console.log("  UNEXPECTED: the simulation passed — the vault did not block the attack");
      audit("vault.drill-attack", { to, qor: String(qor), result: "UNEXPECTED-PASS" });
      process.exitCode = 1;
    } catch (e) {
      console.log(`  BLOCKED by the vault: ${why(e)}`);
      audit("vault.drill-attack", { to, qor: String(qor), result: "BLOCKED", reason: why(e) });
    }
  },

  async allowlist(addr, allowed = "true") {
    const wallet = createWalletClient({ account: sender(), chain: diana, transport: http() });
    const hash = await wallet.writeContract({ address: vault, abi, functionName: "setAllowlisted", args: [addr, allowed === "true"], gas: 500_000n });
    console.log(`allowlist ${addr} -> ${allowed}  tx ${hash}`);
    audit("vault.allowlist", { addr, allowed: allowed === "true", tx: hash });
  },

  async caps(perTx, daily) {
    const wallet = createWalletClient({ account: sender(), chain: diana, transport: http() });
    const hash = await wallet.writeContract({ address: vault, abi, functionName: "setCaps", args: [parseEther(perTx), parseEther(daily)], gas: 500_000n });
    console.log(`caps -> ${perTx} QOR per payment, ${daily} QOR per day  tx ${hash}`);
    audit("vault.caps", { perTxQor: perTx, dailyQor: daily, tx: hash });
  },

  async pause() {
    const wallet = createWalletClient({ account: sender(), chain: diana, transport: http() });
    const hash = await wallet.writeContract({ address: vault, abi, functionName: "pause", gas: 500_000n });
    console.log(`vault PAUSED (kill switch on)  tx ${hash}`);
    audit("vault.pause", { tx: hash });
  },

  async unpause() {
    const wallet = createWalletClient({ account: sender(), chain: diana, transport: http() });
    const hash = await wallet.writeContract({ address: vault, abi, functionName: "unpause", gas: 500_000n });
    console.log(`vault unpaused (kill switch off)  tx ${hash}`);
    audit("vault.unpause", { tx: hash });
  },
};

const [cmd = "status", ...args] = process.argv.slice(2);
const run = commands[cmd];
if (!run) {
  console.error("Use: status | withdraw <to> <QOR> | attack <to> <QOR> | allowlist <addr> [true|false] | caps <perTxQOR> <dailyQOR> | pause | unpause");
  process.exit(1);
}
run(...args).catch((e) => {
  console.error(why(e));
  process.exitCode = 1;
});
