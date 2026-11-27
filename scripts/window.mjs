// window.mjs — check and open the EVM authorisation window for the deployer.
//
// On QoreChain every EVM transaction (a deploy included) needs:
//   1. a registered ML-DSA-87 key for the sending account, and
//   2. a live EVM authorisation window, opened by a native-lane message signed
//      hybrid (secp256k1 + ML-DSA-87).
//
//   node scripts/window.mjs status
//   node scripts/window.mjs register    register the ML-DSA-87 key (once)
//   node scripts/window.mjs open        open a window sized for a few deploys
//   node scripts/window.mjs recovery-code
//
// The account comes from QORE_MNEMONIC, or PRIVATE_KEY + QORE_PQC_RECOVERY_CODE
// in .env (testnet only — never a real key).
import {
  EthNativeSigner,
  getNetwork,
  buildRegisterPqcKeyMsg,
  deriveUnifiedAccount,
  fetchPqcStatus,
  generatePqcRecoveryCode,
  isRegisteredPqcKey,
  isValidRecoveryCode,
  openEvmWindowMsg,
  signProofOfPossession,
  unifiedAccountFromSeed,
} from "@qorechain/sdk";
import { evmWindowCost, evmWindowStatus } from "@qorechain/evm";
import { loadDotEnv, broadcast as broadcastRest } from "../agent/common.mjs";

loadDotEnv();

const preset = (name) => {
  const n = getNetwork(name);
  return {
    chainId: n.chainId,
    rest: process.env.QORE_REST_URL?.trim() || n.endpoints.rest,
    rpc: process.env.QORE_RPC_URL?.trim() || n.endpoints.rpc,
  };
};

function network() {
  const name = process.env.QORE_NETWORK ?? "testnet";
  if (name !== "testnet" && name !== "mainnet") throw new Error(`QORE_NETWORK must be "testnet" or "mainnet", got "${name}"`);
  return preset(name);
}

async function account() {
  const mnemonic = process.env.QORE_MNEMONIC?.trim();
  if (mnemonic) return deriveUnifiedAccount(mnemonic, 0);
  const key = process.env.PRIVATE_KEY?.trim();
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error("Set QORE_MNEMONIC, or PRIVATE_KEY as 0x followed by 64 hex characters, in .env");
  }
  const recoveryCode = process.env.QORE_PQC_RECOVERY_CODE?.trim();
  if (!recoveryCode) {
    throw new Error("Set QORE_PQC_RECOVERY_CODE in .env (create one with: node scripts/window.mjs recovery-code)");
  }
  if (!isValidRecoveryCode(recoveryCode)) {
    throw new Error("QORE_PQC_RECOVERY_CODE is not a valid QRC1 recovery code (check for a typo)");
  }
  return unifiedAccountFromSeed(Uint8Array.from(Buffer.from(key.slice(2), "hex")), { recoveryCode });
}

async function accountSequence(rest, address) {
  const res = await fetch(`${rest}/cosmos/auth/v1beta1/accounts/${address}`);
  if (res.status === 404) throw new Error(`${address} does not exist on chain yet: send it some QOR first`);
  if (!res.ok) throw new Error(`account query failed: HTTP ${res.status}`);
  const body = await res.json();
  const acc = body.account?.base_account ?? body.account ?? {};
  return { accountNumber: BigInt(acc.account_number ?? "0"), sequence: BigInt(acc.sequence ?? "0") };
}

const FEE = { amount: [{ denom: "uqor", amount: "100000" }], gas: "800000" };

// Broadcast via the shared REST path (agent/common.mjs): the public CometBFT
// RPC closes CosmJS connections from this VM, while REST works.
async function broadcast(acc, mode, messages) {
  const res = await broadcastRest(acc, messages, "evm window", mode);
  if (res.code !== 0) throw new Error(`window tx refused code ${res.code}: ${res.rawLog}`);
  return res.transactionHash;
}

const commands = {
  async status() {
    const net = network();
    const acc = await account();
    console.log(`account:  ${acc.evm}  (${acc.cosmos})`);
    const pqc = await fetchPqcStatus({ rest: net.rest, address: acc.cosmos });
    const mine = pqc.registered ? isRegisteredPqcKey(pqc, acc.pqc.publicKey) : false;
    console.log(`PQC key:  ${pqc.registered ? (mine === false ? "registered, but NOT this key" : "registered") : "not registered (run: node scripts/window.mjs register)"}`);
    const w = await evmWindowStatus({ rest: net.rest, address: acc.cosmos });
    if (!w.found) {
      console.log("window:   none (run: node scripts/window.mjs open)");
    } else {
      console.log(`window:   ${w.live ? "live" : "not usable"}; ${w.remainingBlocks} blocks, ${w.remainingTxs} txs, ${w.remainingValue} uqor left`);
    }
  },

  async register() {
    const net = network();
    const acc = await account();
    const pqc = await fetchPqcStatus({ rest: net.rest, address: acc.cosmos });
    if (pqc.registered) {
      console.log("The account already has a PQC key; nothing to do.");
      return;
    }
    const proofOfPossession = signProofOfPossession({ chainId: net.chainId, account: acc.cosmos, keypair: acc.pqc });
    const msg = buildRegisterPqcKeyMsg(acc.cosmos, { pqcKeypair: acc.pqc, proofOfPossession });
    console.log(`registered: ${await broadcast(acc, "classical", [msg])}`);
  },

  async open() {
    const net = network();
    const acc = await account();
    const blocks = BigInt(process.env.QORE_WINDOW_BLOCKS ?? "600");
    const maxTxs = BigInt(process.env.QORE_WINDOW_TXS ?? "5");
    const perTx = evmWindowCost({ gas: 3_000_000n, maxFeePerGas: 250_000_000_000n });
    const maxValue = BigInt(process.env.QORE_WINDOW_MAX_UQOR ?? (perTx * maxTxs).toString());
    const msg = openEvmWindowMsg({ sender: acc.cosmos, blocks, maxTxs, maxValue });
    console.log(`opened: ${await broadcast(acc, "hybrid", [msg])}`);
    console.log(`window: ${blocks} blocks, ${maxTxs} txs, ${maxValue} uqor (value plus fees)`);
    console.log("Opening advanced the account's nonce; deploy now.");
  },

  async "recovery-code"() {
    console.log(generatePqcRecoveryCode());
    console.log("Put it in .env as QORE_PQC_RECOVERY_CODE and keep a copy apart from PRIVATE_KEY.");
    console.log("Use the same code every time: a new code gives the account a different ML-DSA-87 key.");
  },
};

const cmd = process.argv[2] ?? "status";
const run = commands[cmd];
if (!run) {
  console.error(`Unknown command "${cmd}". Use: status | register | open | recovery-code`);
  process.exit(1);
}
run().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
