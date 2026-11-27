// vendor-sig.mjs — the vendor signs the invoice with their own ML-DSA-87 key,
// and the agent verifies that signature BEFORE paying.
//
// Why: the vault enforces the guardian's signature and the caps, but it
// cannot tell a real invoice from a forged one — anyone can propose a
// payment to an allowlisted address. The vendor's own post-quantum
// signature on the invoice closes that gap: the agent pays only an invoice
// the vendor actually signed, for the exact amount, once (the invoice id
// binds the signature). This is the same pattern Invoice Leash ships.
//
// Verification is twofold and both halves must pass:
//   1. local — the SDK's ML-DSA-87 verifier over the vendor's registered key;
//   2. on chain — the pqcVerify precompile (0x...0a01), the same check the
//      vault performs. The key is read from the chain's registry every time,
//      so a vendor key rotation is picked up automatically.
//
// The vendor in this demo is the gas wallet: its ML-DSA-87 key is registered
// on chain (27 Nov 2026). The agent refuses an invoice whose vendor
// signature does not verify — without spending gas.
//
//   node agent/vendor-sig.mjs sign <invoiceId> <vendorEvm> <QOR>
//       sign an invoice with the gas (vendor) key; prints the signature
//   node agent/vendor-sig.mjs verify <invoiceId> <vendorCosmos> <vendorEvm> <QOR> <sigHex>
//       verify a signature against the vendor's registered key
import { createPublicClient, defineChain, http, parseAbi, encodePacked, parseEther, hexToBytes, toHex } from "viem";
import { deriveUnifiedAccount, fetchPqcStatus, pqcStatusPublicKey, pqcSign, pqcVerify } from "@qorechain/sdk";
import { loadDotEnv, REST, AGENT_ENV, parseEnvFile } from "./common.mjs";
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

loadDotEnv();

const diana = defineChain({
  id: 9800,
  name: "QoreChain Testnet",
  nativeCurrency: { name: "QOR", symbol: "QOR", decimals: 18 },
  rpcUrls: { default: { http: ["https://evm-testnet.qore.host"] } },
});

const PQC_VERIFY_PRECOMPILE = "0x0000000000000000000000000000000000000a01";
const pqcAbi = parseAbi([
  "function pqcVerify(bytes pubkey, bytes signature, bytes message) view returns (bool valid)",
]);

export const INVOICE_TAG = "GogoLeash:invoice:v1";

/// The exact bytes the vendor signs. Binds the tag, the chain, the vault,
/// the vendor, the amount and the invoice id — so a signature is good for
/// one invoice, on one vault, on one chain, once. Returns raw bytes.
export function invoiceMessage({ vault, vendorEvm, amountWei, invoiceId }) {
  return hexToBytes(encodePacked(
    ["string", "uint256", "address", "address", "uint256", "string"],
    [INVOICE_TAG, 9800n, vault, vendorEvm, BigInt(amountWei), String(invoiceId)],
  ));
}

export function signInvoice(secretKey, message) {
  return toHex(pqcSign(secretKey, message));
}

export function resolveVaultAddress() {
  const fromEnv = (process.env.VAULT_ADDRESS ?? "").trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(fromEnv)) return fromEnv;
  const f = "broadcast/DeployGogoLeashV2.s.sol/9800/run-latest.json";
  if (!existsSync(f)) return "";
  const run = JSON.parse(readFileSync(f, "utf8"));
  return run.transactions?.find((t) => t.contractName === "GogoLeashVaultV2")?.contractAddress ?? "";
}

async function callPrecompile(pubkey, signature, message) {
  const pub = createPublicClient({ chain: diana, transport: http() });
  return pub.readContract({
    address: PQC_VERIFY_PRECOMPILE, abi: pqcAbi, functionName: "pqcVerify",
    args: [toHex(pubkey), toHex(signature), toHex(message)],
  });
}

/// Verify a vendor invoice signature. `deps` overrides the chain reads
/// (tests inject stubs); by default everything is read live.
export async function verifyInvoice(input, deps = {}) {
  const { vendorCosmos, vendorEvm, vault, amountWei, invoiceId, signature } = input;
  const fetchStatus = deps.fetchStatus ?? ((address) => fetchPqcStatus({ rest: REST, address }));
  const status = await fetchStatus(vendorCosmos);
  const pubkey = deps.pubkey ?? pqcStatusPublicKey(status);
  if (!status.registered || !pubkey) {
    return { valid: false, local: false, onchain: false, reason: "vendor ML-DSA-87 key is not registered on chain" };
  }
  const message = invoiceMessage({ vault, vendorEvm, amountWei, invoiceId });
  const sigBytes = typeof signature === "string" ? hexToBytes(signature) : signature;
  const local = (deps.verifyLocal ?? pqcVerify)(pubkey, message, sigBytes);
  const onchain = deps.verifyOnChain
    ? await deps.verifyOnChain(pubkey, sigBytes, message)
    : await callPrecompile(pubkey, sigBytes, message);
  const valid = local && onchain;
  return {
    valid, local, onchain,
    reason: valid
      ? "vendor signature verified (local ML-DSA-87 + on-chain pqcVerify precompile)"
      : `vendor signature FAILED: local=${local} on-chain=${onchain}`,
  };
}

async function gasAccount() {
  if (!existsSync(AGENT_ENV)) throw new Error(`missing ${AGENT_ENV}: run "node agent/leash.mjs init" first`);
  const env = parseEnvFile(AGENT_ENV);
  return deriveUnifiedAccount(env.GAS_MNEMONIC, 0);
}

const commands = {
  async sign(invoiceId, vendorEvm, qor) {
    if (!invoiceId || !/^0x[0-9a-fA-F]{40}$/.test(vendorEvm ?? "") || !(Number(qor) > 0)) {
      throw new Error("Use: sign <invoiceId> <vendorEvm 0x...> <QOR>");
    }
    const vault = resolveVaultAddress();
    if (!vault) throw new Error("No vault yet: run the forge deploy first (or set VAULT_ADDRESS in .env)");
    const g = await gasAccount();
    const message = invoiceMessage({ vault, vendorEvm, amountWei: parseEther(qor), invoiceId });
    const sig = signInvoice(g.pqc.secretKey, message);
    console.log(`invoice   ${invoiceId}: ${qor} QOR to ${vendorEvm} on vault ${vault}`);
    console.log(`vendor    ${g.cosmos} (gas wallet, ML-DSA-87 key registered)`);
    console.log(`signature ${sig}`);
    console.log("Put it on the proposal as vendorSig + invoiceId; the agent verifies it before paying.");
  },

  async verify(invoiceId, vendorCosmos, vendorEvm, qor, sigHex) {
    if (!invoiceId || !vendorCosmos || !/^0x[0-9a-fA-F]{40}$/.test(vendorEvm ?? "") || !(Number(qor) > 0) || !sigHex) {
      throw new Error("Use: verify <invoiceId> <vendorCosmos> <vendorEvm 0x...> <QOR> <sigHex>");
    }
    const vault = resolveVaultAddress();
    if (!vault) throw new Error("No vault yet: run the forge deploy first (or set VAULT_ADDRESS in .env)");
    const res = await verifyInvoice({ vendorCosmos, vendorEvm, vault, amountWei: parseEther(qor), invoiceId, signature: sigHex });
    console.log(res.valid ? `VERIFIED: ${res.reason}` : `REFUSED: ${res.reason}`);
    if (!res.valid) process.exitCode = 1;
  },
};

const [cmd, ...args] = process.argv.slice(2);
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const run = commands[cmd];
  if (!run) {
    console.error("Use: sign <invoiceId> <vendorEvm> <QOR> | verify <invoiceId> <vendorCosmos> <vendorEvm> <QOR> <sigHex>");
    process.exit(1);
  }
  run(...args).catch((e) => {
    console.error(String(e?.message ?? e));
    process.exitCode = 1;
  });
}
